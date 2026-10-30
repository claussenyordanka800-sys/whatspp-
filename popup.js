const DEFAULT_PROVIDER_ORDER = ["google", "microsoft", "deepseek", "grok", "deepl", "openai", "doubao", "gemini", "custom"];
const LEGACY_PROVIDER_ORDER = ["volcano", "deepl", "openai", "deepseek", "doubao", "gemini", "custom", "google"];
const REMOVED_PROVIDERS = new Set(["volcano"]);

const DEEPSEEK_MODELS = [
  { id: "deepseek-flash", name: "deepseek-flash" },
  { id: "deepseek-v4-pro", name: "deepseek-v4-pro" }
];

const DEFAULT_SETTINGS = {
  enabled: true,
  provider: "google",
  providerOrder: DEFAULT_PROVIDER_ORDER,
  providerEnabled: {
    google: true,
    microsoft: true,
    deepseek: true,
    grok: false,
    deepl: false,
    openai: false,
    doubao: false,
    gemini: false,
    custom: false
  },
  receiveLanguage: "zh-CN",
  sendLanguage: "en",
  autoReceive: true,
  autoSend: false,
  autoDetectLanguage: true,
  sendTrigger: "enter",
  forbidChinese: false,
  translationColor: "#a127b8",
  translationSize: "default",
  providers: {
    google: { baseUrl: "https://translate.googleapis.com" },
    microsoft: {
      authUrl: "https://edge.microsoft.com/translate/auth",
      baseUrl: "https://api-edge.cognitive.microsofttranslator.com/translate"
    },
    deepseek: { apiKey: "", baseUrl: "https://api.deepseek.com", model: "deepseek-flash", models: DEEPSEEK_MODELS },
    grok: { apiKey: "", baseUrl: "https://api.x.ai/v1", model: "grok-4.5" },
    deepl: { apiKey: "", baseUrl: "https://api-free.deepl.com/v2", model: "translate" },
    openai: { apiKey: "", baseUrl: "https://api.openai.com/v1", model: "" },
    doubao: { apiKey: "", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "" },
    gemini: { apiKey: "", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-flash" },
    custom: { apiKey: "", baseUrl: "http://127.0.0.1:8000/v1", model: "" }
  }
};

const PROVIDERS = {
  google: { name: "谷歌翻译", desc: "免密钥，速度快", type: "free" },
  microsoft: { name: "微软翻译", desc: "免密钥，长文本备用", type: "free" },
  deepseek: { name: "DeepSeek", desc: "DeepSeek 大语言模型", type: "openai" },
  grok: { name: "Grok", desc: "xAI 官方 OpenAI 兼容接口", type: "openai" },
  deepl: { name: "DeepL", desc: "高质量机器翻译", type: "deepl" },
  openai: { name: "OpenAI", desc: "OpenAI 兼容大语言模型", type: "openai" },
  doubao: { name: "豆包", desc: "火山方舟 OpenAI 兼容接口", type: "openai" },
  gemini: { name: "Gemini", desc: "谷歌 Gemini 接口", type: "gemini" },
  custom: { name: "第三方 API", desc: "本地或第三方 OpenAI 兼容接口", type: "openai" }
};

const PROVIDER_ICONS = {
  google: "G",
  microsoft: "M",
  deepseek: "DS",
  grok: "G",
  deepl: "D",
  openai: "AI",
  doubao: "豆",
  gemini: "✦",
  custom: "API"
};

const PROVIDER_LOGOS = {
  google: "assets/logos/google.svg",
  deepseek: "assets/logos/deepseek.svg",
  grok: "assets/logos/grok.svg",
  deepl: "assets/logos/deepl.svg",
  openai: "assets/logos/openai.svg",
  doubao: "assets/logos/doubao.svg",
  gemini: "assets/logos/gemini.svg",
  custom: "assets/logos/custom.svg"
};

const LANGUAGES = [
  ["zh-CN", "中文(简体)"],
  ["zh-TW", "中文(繁体)"],
  ["en", "英语"],
  ["es", "西班牙语"],
  ["pt", "葡萄牙语"],
  ["fr", "法语"],
  ["de", "德语"],
  ["it", "意大利语"],
  ["ar", "阿拉伯语"],
  ["ru", "俄语"],
  ["ja", "日语"],
  ["ko", "韩语"],
  ["vi", "越南语"],
  ["th", "泰语"],
  ["id", "印尼语"],
  ["tr", "土耳其语"],
  ["hi", "印地语"]
];

const topLevelFields = [
  "sendAfterTranslate",
  "translationPrompt",
  "enabled",
  "receiveLanguage",
  "sendLanguage",
  "autoReceive",
  "autoDetectLanguage",
  "forbidChinese",
  "translationColor",
  "translationSize"
];

if (globalThis.WAChatTools) {
  const names = new Intl.DisplayNames(['zh-CN'], { type: 'language' });
  for (const code of WAChatTools.languageCodes) {
    if (!LANGUAGES.some(([value]) => value === code)) LANGUAGES.push([code, names.of(code)]);
  }
}

const DIAG_KEY = "wbtDiagLog";
const DIAG_LEVEL_LABELS = { error: "错误", warn: "警告", info: "信息" };

const state = {
  expandedProvider: "",
  draggingProvider: "",
  settings: null,
  engineSession: 0,
  providerRequests: new Map(),
  saveQueue: Promise.resolve(),
  diagEntries: []
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  fillLanguageSelect("receiveLanguage");
  fillLanguageSelect("sendLanguage");
  state.settings = await loadSettings();
  renderSettings();
  bindEvents();
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get("settings");
  return migrateSettings(stored.settings || {});
}

function migrateSettings(settings) {
  const merged = structuredClone(DEFAULT_SETTINGS);
  Object.assign(merged, settings);
  merged.providerOrder = normalizeProviderOrder(settings.providerOrder);
  merged.providerEnabled = { ...DEFAULT_SETTINGS.providerEnabled, ...(settings.providerEnabled || {}) };
  merged.providers = { ...DEFAULT_SETTINGS.providers, ...(settings.providers || {}) };
  for (const provider of DEFAULT_PROVIDER_ORDER) merged.providers[provider] = { ...DEFAULT_SETTINGS.providers[provider], ...merged.providers[provider] };
  for (const provider of REMOVED_PROVIDERS) {
    delete merged.providerEnabled[provider];
    delete merged.providers[provider];
  }

  if (settings.deepseekApiKey || settings.deepseekBaseUrl || settings.deepseekModel) {
    const explicit = settings.providers?.deepseek || {};
    merged.providers.deepseek = {
      ...merged.providers.deepseek,
      apiKey: Object.hasOwn(explicit, 'apiKey') ? explicit.apiKey : settings.deepseekApiKey || merged.providers.deepseek.apiKey,
      baseUrl: Object.hasOwn(explicit, 'baseUrl') ? explicit.baseUrl : settings.deepseekBaseUrl || merged.providers.deepseek.baseUrl,
      model: Object.hasOwn(explicit, 'model') ? explicit.model : settings.deepseekModel || merged.providers.deepseek.model
    };
  }
  if (settings.customApiKey || settings.customBaseUrl || settings.customModel) {
    const explicit = settings.providers?.custom || {};
    merged.providers.custom = {
      ...merged.providers.custom,
      apiKey: Object.hasOwn(explicit, 'apiKey') ? explicit.apiKey : settings.customApiKey || merged.providers.custom.apiKey,
      baseUrl: Object.hasOwn(explicit, 'baseUrl') ? explicit.baseUrl : settings.customBaseUrl || merged.providers.custom.baseUrl,
      model: Object.hasOwn(explicit, 'model') ? explicit.model : settings.customModel || merged.providers.custom.model
    };
  }

  merged.providers.deepseek = {
    ...DEFAULT_SETTINGS.providers.deepseek,
    ...(merged.providers.deepseek || {}),
    baseUrl: normalizeDeepSeekBaseUrl(merged.providers.deepseek?.baseUrl),
    model: merged.providers.deepseek?.model || "deepseek-flash",
    models: mergeModels(DEEPSEEK_MODELS, merged.providers.deepseek?.models)
  };
  if (merged.sendTrigger === "manual") {
    merged.sendTrigger = "enter";
    merged.autoSend = false;
  }
  ensureProviderSelection(merged);
  return merged;
}

function renderSettings() {
  ensureProviderSelection();
  for (const field of topLevelFields) {
    const element = document.getElementById(field);
    if (!element) continue;
    element[element.type === "checkbox" ? "checked" : "value"] = element.type === "checkbox"
      ? Boolean(state.settings[field])
      : state.settings[field] ?? "";
  }

  const trigger = state.settings.sendTrigger === "typing" ? "typing" : "enter";
  const radio = document.querySelector(`input[name="sendTrigger"][value="${trigger}"]`);
  if (radio) radio.checked = true;

  renderProviderSelect();
  renderProviders();
}

function renderProviderSelect() {
  renderAIStatus();
  const select = document.getElementById("provider");
  const enabledProviders = getEnabledProviders();
  select.textContent = "";

  if (!enabledProviders.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "没有可用引擎";
    select.appendChild(option);
    select.disabled = true;
    renderMainProviderPicker();
    return;
  }

  select.disabled = false;
  for (const provider of enabledProviders) {
    const option = document.createElement("option");
    option.value = provider;
    option.textContent = PROVIDERS[provider]?.name || provider;
    select.appendChild(option);
  }
  select.value = state.settings.provider;
  renderMainProviderPicker();
}

function renderAIStatus() {
  const element = document.getElementById('aiProviderStatus');
  if (!element) return;
  const ready = getEnabledProviders().filter(provider => {
    const config = state.settings.providers[provider] || {};
    return ['openai', 'gemini'].includes(PROVIDERS[provider]?.type) && config.baseUrl?.trim() && config.model?.trim() && (provider === 'custom' || config.apiKey?.trim());
  });
  element.textContent = ready.length ? `已配置 AI：${ready.map(provider => PROVIDERS[provider].name).join('、')}` : 'AI 尚未就绪：请在引擎设置中启用 AI 引擎，并填写密钥、地址和模型。';
}

function renderMainProviderPicker() {
  const provider = state.settings.provider;
  const meta = PROVIDERS[provider];
  const logoWrap = document.getElementById("providerLogoMain");
  const name = document.getElementById("providerNameMain");
  const badge = document.getElementById("providerBadgeMain");
  if (!logoWrap || !name || !badge) return;

  logoWrap.className = `provider-picker-logo provider-logo-${provider || "custom"}`;
  logoWrap.textContent = "";
  const logo = PROVIDER_LOGOS[provider];
  if (logo) {
    const img = document.createElement("img");
    img.src = logo;
    img.alt = "";
    logoWrap.appendChild(img);
  } else {
    logoWrap.textContent = PROVIDER_ICONS[provider] || "●";
  }
  name.textContent = meta?.name || "没有可用引擎";
  badge.textContent = provider === "google" ? "（推荐）" : "";
}

function renderProviders() {
  const list = document.getElementById("providerList");
  const template = document.getElementById("providerTemplate");
  list.textContent = "";

  for (const provider of state.settings.providerOrder) {
    const meta = PROVIDERS[provider];
    if (!meta) continue;

    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.provider = provider;
    card.draggable = false;
    card.classList.toggle("is-open", state.expandedProvider === provider);
    const icon = card.querySelector(".provider-icon");
    if (icon) {
      icon.className = `provider-icon provider-logo-${provider}`;
      const logo = PROVIDER_LOGOS[provider];
      icon.textContent = "";
      if (logo) {
        const img = document.createElement("img");
        img.src = logo;
        img.alt = "";
        icon.appendChild(img);
      } else {
        icon.textContent = PROVIDER_ICONS[provider] || "●";
      }
    }
    const dragHandle = card.querySelector(".drag-handle");
    if (dragHandle) {
      dragHandle.draggable = true;
    }
    card.querySelector(".provider-title strong").textContent = meta.name;
    card.querySelector(".provider-title .provider-tag").textContent = meta.desc;
    const preferred = card.querySelector(".provider-preferred");
    if (preferred) {
      preferred.checked = state.settings.provider === provider;
    }
    card.querySelector(".provider-enabled").checked = Boolean(state.settings.providerEnabled[provider]);

    const settingsButton = card.querySelector(".settings-provider");
    settingsButton.hidden = meta.type === "free";

    const config = card.querySelector(".provider-config");
    renderProviderConfig(provider, config);
    config.hidden = state.expandedProvider !== provider;

    list.appendChild(card);
    const pending = state.providerRequests.get(provider);
    if (pending && isProviderRequestCurrent(provider, pending)) {
      card.querySelectorAll('.fetch-models, .test-provider').forEach(button => { button.disabled = true; });
      setProviderStatus(card, pending.label, '');
    }
  }
}

function renderProviderConfig(provider, root) {
  const meta = PROVIDERS[provider];
  const config = state.settings.providers[provider] || {};

  if (meta.type === "free") {
    root.innerHTML = "";
    return;
  }

  const modelOptions = (config.models || [])
    .map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.name || model.id)}</option>`)
    .join("");
  const canFetchModels = meta.type !== "deepl";

  root.innerHTML = `
    <label>
      密钥
      <input class="provider-input" data-key="apiKey" type="password" autocomplete="off" value="${escapeHtml(config.apiKey || "")}" placeholder="${provider === "custom" ? "本地接口可留空" : "请输入密钥"}">
    </label>
    <label>
      接口地址
      <input class="provider-input" data-key="baseUrl" type="url" value="${escapeHtml(config.baseUrl || "")}">
    </label>
    <label>
      模型
      <div class="model-row">
        <input class="provider-input model-input" data-key="model" type="text" value="${escapeHtml(config.model || "")}" placeholder="先获取模型，或手动填写">
        <select class="model-select">
          <option value="">选择模型</option>
          ${modelOptions}
        </select>
      </div>
    </label>
    <div class="config-actions">
      <button class="secondary fetch-models" type="button" ${canFetchModels ? "" : "hidden"}>获取模型</button>
    </div>
  `;

  const select = root.querySelector(".model-select");
  select.value = config.model || "";
  select.addEventListener("change", () => {
    if (!select.value) return;
    root.querySelector(".model-input").value = select.value;
    updateProviderConfig(provider, "model", select.value);
  });
}

function bindEvents() {
  document.getElementById("save").addEventListener("click", async () => {
    collectSettingsFromDom();
    await saveSettings(true);
  });

  document.getElementById("saveEngineSettings").addEventListener("click", async () => {
    if (state.engineSaving) return;
    collectSettingsFromDom();
    const session = state.engineSession;
    const controls = [...document.querySelectorAll('#engineModal input, #engineModal select, #engineModal button')].map(element => [element, element.disabled]);
    state.engineSaving = true;
    document.getElementById('engineModal').setAttribute('aria-busy', 'true');
    controls.forEach(([element]) => { element.disabled = true; });
    showSaveStatus('正在保存…');
    let saved;
    try { saved = await saveSettings(true); }
    finally {
      state.engineSaving = false;
      document.getElementById('engineModal').removeAttribute('aria-busy');
      controls.forEach(([element, disabled]) => { element.disabled = disabled; });
    }
    if (saved && state.engineSession === session) closeEngineSettings(true);
  });
  document.getElementById("openEngineSettings").addEventListener("click", openEngineSettings);
  document.getElementById("closeEngineSettings").addEventListener("click", closeEngineSettings);
  document.getElementById("cancelEngineSettings").addEventListener("click", closeEngineSettings);

  document.getElementById("provider").addEventListener("change", async (event) => {
    state.settings.provider = event.target.value;
    if (await saveSettings(false)) showSaveStatus("已自动保存");
  });

  document.querySelectorAll("main input, main select, main textarea").forEach((element) => {
    if (element.id === "provider") return;
    element.addEventListener("change", async () => {
      collectSettingsFromDom();
      if (await saveSettings(false)) showSaveStatus("已自动保存");
    });
  });

  document.getElementById("providerList").addEventListener("click", handleProviderClick);
  document.getElementById("providerList").addEventListener("change", handleProviderChange);
  document.getElementById("providerList").addEventListener("input", handleProviderInput);
  document.getElementById("providerList").addEventListener("dragstart", handleProviderDragStart);
  document.getElementById("providerList").addEventListener("dragover", handleProviderDragOver);
  document.getElementById("providerList").addEventListener("drop", handleProviderDrop);
  document.getElementById("providerList").addEventListener("dragend", handleProviderDragEnd);
  document.getElementById("openDiagLog").addEventListener("click", openDiagLog);
  document.getElementById("closeDiagLog").addEventListener("click", closeDiagLog);
  document.getElementById("diagLevel").addEventListener("change", renderDiagList);
  document.getElementById("copyDiagLog").addEventListener("click", copyDiagLog);
  document.getElementById("clearDiagLog").addEventListener("click", clearDiagLog);
  document.getElementById("diagModal").addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDiagLog();
  });
  chrome.storage?.onChanged?.addListener?.((changes, area) => {
    if (area !== "local" || !Object.prototype.hasOwnProperty.call(changes, DIAG_KEY)) return;
    if (document.getElementById("diagModal")?.hidden) return;
    state.diagEntries = Array.isArray(changes[DIAG_KEY].newValue) ? changes[DIAG_KEY].newValue : [];
    renderDiagList();
  });
}
function collectSettingsFromDom() {
  for (const field of topLevelFields) {
    const element = document.getElementById(field);
    if (!element) continue;
    state.settings[field] = element.type === "checkbox" ? element.checked : element.value;
  }
  const providerSelect = document.getElementById("provider");
  if (!providerSelect.disabled && providerSelect.value) {
    state.settings.provider = providerSelect.value;
  }
  state.settings.sendTrigger = document.querySelector('input[name="sendTrigger"]:checked')?.value || "enter";
  state.settings.autoSend = state.settings.sendTrigger === "typing";
  ensureProviderSelection();
}

async function handleProviderChange(event) {
  const card = event.target.closest(".provider-card");
  if (!card) return;
  const provider = card.dataset.provider;

  if (event.target.classList.contains("provider-enabled")) {
    state.settings.providerEnabled[provider] = event.target.checked;
    ensureProviderSelection();
    renderProviderSelect();
    showSaveStatus("已修改，请保存");
    return;
  }

  if (event.target.classList.contains("provider-input")) {
    updateProviderConfig(provider, event.target.dataset.key, event.target.value.trim());
  }
}

function handleProviderInput(event) {
  const card = event.target.closest(".provider-card");
  if (!card || !event.target.classList.contains("provider-input")) return;
  updateProviderConfig(card.dataset.provider, event.target.dataset.key, event.target.value.trim(), false);
}

async function handleProviderClick(event) {
  const card = event.target.closest(".provider-card");
  if (!card) return;
  const provider = card.dataset.provider;

  if (event.target.classList.contains("settings-provider")) {
    state.expandedProvider = state.expandedProvider === provider ? "" : provider;
    renderProviders();
    document.querySelector(`[data-provider="${provider}"]`)?.scrollIntoView?.({ block: 'start' });
    return;
  }
  if (event.target.classList.contains("fetch-models")) {
    await fetchModels(provider, card);
    return;
  }
  if (event.target.classList.contains("test-provider")) {
    await testProvider(provider, card);
  }
}

function updateProviderConfig(provider, key, value, markDirty = true) {
  if (state.settings.providers[provider]?.[key] !== value && state.providerRequests.has(provider)) {
    state.providerRequests.delete(provider);
    const card = document.querySelector(`[data-provider="${provider}"]`);
    card?.querySelectorAll('.fetch-models, .test-provider').forEach(button => { button.disabled = false; });
    setProviderStatus(card, '配置已修改，请重新测试', '');
  }
  state.settings.providers[provider] = {
    ...(state.settings.providers[provider] || {}),
    [key]: value
  };
  if (markDirty) showSaveStatus("已修改");
}

function moveProviderTo(sourceProvider, targetProvider) {
  if (!sourceProvider || !targetProvider || sourceProvider === targetProvider) {
    return;
  }
  const order = state.settings.providerOrder;
  const sourceIndex = order.indexOf(sourceProvider);
  const targetIndex = order.indexOf(targetProvider);
  if (sourceIndex < 0 || targetIndex < 0) {
    return;
  }
  order.splice(sourceIndex, 1);
  order.splice(targetIndex, 0, sourceProvider);
  renderProviders();
  renderProviderSelect();
  showSaveStatus("已修改");
}

function handleProviderDragStart(event) {
  const card = event.target.closest(".provider-card");
  if (!card) return;
  state.draggingProvider = card.dataset.provider || "";
  card.classList.add("is-dragging");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", state.draggingProvider);
  }
}

function handleProviderDragOver(event) {
  const card = event.target.closest(".provider-card");
  if (!card || !state.draggingProvider) return;
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
}

function handleProviderDrop(event) {
  const card = event.target.closest(".provider-card");
  if (!card || !state.draggingProvider) return;
  event.preventDefault();
  moveProviderTo(state.draggingProvider, card.dataset.provider || "");
}

function handleProviderDragEnd() {
  state.draggingProvider = "";
  document.querySelectorAll(".provider-card.is-dragging").forEach((card) => {
    card.classList.remove("is-dragging");
  });
}

async function fetchModels(provider, card) {
  if (state.providerRequests.has(provider)) return;
  collectCardConfig(provider, card);
  const request = beginProviderRequest(provider, '读取中...');
  setProviderStatus(card, "读取中...", "");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "listModels",
      provider,
      config: state.settings.providers[provider]
    });
    if (!isProviderRequestCurrent(provider, request)) return;
    if (!response?.ok) throw new Error(response?.error || "读取失败");

    state.settings.providers[provider].models = provider === "deepseek" && response.fallback
      ? mergeModels(DEEPSEEK_MODELS, response.models)
      : response.models || [];
    if (provider === "deepseek") {
      state.settings.providers[provider].baseUrl = normalizeDeepSeekBaseUrl(state.settings.providers[provider].baseUrl);
    }
    if (!state.settings.providers[provider].model && state.settings.providers[provider].models?.[0]?.id) {
      state.settings.providers[provider].model = state.settings.providers[provider].models[0].id;
    }

    renderProviders();
    const newCard = document.querySelector(`[data-provider="${provider}"]`);
    const count = state.settings.providers[provider].models.length;
    setProviderStatus(newCard, response.fallback ? `已补充 ${count} 个内置候选模型，请测试接口确认可用性` : `接口返回 ${count} 个模型`, response.fallback ? '' : "ok");
    showSaveStatus("已修改");
  } catch (error) {
    if (isProviderRequestCurrent(provider, request)) setProviderStatus(document.querySelector(`[data-provider="${provider}"]`), formatProviderError(error), "bad");
  } finally {
    endProviderRequest(provider, request);
  }
}

async function testProvider(provider, card) {
  if (state.providerRequests.has(provider)) return;
  collectCardConfig(provider, card);
  const request = beginProviderRequest(provider, '测试中...');
  setProviderStatus(card, "测试中...", "");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "testProvider",
      provider,
      config: state.settings.providers[provider],
      translationPrompt: document.getElementById('translationPrompt').value,
      targetLanguage: state.settings.receiveLanguage || "zh-CN"
    });
    if (!isProviderRequestCurrent(provider, request)) return;
    if (!response?.ok) throw new Error(response?.error || "测试失败");
    if (response.config) {
      state.settings.providers[provider] = {
        ...(state.settings.providers[provider] || {}),
        ...response.config
      };
      renderProviders();
      card = document.querySelector(`[data-provider="${provider}"]`) || card;
    }
    setProviderStatus(card, `通过: ${response.text || "OK"}`, "ok");
  } catch (error) {
    if (isProviderRequestCurrent(provider, request)) setProviderStatus(document.querySelector(`[data-provider="${provider}"]`), formatProviderError(error), "bad");
  } finally {
    endProviderRequest(provider, request);
  }
}

function beginProviderRequest(provider, label) {
  const request = { session: state.engineSession, signature: JSON.stringify(state.settings.providers[provider]), label };
  state.providerRequests.set(provider, request);
  const card = document.querySelector(`[data-provider="${provider}"]`);
  card?.querySelectorAll('.fetch-models, .test-provider').forEach(button => { button.disabled = true; });
  return request;
}

function isProviderRequestCurrent(provider, request) {
  return state.providerRequests.get(provider) === request && request.session === state.engineSession && request.signature === JSON.stringify(state.settings.providers[provider]);
}

function endProviderRequest(provider, request) {
  if (state.providerRequests.get(provider) !== request) return;
  state.providerRequests.delete(provider);
  document.querySelector(`[data-provider="${provider}"]`)?.querySelectorAll('.fetch-models, .test-provider').forEach(button => { button.disabled = false; });
}

function formatProviderError(error) {
  const message = String(error?.message || error || '接口操作失败');
  if (/extension context invalidated|receiving end does not exist|could not establish connection/i.test(message)) return '扩展连接失效，请关闭设置页并重新加载扩展后重试';
  if (/failed to fetch|fetch failed|networkerror/i.test(message)) return '无法连接接口，请检查网络、代理和接口地址';
  return message;
}

function collectCardConfig(provider, card) {
  card.querySelectorAll(".provider-input").forEach((input) => {
    updateProviderConfig(provider, input.dataset.key, input.value.trim(), false);
  });
}

async function saveSettings(showSuccess) {
  ensureProviderSelection();
  // Model catalogues can exceed storage.sync's per-item quota; they are UI suggestions, not configuration.
  const settings = structuredClone(state.settings);
  for (const config of Object.values(settings.providers)) delete config.models;
  const save = state.saveQueue.catch(() => {}).then(() => chrome.storage.sync.set({ settings }));
  state.saveQueue = save;
  try { await save; }
  catch (error) { showSaveStatus(`保存失败：${formatProviderError(error)}`); return false; }
  renderProviderSelect();
  if (showSuccess) {
    showSaveStatus("已保存");
  }
  return true;
}

function openEngineSettings() {
  if (state.engineSaving) return;
  state.engineSession += 1;
  state.providerRequests.clear();
  state.engineSnapshot = structuredClone(state.settings);
  renderProviders();
  document.getElementById("engineModal").hidden = false;
  document.body.classList.add('modal-open');
  document.getElementById('closeEngineSettings').focus();
}

function closeEngineSettings(saved = false) {
  if (state.engineSaving) return;
  state.engineSession += 1;
  state.providerRequests.clear();
  if (saved !== true && state.engineSnapshot) state.settings = state.engineSnapshot;
  state.engineSnapshot = null;
  state.expandedProvider = "";
  document.getElementById("engineModal").hidden = true;
  document.body.classList.remove('modal-open');
  document.getElementById('openEngineSettings').focus();
  renderProviders();
  renderProviderSelect();
}

function getEnabledProviders(settings = state.settings) {
  return (settings.providerOrder || DEFAULT_PROVIDER_ORDER).filter((provider) => settings.providerEnabled?.[provider]);
}

function ensureProviderSelection(settings = state.settings) {
  const enabledProviders = getEnabledProviders(settings);
  if (!enabledProviders.length) {
    settings.provider = "";
    return;
  }
  if (!settings.provider || !settings.providerEnabled?.[settings.provider] || !enabledProviders.includes(settings.provider)) {
    settings.provider = enabledProviders[0];
  }
}

function setProviderStatus(card, text, type) {
  const status = card?.querySelector(".provider-status");
  if (!status) return;
  status.textContent = text;
  status.className = `provider-status ${type || ""}`;
}

function fillLanguageSelect(id) {
  const select = document.getElementById(id);
  for (const [value, label] of LANGUAGES) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }
}

function showSaveStatus(text) {
  const headerStatus = document.getElementById("saveStatus");
  const status = document.getElementById("status");
  headerStatus.textContent = text;
  status.textContent = text;
  if (text === "已保存" || text === "已自动保存") {
    setTimeout(() => {
      headerStatus.textContent = "";
      status.textContent = "";
    }, 1500);
  }
}

function normalizeProviderOrder(order) {
  if (shouldUpgradeProviderOrder(order)) {
    return DEFAULT_PROVIDER_ORDER.slice();
  }
  const clean = order.filter((provider) => DEFAULT_PROVIDER_ORDER.includes(provider) && !REMOVED_PROVIDERS.has(provider));
  return [...clean, ...DEFAULT_PROVIDER_ORDER.filter((provider) => !clean.includes(provider))];
}

function shouldUpgradeProviderOrder(order) {
  if (!Array.isArray(order) || !order.length) return true;
  return JSON.stringify(order) === JSON.stringify(LEGACY_PROVIDER_ORDER) || order.includes("volcano");
}

function normalizeDeepSeekBaseUrl(baseUrl) {
  return String(baseUrl || "https://api.deepseek.com")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1$/i, "")
    .replace(/\/chat\/completions$/i, "");
}

function mergeModels(...groups) {
  const map = new Map();
  for (const group of groups) {
    for (const model of group || []) {
      const id = model?.id || model?.name;
      if (!id || map.has(id)) continue;
      map.set(id, { id, name: model.name || id });
    }
  }
  return [...map.values()];
}

function diagLimit() {
  return globalThis.WbtDiag?.MAX_ENTRIES || 400;
}

function formatDiagExport(entries) {
  if (globalThis.WbtDiag?.formatEntries) return globalThis.WbtDiag.formatEntries(entries);
  return (entries || []).map((entry) => [entry.ts, entry.level, entry.event, entry.message].filter(Boolean).join(" ")).join("\n");
}

function setDiagStatus(text) {
  const status = document.getElementById("diagStatus");
  if (status) status.textContent = text;
}

async function openDiagLog() {
  document.getElementById("diagModal").hidden = false;
  document.body.classList.add("modal-open");
  await refreshDiagEntries();
  document.getElementById("closeDiagLog").focus();
}

function closeDiagLog() {
  document.getElementById("diagModal").hidden = true;
  if (document.getElementById("engineModal")?.hidden !== false) document.body.classList.remove("modal-open");
  document.getElementById("openDiagLog").focus();
}

async function refreshDiagEntries() {
  try {
    if (!chrome.storage?.local?.get) throw new Error("本地存储不可用");
    const stored = await chrome.storage.local.get(DIAG_KEY);
    state.diagEntries = Array.isArray(stored?.[DIAG_KEY]) ? stored[DIAG_KEY] : [];
    renderDiagList();
  } catch (error) {
    state.diagEntries = [];
    renderDiagList();
    setDiagStatus(`无法读取本地日志：${error?.message || "未知错误"}`);
  }
}

function filteredDiagEntries() {
  const level = document.getElementById("diagLevel")?.value || "all";
  const entries = state.diagEntries || [];
  if (level === "all") return entries;
  return entries.filter((entry) => entry.level === level);
}

function renderDiagItem(entry) {
  const item = document.createElement("li");
  const level = DIAG_LEVEL_LABELS[entry.level] ? entry.level : "error";
  item.className = `diag-item diag-item-${level}`;
  const meta = document.createElement("div");
  meta.className = "diag-meta";
  const levelNode = document.createElement("span");
  levelNode.className = "diag-level";
  levelNode.textContent = DIAG_LEVEL_LABELS[level] || level;
  meta.append(levelNode, document.createTextNode(`${entry.ts || ""}  ${entry.event || ""}`));
  const details = [];
  for (const key of ["engine", "status", "direction", "sourceLanguage", "targetLanguage", "textLength", "textHash", "attempt", "code"]) {
    if (entry[key] != null && entry[key] !== "") details.push(`${key}=${entry[key]}`);
  }
  if (details.length) {
    const extra = document.createElement("div");
    extra.className = "diag-meta";
    extra.textContent = details.join("  ");
    item.append(meta, extra);
  } else item.append(meta);
  if (entry.message) {
    const message = document.createElement("p");
    message.className = "diag-message";
    message.textContent = entry.message;
    item.append(message);
  }
  return item;
}

function renderDiagList() {
  const list = document.getElementById("diagList");
  if (!list) return;
  const all = state.diagEntries || [];
  const visible = filteredDiagEntries();
  list.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement("li");
    empty.className = "diag-empty";
    empty.textContent = all.length ? "没有符合当前级别的日志" : "还没有诊断记录。翻译失败、发送失败、缓存失败和接口冷却会记在这里。";
    list.append(empty);
  } else {
    for (const entry of visible.slice().reverse()) list.append(renderDiagItem(entry));
  }
  setDiagStatus(`显示 ${visible.length} / 共 ${all.length} 条 · 最多保留 ${diagLimit()} 条`);
}

async function copyDiagLog() {
  const entries = state.diagEntries || [];
  const text = formatDiagExport(entries);
  if (!text) {
    setDiagStatus("没有可复制的日志");
    return;
  }
  try {
    if (!navigator.clipboard?.writeText) throw new Error("剪贴板不可用");
    await navigator.clipboard.writeText(text);
    setDiagStatus(`已复制全部 ${entries.length} 条`);
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.append(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      setDiagStatus(copied ? `已复制全部 ${entries.length} 条` : "复制失败");
    } catch {
      setDiagStatus("复制失败");
    }
  }
}

async function clearDiagLog() {
  if (typeof confirm === "function" && !confirm("清空全部诊断日志？此操作不可恢复。")) return;
  try {
    if (chrome.runtime?.id && chrome.runtime.sendMessage) await chrome.runtime.sendMessage({ type: "diagClear" });
    else if (chrome.storage?.local?.set) await chrome.storage.local.set({ [DIAG_KEY]: [] });
    state.diagEntries = [];
    renderDiagList();
    setDiagStatus("已清空");
  } catch (error) {
    setDiagStatus(`清空失败：${error?.message || "未知错误"}`);
  }
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}



