import json
import re
from urllib.parse import quote_plus

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

# Modelo combinado com o grupo (commit do Eduardo de 13/10). Aparece na tela do Consultor.
MODEL = "gemini-3.5-flash-lite"
GEMINI_MODEL = MODEL  # mesmo nome usado na versão antiga
LEVELS = ("Ovo", "Patinho", "Pato", "Pato-real", "Cisne")


class AnalysisError(Exception):
    """Erro de análise com um código que a interface usa para escolher a tela certa.

    Códigos: sem_chave, chave_invalida, sem_conexao, limite, servico_indisponivel,
    resposta_invalida, desconhecido.
    """

    def __init__(self, code, message, retry_seconds=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retry_seconds = retry_seconds  # só no código "limite", quando o Google informa a espera


def _retry_seconds(error):
    """Lê quantos segundos o Google pede para esperar depois de um erro 429.

    O tempo pode vir em details (RetryInfo, "retryDelay": "37s") ou no texto
    ("Please retry in 1m5.2s"). Devolve None quando não houver.
    """
    text = json.dumps(getattr(error, "details", None) or {}, ensure_ascii=False) + " " + str(getattr(error, "message", "") or error)
    match = re.search(r'"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"', text)
    if match:
        return max(1, round(float(match.group(1))))
    match = re.search(r"retry in (?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)s", text, flags=re.IGNORECASE)
    if match:
        hours, minutes, seconds = int(match.group(1) or 0), int(match.group(2) or 0), float(match.group(3))
        return max(1, round(hours * 3600 + minutes * 60 + seconds))
    match = re.search(r"retry_delay\s*\{\s*seconds:\s*(\d+)", text, flags=re.IGNORECASE)
    if match:
        return max(1, int(match.group(1)))
    return None


def format_wait(seconds):
    """60 -> "1 min", 75 -> "1 min e 15 s", 3700 -> "1 h e 1 min"."""
    hours, rest = divmod(int(seconds), 3600)
    minutes, secs = divmod(rest, 60)
    if hours:
        return f"{hours} h e {minutes} min" if minutes else f"{hours} h"
    if minutes:
        return f"{minutes} min e {secs} s" if secs else f"{minutes} min"
    return f"{secs} s"


def _extract_json(text):
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if not match:
            raise ValueError("A IA retornou uma resposta fora do formato JSON esperado.")
        return json.loads(match.group(0))


def _as_level(value, default):
    try:
        level = int(value)
    except (TypeError, ValueError):
        return default
    return max(0, min(4, level))


def _validate_analysis(data):
    if not isinstance(data, dict):
        raise ValueError("A resposta da IA não contém um objeto JSON.")
    required = ("verdict", "analysis", "bottlenecks", "recommendations", "missing_information")
    missing = [field for field in required if field not in data]
    if missing:
        raise ValueError(f"A resposta da IA não contém os campos: {', '.join(missing)}.")
    if not isinstance(data["recommendations"], list):
        raise ValueError("A lista de recomendações retornada pela IA é inválida.")
    data.setdefault("budget_status", "unknown")
    data.setdefault("budget_message", "")
    data.setdefault("confidence", "média")
    if data["budget_status"] not in {"within_budget", "no_worthwhile_upgrade", "unknown"}:
        data["budget_status"] = "unknown"
    if len(data["recommendations"]) > 3:
        data["recommendations"] = data["recommendations"][:3]
    for field in ("analysis", "bottlenecks", "missing_information", "quick_summary"):
        value = data.get(field, [])
        if isinstance(value, str):
            data[field] = [value]
        elif isinstance(value, list):
            data[field] = [str(item) for item in value if str(item).strip()]
        else:
            data[field] = []
    for recommendation in data["recommendations"]:
        if not isinstance(recommendation, dict):
            raise ValueError("Uma recomendação retornada pela IA está em formato inválido.")
        for field in ("component", "current", "suggestion", "reason", "compatibility", "search_query", "priority"):
            recommendation.setdefault(field, "")
        checks = recommendation.get("verify_before_buying", [])
        if isinstance(checks, str):
            recommendation["verify_before_buying"] = [checks]
        elif not isinstance(checks, list):
            recommendation["verify_before_buying"] = []
        recommendation["search_url"] = get_search_url(recommendation["search_query"]) if recommendation["search_query"] else ""
    # Campos usados pelo design do Mallard (nível e gargalo em destaque).
    data["level_now"] = _as_level(data.get("level_now"), 1)
    data["level_after"] = _as_level(data.get("level_after"), data["level_now"])
    if data["level_after"] < data["level_now"]:
        data["level_after"] = data["level_now"]
    main = data.get("main_bottleneck")
    data["main_bottleneck"] = main.strip() if isinstance(main, str) and main.strip() else None
    return data


def _build_prompt(hardware, perfil, preferencias):
    return f"""
Você é um consultor técnico de upgrades de computadores. Analise o hardware e o perfil
informados. Priorize compatibilidade, custo-benefício e explicações honestas, em
português simples, para quem não entende de hardware.

DADOS DETECTADOS (podem conter campos não identificados):
{json.dumps(hardware, ensure_ascii=False, indent=2)}

PERFIL E PREFERÊNCIAS:
{json.dumps({"perfil": perfil, **preferencias}, ensure_ascii=False, indent=2)}

REGRAS:
- Não invente soquete, chipset, versão de BIOS, tipo de RAM, potência da fonte,
  dimensões do gabinete, preço atual ou desempenho medido.
- Considere gargalo apenas quando os dados e o perfil sustentarem essa conclusão.
- Se faltar dado para confirmar compatibilidade, diga exatamente o que precisa ser
  verificado antes da compra e reduza a confiança da recomendação.
- Se uma placa-mãe for OEM/proprietária ou não estiver identificada, não indique
  troca de CPU/RAM como compatível sem confirmação do modelo e da plataforma.
- As respostas opcionais podem ser null: ignore esses campos e não trate ausência como erro.
- Leve o filtro de perfil a sério. Para jogos competitivos leves (por exemplo, LoL),
  não recomende peças para AAA/4K, a menos que o usuário peça isso explicitamente.
- O campo "tipo_de_maquina" diz se é "desktop" ou "notebook".
  - Em NOTEBOOK, só recomende memória RAM e armazenamento (SSD). Nunca recomende trocar
    processador, placa de vídeo, placa-mãe ou fonte, porque em notebooks essas peças
    não são trocáveis. Para a RAM, inclua em verify_before_buying conferir se ela é
    soldada e quantos slots livres existem.
  - Em NOTEBOOK, se memória e armazenamento não resolverem o que o usuário quer, diga
    isso com clareza e recomende considerar um notebook novo, usando "Notebook novo"
    como component e descrevendo em suggestion as características mínimas (sem marca
    nem preço inventados).
- Respeite rigorosamente o orçamento. Se ele for insuficiente para um upgrade
  compatível que traga melhora relevante, NÃO recomende gastar acima dele: explique
  claramente que não há upgrade que valha a pena nesse limite. Quando possível, indique
  uma alternativa usada/de entrada ou uma melhoria gratuita/adiamento, mas sem inventar
  preços. Se nem uma alternativa fizer sentido, diga isso sem forçar uma compra.
- Classifique budget_status como "within_budget" quando houver sugestão plausível no
  limite informado, "no_worthwhile_upgrade" quando o orçamento não comportar uma
  melhoria confiável, ou "unknown" quando não houver orçamento informado.
- Se não houver orçamento informado, não presuma um limite nem alegue que algo cabe nele.
- Preços não são consultados em tempo real. Para cada recomendação, retorne termos
  de pesquisa, que serão transformados em links de busca e não em cotações.
- Recomende no máximo três upgrades e ordene por prioridade.
- Dê um nível ao PC para o perfil informado, de 0 a 4 ({", ".join(f"{i}={name}" for i, name in enumerate(LEVELS))}):
  level_now é o nível de hoje e level_after é o nível estimado depois das recomendações.
  Use 0 só quando faltarem dados para avaliar.
- main_bottleneck é o nome curto da peça que mais segura o PC para esse perfil
  (por exemplo "Memória RAM"), ou null se não houver gargalo claro.
- quick_summary tem de 2 a 4 frases curtas e diretas, para quem não entende de hardware.
- Responda somente com JSON válido, sem Markdown, neste formato:
{{
  "verdict": "resumo curto",
  "quick_summary": ["frase curta"],
  "confidence": "alta, média ou baixa",
  "level_now": 1,
  "level_after": 3,
  "main_bottleneck": "peça ou null",
  "budget_status": "within_budget/no_worthwhile_upgrade/unknown",
  "budget_message": "explicação amigável do que o orçamento permite",
  "analysis": ["observação técnica"],
  "bottlenecks": ["gargalo comprovado ou Nenhum identificado com os dados atuais"],
  "recommendations": [
    {{"component": "componente", "current": "peça atual", "suggestion": "peça sugerida",
      "priority": "alta/média/baixa", "reason": "justificativa ligada ao perfil",
      "compatibility": "confirmada/parcial/não confirmada", "verify_before_buying": ["verificação"],
      "search_query": "termos para pesquisar"}}
  ],
  "missing_information": ["informação que faria a análise mais precisa"]
}}
"""


def _classify_error(error):
    """Transforma erros da biblioteca e da rede em AnalysisError com código."""
    if isinstance(error, AnalysisError):
        return error
    if isinstance(error, genai_errors.APIError):
        code = getattr(error, "code", None) or 0
        status = str(getattr(error, "status", "") or "").upper()
        message = str(getattr(error, "message", "") or "")
        lowered = message.lower()
        if code in (401, 403) or "api key" in lowered or "api_key" in lowered or status in {"UNAUTHENTICATED", "PERMISSION_DENIED"}:
            return AnalysisError("chave_invalida", "O Gemini recusou a chave informada.")
        if code == 429 or status == "RESOURCE_EXHAUSTED" or "quota" in lowered:
            wait = _retry_seconds(error)
            if wait:
                return AnalysisError("limite", f"O Gemini pediu para esperar pelo menos {format_wait(wait)} antes de tentar de novo.", wait)
            return AnalysisError("limite", "A cota deste projeto ou modelo no Gemini foi atingida. Espere a cota renovar no AI Studio.")
        if code >= 500 or status == "UNAVAILABLE" or "overloaded" in lowered:
            return AnalysisError("servico_indisponivel", "O Gemini está fora do ar ou sobrecarregado.")
        return AnalysisError("desconhecido", f"O Gemini recusou o pedido ({code}). {message}".strip())
    name = type(error).__name__.lower()
    module = type(error).__module__.lower()
    if "httpx" in module or "connect" in name or "timeout" in name or isinstance(error, (ConnectionError, TimeoutError, OSError)):
        return AnalysisError("sem_conexao", "Não foi possível falar com o Gemini. Confira a internet.")
    if isinstance(error, (ValueError, json.JSONDecodeError)):
        return AnalysisError("resposta_invalida", str(error))
    return AnalysisError("desconhecido", str(error) or type(error).__name__)


def _single_attempt():
    """Sem novas tentativas automáticas: um clique em "Analisar" = no máximo uma
    solicitação ao Gemini (regra do commit do Eduardo de 13/10).

    Versões antigas do google-genai não têm HttpRetryOptions, mas também não
    repetem chamadas, então nesse caso não é preciso configurar nada.
    """
    retry_options = getattr(types, "HttpRetryOptions", None)
    if retry_options is None:
        return None
    return types.HttpOptions(retry_options=retry_options(attempts=1))


def consultar_gemini(api_key, hardware, perfil, preferencias):
    """Gera um diagnóstico estruturado. Não consulta preços em tempo real.

    Levanta AnalysisError com um código quando algo dá errado.
    """
    if not api_key:
        raise AnalysisError("sem_chave", "Informe a chave do Gemini para pedir a análise.")
    try:
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=MODEL,
            contents=_build_prompt(hardware, perfil, preferencias),
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.2,
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                http_options=_single_attempt(),
            ),
        )
        if not getattr(response, "text", None):
            raise ValueError("A IA não retornou conteúdo. Tente novamente.")
        return _validate_analysis(_extract_json(response.text))
    except Exception as error:  # noqa: BLE001 - toda falha vira um código para a interface
        raise _classify_error(error) from error


