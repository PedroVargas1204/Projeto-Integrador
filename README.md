<p align="center">
  <img src="assets/mallard-logo.svg" width="120" alt="Logo do Mallard">
</p>

<h1 align="center">Mallard</h1>
<p align="center"><strong>Especialista em <em>PATO</em>logia de PC.</strong><br>O estado real do seu PC: monitoramento de hardware com um consultor de upgrades feito por IA.</p>

---

## A história do nome

Em 1972, na Escola Politécnica da USP, ficou pronto o **Patinho Feio**, o primeiro computador projetado e construído no Brasil. O Mallard leva um pato no nome em homenagem a ele e à ideia do conto do Andersen: o patinho que ninguém levava a sério e que vira cisne.

*Mallard* é o pato-real em inglês. O slogan entrega o trocadilho: o Mallard é especialista em **PATO**logia de PC. Ele examina o computador, encontra o que está fazendo mal a ele e explica o tratamento.

O projeto começou como **MonitorPc** (Streamlit), virou **HardwareAnalysis** (PySide6) e hoje é o **Mallard** (PyWebview + HTML/JS).

## O que ele faz

| | |
|---|---|
| **Meu computador** | Identifica processador, memória, disco, placa de vídeo e placa-mãe. Peças não identificadas podem ser informadas à mão. Dá ao PC um nível: Ovo, Patinho, Pato, Pato-real ou Cisne. |
| **Entenda seu PC** | Explica cada peça com a mesma analogia: o computador é uma cozinha (o processador é o cozinheiro, a memória é a bancada, o disco é a despensa). |
| **Monitoramento** | CPU, memória, disco e GPU a cada segundo, com o humor do pato conforme o uso. |
| **Consultor de upgrades** | Três passos (uso, detalhes, orçamento) e o Google Gemini aponta o gargalo e sugere até três upgrades em ordem de prioridade. |
| **Histórico** | Cada análise fica salva: dá para marcar os upgrades feitos e exportar um relatório em HTML. |
| **Simulador** | "Provador de peças": escolha mais RAM, um SSD ou uma placa de vídeo e veja o nível do PC antes e depois, sem usar a IA. |
| **Diário** | Anota o uso a cada minuto (enquanto o app está aberto) e conta a semana: quando a memória encheu e se o PC travou. |
| **Vai rodar?** | Compara um jogo ou programa com as peças do PC. Títulos fora da lista local podem ser buscados no Gemini (uma solicitação). |
| **Ferramentas** | **Limpeza** (temporários, cache, Lixeira e Downloads antigos, com segurança), **Inicialização** (liga e desliga programas que abrem com o Windows, sem desinstalar) e **Bateria** (só em notebooks). |

Na primeira vez, o app abre com a escolha do pato e, em cada tela nova, o botão **?** mostra três passos de ajuda.

### Escolha seu pato

Cinco temas, cada um com as cores de uma plumagem:

| Tema | Plumagem |
|---|---|
| **Mallard** (padrão) | Pato-real macho: cabeça verde e espéculo azul-violeta |
| **Pekin** | Branco, com bico laranja (tema claro) |
| **Fêmea** | Marrom e bege da fêmea do pato-real (tema claro) |
| **Cinzento** | Do cinza-claro ao chumbo, com bico amarelo |
| **Cayuga** | Preto com brilho verde-besouro |

Dizem que existe um sexto pato, mas ele só aparece para quem insiste no logo.

## Rodando a partir do código

Requer **Windows 10 ou 11** e **Python 3.12**.

```bash
git clone https://github.com/PedroVargas1204/Projeto-Integrador.git
cd Projeto-Integrador
python app.py
```

Também é possível iniciar com `python main.py`. Na primeira execução, o app instala sozinho as bibliotecas que faltarem (`pywebview`, `psutil`, `wmi`, `pynvml` e `google-genai`).

Para ver só a interface, sem Python, abra `ui/index.html` no navegador: ela entra em **modo demonstração**, com dados de exemplo.

