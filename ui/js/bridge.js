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
    const settings = { theme: "mallard", reduce_motion: false, unlocked_1972: false, tried_themes: [], manual_parts: {}, achievements: {}, onboarded: /skip-intro/.test(location.hash), help_seen: {} };
    let aiKey = "";
    const AI_MODEL = "gemini-3.5-flash-lite";
    const aiStatus = () => ({ has_key: !!aiKey, masked: aiKey.length >= 8 ? `…${aiKey.slice(-4)}` : "", from_env: false, model: AI_MODEL });
    let history = [];
    const metrics = { cpu: 47.7, ram: 93.8, temp: 58 };
    let cleanJob = null;
    const startupItems = [
      { id: "user:Discord", name: "Discord", hint: "Chat e voz. Abre sozinho e fica na bandeja.", impact: "Alto", seconds: 6, memory_mb: 310, enabled: true, locked: false, suggest: true, source: "Registro" },
      { id: "user:Spotify", name: "Spotify", hint: "Música. Pode abrir só quando você quiser.", impact: "Médio", seconds: 3, memory_mb: 190, enabled: true, locked: false, suggest: true, source: "Registro" },
      { id: "user:OneDrive", name: "OneDrive", hint: "Sincroniza arquivos com a nuvem da Microsoft.", impact: "Médio", seconds: 4, memory_mb: 120, enabled: true, locked: false, suggest: false, source: "Registro" },
      { id: "machine:SecurityHealth", name: "Segurança do Windows", hint: "Mantém o Defender ativo. Não mexa.", impact: "Baixo", seconds: 1, memory_mb: 20, enabled: true, locked: true, suggest: false, source: "Registro" },
    ];
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
      get_app_info: async () => ({ name: "Mallard", version: "2.0", os: "Windows 10 (exemplo)", ai_model: AI_MODEL }),
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
      get_ai_status: async () => aiStatus(),
      set_api_key: async (key) => { aiKey = String(key || "").trim(); return aiStatus(); },
      forget_api_key: async () => { aiKey = ""; return aiStatus(); },
      run_analysis: async (perfil, preferencias) => {
        await new Promise((r) => setTimeout(r, 3800));
        if (!aiKey) return { ok: false, error: "sem_chave", message: "" };
        if (/invalida/i.test(aiKey)) { aiKey = ""; return { ok: false, error: "chave_invalida", message: "" }; }
        if (/offline/i.test(aiKey)) return { ok: false, error: "sem_conexao", message: "" };
        if (/limite/i.test(aiKey)) return { ok: false, error: "limite", message: "O Gemini pediu para esperar pelo menos 45 s antes de tentar de novo.", retry_seconds: 45 };
        const first = history.length === 0;
        const entry = { id: Math.random().toString(16).slice(2, 14), data: new Date().toISOString().slice(0, 16), perfil, preferencias,
          pecas: { tipo_de_maquina: "desktop", processador: hardware.processador, placas_de_video: hardware.placas_de_video, placa_mae: hardware.placa_mae,
            memoria_total_gb: 7.8, memoria_uso_percent: 94.7, discos: hardware.discos_detalhes },
          resultado: JSON.parse(JSON.stringify(MOCK_RESULT)), feitos: MOCK_RESULT.recommendations.map(() => false) };
        history.unshift(entry);
        return { ok: true, entry, first };
      },
      get_history: async () => JSON.parse(JSON.stringify(history)),
      get_analysis: async (id) => JSON.parse(JSON.stringify(history.find((e) => e.id === id) || null)),
      set_upgrade_done: async (id, index, done) => {
        const entry = history.find((e) => e.id === id);
        if (!entry) return { entry: null, swan: false };
        entry.feitos[index] = !!done;
        const all = entry.feitos.every(Boolean);
        const firstSwan = all && !settings.achievements.cisne;
        if (firstSwan) settings.achievements.cisne = true;
        return { entry: JSON.parse(JSON.stringify(entry)), swan: all, first_swan: firstSwan };
      },
      delete_analysis: async (id) => { history = history.filter((e) => e.id !== id); return JSON.parse(JSON.stringify(history)); },
      export_report: async () => { alert("No app, aqui abre a janela para salvar o relatório."); return { ok: false }; },

      /* ---------- Telas novas (dados de exemplo; no app vêm dos módulos Python) ---------- */
      get_simulation_options: async () => [
        { key: "ram", name: "Memória RAM", opts: [{ name: "8 GB", note: "O que você tem", ram_gb: 8 }, { name: "16 GB", note: "2 × 8 GB", ram_gb: 16 }, { name: "32 GB", note: "2 × 16 GB", ram_gb: 32 }] },
        { key: "stor", name: "Armazenamento", opts: [{ name: "Só o C:", note: "236,7 GB, quase cheio", ssd_gb: 0, nvme: false }, { name: "+ SSD 500 GB", note: "SATA, na baia", ssd_gb: 500, nvme: false }, { name: "+ SSD 1 TB", note: "NVMe, encaixe M.2", ssd_gb: 1000, nvme: true }] },
        { key: "gpu", name: "Placa de vídeo", opts: [{ name: "A de hoje", note: "Não identificada", gpu_tier: null }, { name: "De entrada", note: "Jogos leves em 1080p", gpu_tier: 1 }, { name: "Intermediária", note: "Jogos atuais em 1080p", gpu_tier: 2 }] },
      ],
      simulate_upgrade: async (c) => {
        const ram = c.ram_gb && c.ram_gb > 8 ? c.ram_gb : null;
        const level = Math.min(4, 1 + (ram ? (ram >= 32 ? 2 : 1) : 0) + (c.ssd_gb ? 1 : 0) + (c.gpu_tier ? 1 : 0));
        const multi = (total) => clamp(Math.round(117 - 91.8 * (7.4 / total)), 5, 98);
        const checks = [];
        if (ram) checks.push("Confirme se a placa-mãe usa o mesmo tipo de memória (DDR3, DDR4 ou DDR5) e quantos slots estão livres.");
        if (c.nvme) checks.push("O SSD NVMe precisa de encaixe M.2, e a placa-mãe não foi identificada.");
        if (c.gpu_tier) checks.push("Confira a potência da fonte e o comprimento de placa que cabe no gabinete.");
        return { level, level_name: LEVEL_NAMES[level], level_today: 1, level_today_name: LEVEL_NAMES[1], changed: checks.length > 0 || c.ssd_gb > 0,
          impacts: [{ name: "Vários programas", before: multi(7.8), after: multi(ram || 7.8) }, { name: "Jogos", before: 25, after: 25 + (ram ? 8 : 0) + (c.gpu_tier ? 30 * c.gpu_tier : 0) + (c.nvme ? 4 : 0) },
            { name: "Espaço livre", before: 13, after: c.ssd_gb ? Math.round(100 * (30.5 + c.ssd_gb) / (236.7 + c.ssd_gb)) : 13 }], checks };
      },
      get_game_examples: async () => [{ key: "valorant", name: "Valorant" }, { key: "minecraft", name: "Minecraft" }, { key: "photoshop", name: "Adobe Photoshop" }, { key: "cyberpunk", name: "Cyberpunk 2077" }],
      check_game: async (q) => {
        const t = String(q || "").toLowerCase();
        const rows = (ramState) => [
          { part: "Memória RAM", s: ramState, state: ramState === "ok" ? "Passa" : ramState === "warn" ? "No limite" : "Abaixo do mínimo", you: "7,8 GB (0,4 GB livres)", need: "8 GB mínimo · 16 GB recomendado", scale: { max: 32, min: 8, rec: 16, val: 7.8, min_label: "8 GB", rec_label: "16 GB" } },
          { part: "Processador", s: "ok", state: "Passa", you: "6 núcleos", need: "4 núcleos", scale: null },
          { part: "Placa de vídeo", s: "unk", state: "Não identificada", you: "Não identificada", need: "GTX 1050 ou melhor", scale: null },
          { part: "Espaço em disco", s: "ok", state: "Passa", you: "30,5 GB livres", need: "20 GB", scale: null },
        ];
        if (/valorant/.test(t)) return { found: true, source: "lista", name: "Valorant", kind: "Jogo", noun: "jogo", score: 70, verdict: "Roda", color: "ok", duck: "pato", cta: { label: "Ver no Simulador", page: "simulator" }, rows: rows("ok") };
        if (/photoshop/.test(t)) return { found: true, source: "lista", name: "Adobe Photoshop", kind: "Programa", noun: "programa", score: 65, verdict: "No limite", color: "warn", duck: "patinho", cta: { label: "Ver no Simulador", page: "simulator" }, rows: rows("warn") };
        if (/cyberpunk/.test(t)) return { found: true, source: "lista", name: "Cyberpunk 2077", kind: "Jogo", noun: "jogo", score: 18, verdict: "Não roda bem", color: "crit", duck: "ovo", cta: { label: "Ver no Simulador", page: "simulator" }, rows: rows("crit") };
        if (/minecraft/.test(t)) return { found: true, source: "lista", name: "Minecraft", kind: "Jogo", noun: "jogo", score: 78, verdict: "Roda", color: "ok", duck: "pato", cta: null, rows: rows("ok") };
        return { found: false, query: String(q || "").trim() };
      },
      ask_game: async (q) => {
        await new Promise((r) => setTimeout(r, 1200));
        if (!aiKey) return { ok: false, error: "sem_chave", message: "Falta a chave do Gemini." };
        if (/limite/i.test(aiKey)) return { ok: false, error: "limite", message: "O limite gratuito foi atingido.", retry_seconds: 40 };
        if (/zzz/i.test(q)) return { ok: true, found: false, query: q };
        return { ok: true, found: true, source: "gemini", name: String(q).trim(), kind: "Jogo", noun: "jogo", score: 52, verdict: "No limite", color: "warn", duck: "patinho", cta: { label: "Ver no Simulador", page: "simulator" },
          rows: [{ part: "Memória RAM", s: "warn", state: "Abaixo do ideal", you: "7,8 GB", need: "8 GB mínimo · 16 GB recomendado", scale: { max: 32, min: 8, rec: 16, val: 7.8, min_label: "8 GB", rec_label: "16 GB" } }] };
      },
      get_journal: async (offset) => {
        const names = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"], full = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
        const moods = ["ok", "atento", "dificil", "travou", "dificil", "ok", null], peaks = [78, 88, 93, 98, 94, 76, 0];
        const days = names.map((label, i) => {
          const base = { date: `2026-10-${12 + i}`, label, full: full[i], short_date: `${12 + i}/10`, today: i === 5 && offset === 0, future: i === 6 && offset === 0 };
          if (base.future) return base;
          if (offset > 1 && i > 2) return { ...base, empty: true };
          return { ...base, mood: moods[i], peak: peaks[i], minutes: 300, story: moods[i] === "travou" ? "A memória encheu de vez com o Chrome aberto e o PC provavelmente travou 2 vezes. O pico foi de 98%." : "A memória ficou cheia por cerca de 2 h. Chegou a " + peaks[i] + "%: o PC fica lento, mas não chegou a travar.",
            tip: moods[i] === "ok" ? "Dias assim são o normal do seu PC. Ótimo!" : "Fechar o Chrome e abrir de novo costuma liberar a memória que ele segura.",
            events: moods[i] === "ok" ? [["09:10", "PC ligado, memória em 52%", "ok"]] : [["14:20", "A memória passou de 90%", "warn"], ["14:48", "O PC travou por alguns segundos", "crit"]] };
        });
        return { days, week_label: offset === 0 ? "nesta semana" : offset === 1 ? "na semana passada" : `há ${offset} semanas`, selected: 3, has_data: true, week_start: "2026-10-12",
          insights: [{ kind: "warn", title: "A memória enche por volta das 14h", text: "Em 3 dos últimos 5 dias a memória passou de 90% nesse horário.", action: { label: "Ver no Simulador", page: "simulator" } },
            { kind: "crit", title: "O PC travou 2 vezes", text: "Os travamentos aconteceram com a memória acima de 97%.", action: { label: "Ver o Monitor", page: "monitor" } }] };
      },
      get_startup: async () => ({ supported: true, base_seconds: 30, items: startupItems.map((i) => ({ ...i })) }),
      set_startup_enabled: async (id, enabled) => { const item = startupItems.find((i) => i.id === id); if (item && !item.locked) item.enabled = !!enabled; return { supported: true, base_seconds: 30, items: startupItems.map((i) => ({ ...i })) }; },
      get_battery: async () => ({ supported: !!/battery/.test(location.hash), percent: 64, plugged: false, design_wh: 48.0, full_wh: 37.4, cycles: 312, health_percent: 78, has_report: true,
        history: [{ label: "nov/2025", wh: 44.1 }, { label: "jan/2026", wh: 42.0 }, { label: "mar/2026", wh: 40.2 }, { label: "mai/2026", wh: 39.0 }, { label: "jul/2026", wh: 38.1 }, { label: "hoje", wh: 37.4 }],
        drain: [{ name: "chrome", percent: 46 }, { name: "Discord", percent: 22 }, { name: "Teams", percent: 14 }] }),
      open_power_settings: async () => true,
      scan_cleanup: async () => ({ supported: true, disk: { device: "C:", total_bytes: 236.7e9, used_bytes: 206.2e9, free_bytes: 30.5e9, percent: 87.1 },
        categories: [{ key: "tmp", name: "Arquivos temporários", desc: "Sobras de instalações. Os das últimas 24 h ficam.", review: false, bytes: 2.1e9, files: 1432 },
          { key: "upd", name: "Restos de atualizações", desc: "Instaladores de atualizações já aplicadas.", review: false, bytes: 3.4e9, files: 210 },
          { key: "cache", name: "Cache dos navegadores", desc: "Chrome, Edge e Brave recriam sozinhos.", review: false, bytes: 1.2e9, files: 8120 },
          { key: "bin", name: "Lixeira", desc: "Arquivos que você já apagou antes.", review: false, bytes: 0.8e9, files: 36 },
          { key: "dl", name: "Downloads com mais de 90 dias", desc: "Vão para a Lixeira: dá para recuperar.", review: true, bytes: 5.6e9, files: 73 }] }),
      start_cleanup: async (keys) => { cleanJob = { phase: "cleaning", progress: 0, current: "Arquivos temporários", freed: 0, per_key: {}, error: null, keys, t: Date.now() }; return { ...cleanJob }; },
      get_cleanup_status: async () => {
        if (!cleanJob) return { phase: "idle", progress: 0, current: "", freed: 0, per_key: {}, error: null };
        const p = Math.min(100, Math.round((Date.now() - cleanJob.t) / 25));
        if (p < 100) return { phase: "cleaning", progress: p, current: cleanJob.keys[Math.min(cleanJob.keys.length - 1, Math.floor(p / 34))], freed: 0, per_key: {}, error: null };
        const sizes = { tmp: 2.1e9, upd: 3.4e9, cache: 1.2e9, bin: 0.8e9, dl: 5.6e9 };
        const per = Object.fromEntries(cleanJob.keys.map((k) => [k, { freed: sizes[k], files: 100, skipped: k === "tmp" ? 3 : 0 }]));
        const freed = cleanJob.keys.reduce((s, k) => s + sizes[k], 0);
        const first = !settings.achievements.ninho && freed > 6e9;
        if (first) settings.achievements.ninho = true;
        return { phase: "done", progress: 100, current: "", freed, per_key: per, error: null, first_ninho: first, disk: { device: "C:", total_bytes: 236.7e9, used_bytes: 206.2e9 - freed, free_bytes: 30.5e9 + freed, percent: Math.round(1000 * (206.2e9 - freed) / 236.7e9) / 10 } };
      },
      reset_cleanup: async () => { cleanJob = null; return { phase: "idle", progress: 0, current: "", freed: 0, per_key: {}, error: null }; },
    };
  }

  return { call, isMock: () => usingMock };
})();
