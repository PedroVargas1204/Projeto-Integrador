/* Ponte com o Python.
   Dentro do app, o PyWebview cria window.pywebview.api com os métodos de MallardApi (main.py).
   Aberta num navegador comum, a interface usa dados de exemplo para dar para testar o visual. */
const Bridge = (() => {
  let resolveApi;
  const apiReady = new Promise((resolve) => { resolveApi = resolve; });
  let usingMock = false;

  window.addEventListener("pywebviewready", () => resolveApi(window.pywebview.api));
  setTimeout(() => {
    if (!window.pywebview) {
      usingMock = true;
      resolveApi(createMockApi());
    }
  }, 900);

  async function call(name, ...args) {
    const api = await apiReady;
    if (!api[name]) throw new Error(`Função ${name} não existe na ponte.`);
    return api[name](...args);
  }

  function createMockApi() {
    const hardware = JSON.parse(JSON.stringify(MOCK_DATA.hardware));
    const settings = { theme: "mallard", reduce_motion: false, unlocked_1972: false, tried_themes: [], manual_parts: {} };
    const metrics = { cpu: 47.7, ram: 93.8, temp: 58 };
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const unknown = (v) => !v || String(v).toLowerCase().startsWith("não identificado");

    function withManual() {
      const hw = JSON.parse(JSON.stringify(hardware));
      hw.informado_manualmente = {};
      if (settings.manual_parts.gpu) { hw.placas_de_video = settings.manual_parts.gpu; hw.informado_manualmente.gpu = true; }
      if (settings.manual_parts.mb) { hw.placa_mae = settings.manual_parts.mb; hw.informado_manualmente.mb = true; }
      hw.processador_parcial = /family/i.test(hw.processador);
      hw.nivel = { index: 1, name: "Patinho", text: "Dá conta do dia a dia, mas alguma peça está segurando o resto.", next_hint: "Mais memória RAM (16 GB) é o passo que mais ajuda a subir de nível." };
      const missing = [];
      if (unknown(hw.placas_de_video)) missing.push("placa de vídeo");
      if (unknown(hw.placa_mae)) missing.push("placa-mãe");
      hw.pontos_de_atencao = [
        { kind: "warn", title: "Memória quase cheia", text: "94,7% de 7,8 GB em uso. Isso costuma causar travamentos ao abrir vários programas juntos.", action: { label: "Ver no monitoramento", page: "monitor" } },
        { kind: "warn", title: "Disco C: com pouco espaço", text: "87,1% usado: restam 30,5 GB de 236,7 GB. Abaixo de 15% livre o Windows fica mais lento.", action: { label: "Entender o armazenamento", page: "guide", part: "disk" } },
      ];
      if (missing.length) hw.pontos_de_atencao.push({ kind: "info", title: missing.length === 1 ? "1 peça não identificada" : `${missing.length} peças não identificadas`, text: `Informe o modelo da ${missing.join(" e da ")} para o consultor recomendar upgrades com segurança.`, action: null });
      return hw;
    }

    return {
      get_app_info: async () => ({ name: "Mallard", version: "2.0", os: "Windows 10 (exemplo)" }),
      get_settings: async () => ({ ...settings }),
      save_settings: async (changes) => { Object.assign(settings, changes); return { ...settings }; },
      get_hardware: async () => new Promise((r) => setTimeout(() => r(withManual()), 500)),
      set_manual_part: async (part, model) => {
        if (model && model.trim()) settings.manual_parts[part] = model.trim(); else delete settings.manual_parts[part];
        return withManual();
      },
      get_metrics: async () => {
        metrics.cpu = clamp(metrics.cpu + (Math.random() * 2 - 1) * 10, 6, 97);
        metrics.ram = clamp(metrics.ram + (Math.random() * 2 - 1) * 0.6, 91, 96.5);
        return {
          time: new Date().toLocaleTimeString("pt-BR"),
          cpu: Math.round(metrics.cpu * 10) / 10,
          ram: { percent: Math.round(metrics.ram * 10) / 10, used_gb: Math.round(7.8 * metrics.ram) / 100, total_gb: 7.8 },
          gpu: { usage: null, temp: null, name: null, note: "GPU não suportada por este provedor" },
          disk: { device: "C:", percent: 87.1, free_gb: 30.5, total_gb: 236.7 },
        };
      },
      get_guide: async () => {
        const mine = {
          cpu: { value: hardware.processador, note: "6 núcleos e 6 threads. O Windows informou só a família do processador; o modelo exato não apareceu.", warn: false, marks: { cpu_cores: 2 }, mark_notes: { cpu_cores: "Seu PC: 6 núcleos." } },
          ram: { value: "7,8 GB · 94,7% em uso", note: "Sua bancada está quase lotada. É comum isso causar travamentos. Aparece 7,8 GB e não 8 GB porque uma parte fica reservada para o sistema e o vídeo integrado.", warn: true, marks: { ram_total: 1 }, mark_notes: { ram_total: "Seu PC: 7,8 GB." } },
          gpu: { value: settings.manual_parts.gpu || "Não identificada", note: "Se não houver uma placa separada, quem desenha a tela é o vídeo integrado do processador, que é bem mais simples.", warn: false, marks: {}, mark_notes: {} },
          disk: { value: "Disco C: 236,7 GB · 87,1% usado", note: "Sobram 30,5 GB. Uma despensa lotada deixa o Windows mais lento para atualizar e organizar arquivos.", warn: true, marks: { disk_free: 0 }, mark_notes: { disk_free: "Seu PC: 12,9% livre no disco C.", disk_type: "Esta leitura não informa se o seu disco é SSD ou HD." } },
          mb: { value: settings.manual_parts.mb || "Não identificada", note: "Ela define o que é compatível com o seu PC. Confira o modelo antes de comprar memória ou processador.", warn: false, marks: {}, mark_notes: {} },
          psu: { value: "Não dá para ler pelo Windows", note: "O modelo e a potência ficam numa etiqueta na lateral da fonte, dentro do gabinete.", warn: false, marks: {}, mark_notes: { psu_watts: "Anote a potência da etiqueta e informe no Consultor de upgrades." } },
        };
        return { parts: MOCK_DATA.parts, glossary: MOCK_DATA.glossary, mine };
      },
      open_url: async (url) => { window.open(url, "_blank"); return true; },
    };
  }

  return { call, isMock: () => usingMock };
})();