def get_search_url(query):
    return f"https://www.google.com/search?tbm=shop&q={quote_plus(query)}"


def _build_requirements_prompt(nome):
    return f"""
Você ajuda a decidir se um jogo ou programa roda em um computador. Informe os requisitos
de referência de "{nome}" (versão atual, para Windows). Se não conhecer esse título, ou se o
nome não for de um jogo ou programa, responda com "found": false. Não invente números.

Níveis (0 a 3) para processador e placa de vídeo:
- cpu_min_tier / cpu_rec_tier: 0 = 2 núcleos, 1 = 4 núcleos, 2 = 6 núcleos, 3 = 8 ou mais.
- gpu_min_tier / gpu_rec_tier: 0 = vídeo integrado, 1 = entrada (GTX 1050), 2 = intermediária
  (GTX 1660, RTX 3050), 3 = alta (RTX 3060 ou melhor).

Responda somente com JSON válido, sem Markdown:
{{"found": true, "name": "nome oficial", "kind": "tipo curto (ex.: Jogo AAA, Programa de edição)",
  "noun": "jogo ou programa", "ram_min_gb": 8, "ram_rec_gb": 16, "cpu_min_tier": 1, "cpu_rec_tier": 2,
  "cpu_text": "processador pedido em linguagem simples", "gpu_min_tier": 1, "gpu_rec_tier": 2,
  "gpu_text": "placa de vídeo pedida em linguagem simples", "disk_gb": 50}}
"""


