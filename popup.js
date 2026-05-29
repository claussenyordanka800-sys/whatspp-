const DEFAULT_PROVIDER_ORDER = ["google", "microsoft", "deepseek", "deepl", "openai", "doubao", "gemini", "custom"];
const LEGACY_PROVIDER_ORDER = ["volcano", "deepl", "openai", "deepseek", "doubao", "gemini", "custom", "google"];
const REMOVED_PROVIDERS = new Set(["volcano"]);

const DEEPSEEK_MODELS = [
  { id: "deepseek-chat", name: "deepseek-chat (general)" },
  { id: "deepseek-reasoner", name: "deepseek-reasoner (reasoning)" },
  { id: "deepseek-v4-flash", name: "deepseek-v4-flash" },
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
    deepseek: { apiKey: "", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", models: DEEPSEEK_MODELS },
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
  deepl: "D",
  openai: "AI",
  doubao: "豆",
  gemini: "✦",
  custom: "API"
};

const PROVIDER_LOGOS = {
  google: "assets/logos/google.svg",
  deepseek: "assets/logos/deepseek.svg",
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
  "enabled",
  "receiveLanguage",
  "sendLanguage",
  "autoReceive",
  "autoDetectLanguage",
  "forbidChinese",
  "translationColor",
  "translationSize"
];

const state = {
  expandedProvider: "",
  draggingProvider: "",
  settings: null
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
  for (const provider of REMOVED_PROVIDERS) {
    delete merged.providerEnabled[provider];
    delete merged.providers[provider];
  }

  if (settings.deepseekApiKey || settings.deepseekBaseUrl || settings.deepseekModel) {
    merged.providers.deepseek = {
      ...merged.providers.deepseek,
      apiKey: settings.deepseekApiKey || merged.providers.deepseek.apiKey,
      baseUrl: settings.deepseekBaseUrl || merged.providers.deepseek.baseUrl,
      model: settings.deepseekModel || merged.providers.deepseek.model
    };
  }
  if (settings.customApiKey || settings.customBaseUrl || settings.customModel) {
    merged.providers.custom = {
      ...merged.providers.custom,
      apiKey: settings.customApiKey || merged.providers.custom.apiKey,
      baseUrl: settings.customBaseUrl || merged.providers.custom.baseUrl,
      model: settings.customModel || merged.providers.custom.model
    };
  }

  merged.providers.deepseek = {
    ...DEFAULT_SETTINGS.providers.deepseek,
    ...(merged.providers.deepseek || {}),
    baseUrl: normalizeDeepSeekBaseUrl(merged.providers.deepseek?.baseUrl),
    model: merged.providers.deepseek?.model || "deepseek-chat",
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
    collectSettingsFromDom();
    await saveSettings(true);
    closeEngineSettings();
  });
  document.getElementById("openEngineSettings").addEventListener("click", openEngineSettings);
  document.getElementById("closeEngineSettings").addEventListener("click", closeEngineSettings);
  document.getElementById("cancelEngineSettings").addEventListener("click", closeEngineSettings);

  document.getElementById("provider").addEventListener("change", async (event) => {
    state.settings.provider = event.target.value;
    await saveSettings(false);
    showSaveStatus("已自动保存");
  });

  document.querySelectorAll("main input, main select").forEach((element) => {
    if (element.id === "provider") return;
    element.addEventListener("change", async () => {
      collectSettingsFromDom();
      await saveSettings(false);
      showSaveStatus("已自动保存");
    });
  });

  document.getElementById("providerList").addEventListener("click", handleProviderClick);
  document.getElementById("providerList").addEventListener("change", handleProviderChange);
  document.getElementById("providerList").addEventListener("input", handleProviderInput);
  document.getElementById("providerList").addEventListener("dragstart", handleProviderDragStart);
  document.getElementById("providerList").addEventListener("dragover", handleProviderDragOver);
  document.getElementById("providerList").addEventListener("drop", handleProviderDrop);
  document.getElementById("providerList").addEventListener("dragend", handleProviderDragEnd);
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

function handleProviderChange(event) {
  const card = event.target.closest(".provider-card");
  if (!card) return;
  const provider = card.dataset.provider;

  if (event.target.classList.contains("provider-enabled")) {
    state.settings.providerEnabled[provider] = event.target.checked;
    ensureProviderSelection();
    renderProviderSelect();
    showSaveStatus("已自动保存");
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
  collectCardConfig(provider, card);
  setProviderStatus(card, "读取中...", "");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "listModels",
      provider,
      config: state.settings.providers[provider]
    });
    if (!response?.ok) throw new Error(response?.error || "读取失败");

    state.settings.providers[provider].models = provider === "deepseek"
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
    setProviderStatus(newCard, `${response.fallback ? "已补充内置模型，" : ""}当前可用 ${count} 个模型`, "ok");
    showSaveStatus("已修改");
  } catch (error) {
    setProviderStatus(card, error.message || "读取失败", "bad");
  }
}

async function testProvider(provider, card) {
  collectCardConfig(provider, card);
  setProviderStatus(card, "测试中...", "");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "testProvider",
      provider,
      config: state.settings.providers[provider],
      targetLanguage: state.settings.receiveLanguage || "zh-CN"
    });
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
    setProviderStatus(card, error.message || "测试失败", "bad");
  }
}

function collectCardConfig(provider, card) {
  card.querySelectorAll(".provider-input").forEach((input) => {
    updateProviderConfig(provider, input.dataset.key, input.value.trim(), false);
  });
}

async function saveSettings(showSuccess) {
  ensureProviderSelection();
  await chrome.storage.sync.set({ settings: state.settings });
  renderProviderSelect();
  if (showSuccess) {
    showSaveStatus("已保存");
  }
}

function openEngineSettings() {
  renderProviders();
  document.getElementById("engineModal").hidden = false;
}

function closeEngineSettings() {
  state.expandedProvider = "";
  document.getElementById("engineModal").hidden = true;
  renderProviders();
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

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}