### Requisitos de hardware

- Uso e temperatura da GPU: placas NVIDIA com driver instalado.

## Chave e uso do Gemini

O Consultor usa o modelo **`gemini-3.5-flash-lite`** do Google Gemini. O nome do modelo aparece na tela do Consultor e nas Configurações; para trocar, altere `MODEL` em `aiAnalysis.py`.

**Como conseguir a chave:** acesse o [Google AI Studio](https://aistudio.google.com/app/apikey), clique em **Create API key** e copie a chave que começa com `AIza…`.

A chave digitada fica apenas na memória enquanto o Mallard está aberto e **nunca é gravada em disco**. Se quiser evitar digitá-la a cada execução, configure a variável de ambiente `GEMINI_API_KEY` antes de abrir o app.

O app mostra um indicador quando há uma chave preenchida e exibe apenas os seus últimos quatro caracteres (por exemplo, `termina em …a1B2`).

Cada clique em **Analisar meu computador** faz uma única solicitação ao Gemini: o app não repete chamadas automaticamente nem chama a IA em segundo plano. Se a API retornar limite de uso (`429`), o Mallard informa o tempo de espera fornecido pelo Google e só libera o botão **Tentar de novo** depois dele. O limite depende da cota atual do projeto e do modelo.

Ao pedir uma análise, os componentes detectados e as respostas do Consultor são enviados ao Gemini. A coleta e o monitoramento de hardware acontecem localmente.

O app **não consulta preços em tempo real**. Os botões de pesquisa abrem resultados de busca; eles não são cotações. Confirme preço, estoque, vendedor e compatibilidade na loja antes de comprar.

## Como funciona por dentro

- **Interface:** HTML, CSS e JavaScript na pasta `ui/`, dentro de uma janela PyWebview. O JavaScript chama as funções Python direto pela ponte `js_api` (por exemplo, `await window.pywebview.api.get_metrics()`), sem servidor local nem portas.
- **Hardware:** `psutil` (uso), `wmi` (identificação das peças) e `pynvml` (GPU NVIDIA).
- **IA:** `google-genai`, com resposta em JSON validada pelo app (veredito, gargalo, nível antes e depois e recomendações). Erros viram códigos com uma tela própria: `sem_chave`, `chave_invalida`, `sem_conexao`, `limite`, `servico_indisponivel`, `resposta_invalida` e `desconhecido`.
- **Dados:** configurações e histórico ficam em `%APPDATA%\Mallard` (`config.json` e `historico.json`). A chave do Gemini nunca vai para esses arquivos.
- **Temas:** cada pato é um conjunto de variáveis CSS aplicado com uma classe no `<html>`.

## Estrutura do projeto

- `app.py` / `main.py`: ponto de entrada e a ponte `MallardApi` usada pela interface.
- `hardwareInfo.py` / `hardwareMonitoring.py`: leitura das peças e do uso.
- `pcHealth.py`: nível do PC e pontos de atenção.
- `hardwareGuide.py`: textos da aba Entenda seu PC.
- `aiAnalysis.py`: prompt, chamada ao Gemini e tratamento de erros.
- `analysisHistory.py` / `reportExport.py`: histórico e relatório em HTML.
- `settingsStore.py`: preferências salvas (inclui a abertura já vista e as ajudas já lidas).
- `upgradeSimulator.py`, `gameCheck.py`, `usageJournal.py`: Simulador, Vai rodar? e Diário.
- `diskCleanup.py`, `startupItems.py`, `batteryInfo.py`: Limpeza, Inicialização e Bateria (Windows).
- `runningPrograms.py`: lista de programas que mais usam memória no Monitor (e o botão Fechar, que só pede para o programa encerrar).
- `ui/`: interface (páginas em `ui/js/pages/`).

## Créditos

Feito por Eduardo Fleming Diniz, Pedro Vargas, [Nome 3], [Nome 4] e [Nome 5] como [disciplina / instituição].

Homenagem ao **Patinho Feio** (Escola Politécnica da USP, 1972).