def _validate_requirements(data):
    if not isinstance(data, dict) or not data.get("found"):
        return None
    try:
        ok = {
            "name": str(data["name"]).strip()[:60], "kind": str(data.get("kind") or "Jogo ou programa")[:40],
            "noun": "jogo" if str(data.get("noun")).lower().startswith("jog") else "programa",
            "ram_min_gb": float(data["ram_min_gb"]), "ram_rec_gb": float(data["ram_rec_gb"]),
            "cpu_min_tier": int(data["cpu_min_tier"]), "cpu_rec_tier": int(data["cpu_rec_tier"]),
            "gpu_min_tier": int(data["gpu_min_tier"]), "gpu_rec_tier": int(data["gpu_rec_tier"]),
            "cpu_text": str(data.get("cpu_text") or "")[:80], "gpu_text": str(data.get("gpu_text") or "")[:80],
            "disk_gb": float(data["disk_gb"]),
        }
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("A IA não devolveu os requisitos no formato esperado.") from error
    if not ok["name"] or ok["ram_min_gb"] <= 0 or ok["ram_min_gb"] > 128 or ok["disk_gb"] < 0 or ok["disk_gb"] > 2000:
        raise ValueError("Os requisitos devolvidos pela IA não parecem válidos.")
    ok["ram_rec_gb"] = max(ok["ram_rec_gb"], ok["ram_min_gb"])
    for key in ("cpu_min_tier", "cpu_rec_tier", "gpu_min_tier", "gpu_rec_tier"):
        ok[key] = max(0, min(3, ok[key]))
    ok["cpu_rec_tier"] = max(ok["cpu_rec_tier"], ok["cpu_min_tier"])
    ok["gpu_rec_tier"] = max(ok["gpu_rec_tier"], ok["gpu_min_tier"])
    return ok


def consultar_requisitos(api_key, nome):
    """Pergunta ao Gemini os requisitos de um jogo/programa que não está na lista local.

    Uma chamada = uma solicitação, igual ao Consultor. Devolve None quando o título não existe.
    """
    if not api_key:
        raise AnalysisError("sem_chave", "Informe a chave do Gemini para pesquisar esse título.")
    try:
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=MODEL,
            contents=_build_requirements_prompt(str(nome)[:80]),
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1,
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                http_options=_single_attempt(),
            ),
        )
        if not getattr(response, "text", None):
            raise ValueError("A IA não retornou conteúdo. Tente novamente.")
        return _validate_requirements(_extract_json(response.text))
    except Exception as error:  # noqa: BLE001
        raise _classify_error(error) from error
