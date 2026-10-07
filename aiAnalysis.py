import json
import re
from urllib.parse import quote_plus

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

MODEL = "gemini-3-flash-preview"
LEVELS = ("Ovo", "Patinho", "Pato", "Pato-real", "Cisne")


class AnalysisError(Exception):
    """Erro de análise com um código que a interface usa para escolher a tela certa.

    Códigos: sem_chave, chave_invalida, sem_conexao, limite, servico_indisponivel,
    resposta_invalida, desconhecido.
    """

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


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
        if code == 429 or status == "RESOURCE_EXHAUSTED":
            return AnalysisError("limite", "O limite de uso gratuito do Gemini foi atingido por agora.")
        if code >= 500:
            return AnalysisError("servico_indisponivel", "O Gemini está fora do ar ou sobrecarregado.")
        return AnalysisError("desconhecido", f"O Gemini recusou o pedido ({code}). {message}".strip())
    name = type(error).__name__.lower()
    module = type(error).__module__.lower()
    if "httpx" in module or "connect" in name or "timeout" in name or isinstance(error, (ConnectionError, TimeoutError, OSError)):
        return AnalysisError("sem_conexao", "Não foi possível falar com o Gemini. Confira a internet.")
    if isinstance(error, (ValueError, json.JSONDecodeError)):
        return AnalysisError("resposta_invalida", str(error))
    return AnalysisError("desconhecido", str(error) or type(error).__name__)


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
            ),
        )
        if not getattr(response, "text", None):
            raise ValueError("A IA não retornou conteúdo. Tente novamente.")
        return _validate_analysis(_extract_json(response.text))
    except Exception as error:  # noqa: BLE001 - toda falha vira um código para a interface
        raise _classify_error(error) from error


def get_search_url(query):
    return f"https://www.google.com/search?tbm=shop&q={quote_plus(query)}"
