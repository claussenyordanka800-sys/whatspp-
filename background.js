const DEFAULT_PROVIDER_ORDER = ["volcano", "google", "deepseek", "deepl", "openai", "doubao", "gemini", "custom"];
const LEGACY_PROVIDER_ORDER = ["volcano", "deepl", "openai", "deepseek", "doubao", "gemini", "custom", "google"];
const DEEPSEEK_FALLBACK_MODELS = [
  { id: "deepseek-chat", name: "deepseek-chat（通用对话）" },
  { id: "deepseek-reasoner", name: "deepseek-reasoner（推理）" },
  { id: "deepseek-v4-flash", name: "deepseek-v4-flash" },
  { id: "deepseek-v4-pro", name: "deepseek-v4-pro" }
];

const DEFAULT_SETTINGS = {
  enabled: true,
  provider: "volcano",
  providerOrder: DEFAULT_PROVIDER_ORDER,
  providerEnabled: {
    volcano: true,
    google: true,
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
    volcano: { baseUrl: "https://translate.volcengine.com/crx/translate/v1/" },
    google: { baseUrl: "https://translate.googleapis.com" },
    deepseek: { apiKey: "", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", models: DEEPSEEK_FALLBACK_MODELS },
    deepl: { apiKey: "", baseUrl: "https://api-free.deepl.com/v2", model: "translate" },
    openai: { apiKey: "", baseUrl: "https://api.openai.com/v1", model: "" },
    doubao: { apiKey: "", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "" },
    gemini: { apiKey: "", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-flash" },
    custom: { apiKey: "", baseUrl: "http://127.0.0.1:8000/v1", model: "" }
  }
};

const PROVIDER_NAMES = {
  volcano: "火山翻译",
  google: "Google 翻译",
  deepseek: "DeepSeek",
  deepl: "DeepL",
  openai: "OpenAI",
  doubao: "豆包",
  gemini: "Gemini",
  custom: "第三方 API"
};

const LANGUAGE_NAMES = {
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  en: "English",
  es: "Spanish",
  pt: "Portuguese",
  fr: "French",
  de: "German",
  it: "Italian",
  ar: "Arabic",
  ru: "Russian",
  ja: "Japanese",
  ko: "Korean",
  vi: "Vietnamese",
  th: "Thai",
  id: "Indonesian",
  tr: "Turkish",
  hi: "Hindi"
};

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get("settings");
  if (!stored.settings) {
    await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "translate") {
    translateMessage(message.payload).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: getErrorMessage(error) });
    });
    return true;
  }

  if (message?.type === "testProvider") {
    testProvider(message.provider, message.config, message.targetLanguage).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: getErrorMessage(error) });
    });
    return true;
  }

  if (message?.type === "listModels") {
    listModels(message.provider, message.config).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: getErrorMessage(error), models: [] });
    });
    return true;
  }

  return false;
});

async function translateMessage(payload) {
  const text = normalizeText(payload?.text);
  const targetLanguage = payload?.targetLanguage || "zh-CN";
  const direction = payload?.direction || "receive";

  if (!text) {
    throw new Error("没有可翻译的文本");
  }

  const settings = await getSettings();
  const enabledProviders = getEnabledProviders(settings);
  if (!enabledProviders.length) {
    throw new Error("没有启用的翻译引擎");
  }

  let lastError = "";
  for (const provider of enabledProviders) {
    const cacheKey = makeCacheKey(provider, targetLanguage, text);
    const cached = await chrome.storage.local.get(cacheKey);
    if (cached[cacheKey]) {
      return { ok: true, text: cached[cacheKey], cached: true, provider };
    }

    try {
      const translated = await translateByProvider(provider, {
        text,
        targetLanguage,
        direction,
        config: settings.providers[provider] || {}
      });
      const clean = normalizeTranslation(translated);
      if (!clean) {
        throw new Error("翻译结果为空");
      }
      await chrome.storage.local.set({ [cacheKey]: clean });
      trimCacheSoon();
      return { ok: true, text: clean, cached: false, provider };
    } catch (error) {
      lastError = `${PROVIDER_NAMES[provider] || provider}: ${getErrorMessage(error)}`;
    }
  }

  throw new Error(lastError || "翻译失败");
}

async function testProvider(provider, config, targetLanguage = "zh-CN") {
  const cleanConfig = normalizeProviderConfig(provider, config || {});
  if (provider === "deepseek") {
    prepareDeepSeekConfig(cleanConfig);
  }

  const translated = await translateByProvider(provider, {
    text: "Hello, thank you for your message.",
    targetLanguage,
    direction: "receive",
    config: cleanConfig
  });

  return { ok: true, text: normalizeTranslation(translated), provider, config: cleanConfig };
}

async function listModels(provider, config) {
  const cleanConfig = normalizeProviderConfig(provider, config || {});

  if (provider === "deepseek") {
    return listDeepSeekModels(cleanConfig);
  }

  if (provider === "gemini") {
    const apiKey = cleanConfig.apiKey?.trim();
    if (!apiKey) {
      throw new Error("Gemini 缺少 API Key");
    }
    const baseUrl = cleanConfig.baseUrl || DEFAULT_SETTINGS.providers.gemini.baseUrl;
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models?key=${encodeURIComponent(apiKey)}`);
    if (!response.ok) {
      throw await buildHttpError("读取 Gemini 模型失败", response);
    }
    const data = await response.json();
    const models = (data.models || [])
      .filter((model) => (model.supportedGenerationMethods || []).includes("generateContent"))
      .map((model) => ({
        id: String(model.name || "").replace(/^models\//, ""),
        name: model.displayName || String(model.name || "").replace(/^models\//, "")
      }))
      .filter((model) => model.id);
    return { ok: true, models };
  }

  if (isOpenAICompatibleProvider(provider)) {
    const baseUrl = cleanConfig.baseUrl?.trim();
    if (!baseUrl) {
      throw new Error("缺少接口地址");
    }
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
      headers: buildAuthHeaders(provider, cleanConfig)
    });
    if (!response.ok) {
      throw await buildHttpError("读取模型失败", response, provider);
    }
    const data = await response.json();
    const models = (data.data || data.models || [])
      .map((model) => ({ id: model.id || model.name, name: model.id || model.name }))
      .filter((model) => model.id);
    return { ok: true, models };
  }

  return { ok: true, models: [] };
}

async function getSettings() {
  const stored = await chrome.storage.sync.get("settings");
  return migrateSettings(stored.settings || {});
}

function migrateSettings(settings) {
  const merged = structuredClone(DEFAULT_SETTINGS);
  Object.assign(merged, settings);
  merged.providerOrder = shouldUpgradeProviderOrder(settings.providerOrder)
    ? DEFAULT_PROVIDER_ORDER.slice()
    : [...settings.providerOrder, ...DEFAULT_PROVIDER_ORDER.filter((item) => !settings.providerOrder.includes(item))];
  merged.providerEnabled = { ...DEFAULT_SETTINGS.providerEnabled, ...(settings.providerEnabled || {}) };
  merged.providers = { ...DEFAULT_SETTINGS.providers, ...(settings.providers || {}) };

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

  prepareDeepSeekConfig(merged.providers.deepseek);
  return merged;
}

function getEnabledProviders(settings) {
  const ordered = settings.providerOrder || DEFAULT_PROVIDER_ORDER;
  const enabled = ordered.filter((provider) => settings.providerEnabled?.[provider]);
  const selected = settings.provider;
  if (!selected || !settings.providerEnabled?.[selected] || !enabled.includes(selected)) {
    return enabled;
  }
  return [selected, ...enabled.filter((provider) => provider !== selected)];
}

async function translateByProvider(provider, options) {
  const config = normalizeProviderConfig(provider, options.config || {});

  if (provider === "google") {
    return translateWithGoogle(options.text, options.targetLanguage);
  }
  if (provider === "volcano") {
    return translateWithVolcanoFree(options.text, options.targetLanguage, config);
  }
  if (provider === "deepl") {
    return translateWithDeepL(options.text, options.targetLanguage, config);
  }
  if (provider === "gemini") {
    return translateWithGemini(options, config);
  }
  if (isOpenAICompatibleProvider(provider)) {
    return translateWithOpenAICompatible({ ...options, provider, config });
  }
  throw new Error("未知翻译引擎");
}

function normalizeProviderConfig(provider, config) {
  return { ...(DEFAULT_SETTINGS.providers[provider] || {}), ...(config || {}) };
}

async function translateWithGoogle(text, targetLanguage) {
  const params = new URLSearchParams({
    client: "gtx",
    sl: "auto",
    tl: targetLanguage,
    dt: "t",
    q: text
  });
  const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`);
  if (!response.ok) {
    throw await buildHttpError("Google 翻译失败", response);
  }
  const data = await response.json();
  return Array.isArray(data?.[0]) ? data[0].map((part) => part?.[0] || "").join("") : "";
}

async function translateWithVolcanoFree(text, targetLanguage, config) {
  const response = await fetch(config.baseUrl || DEFAULT_SETTINGS.providers.volcano.baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      target_language: targetLanguage
    })
  });
  if (!response.ok) {
    throw await buildHttpError("火山翻译失败", response);
  }
  const data = await response.json();
  return data.translation || data.data?.translation || data.text || "";
}

async function translateWithDeepL(text, targetLanguage, config) {
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    throw new Error("DeepL 缺少 API Key");
  }
  const baseUrl = (config.baseUrl || (apiKey.endsWith(":fx") ? "https://api-free.deepl.com/v2" : "https://api.deepl.com/v2")).replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/translate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `DeepL-Auth-Key ${apiKey}`
    },
    body: new URLSearchParams({
      text,
      target_lang: mapDeepLLanguage(targetLanguage)
    }).toString()
  });
  if (!response.ok) {
    throw await buildHttpError("DeepL 翻译失败", response);
  }
  const data = await response.json();
  return data.translations?.[0]?.text || "";
}

async function translateWithGemini(options, config) {
  const apiKey = config.apiKey?.trim();
  const model = config.model?.trim();
  if (!apiKey) {
    throw new Error("Gemini 缺少 API Key");
  }
  if (!model) {
    throw new Error("Gemini 缺少模型");
  }
  const baseUrl = (config.baseUrl || DEFAULT_SETTINGS.providers.gemini.baseUrl).replace(/\/+$/, "");
  const modelPath = model.startsWith("models/") ? model : `models/${model}`;
  const response = await fetch(`${baseUrl}/${modelPath}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: buildUserPrompt(options.text, options.targetLanguage, options.direction) }]
        }
      ],
      generationConfig: { temperature: 0 }
    })
  });
  if (!response.ok) {
    throw await buildHttpError("Gemini 请求失败", response);
  }
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
}

async function translateWithOpenAICompatible(options) {
  const config = options.provider === "deepseek" ? prepareDeepSeekConfig(options.config) : options.config;
  const baseUrl = config.baseUrl?.trim();
  const model = config.model?.trim();
  const providerName = PROVIDER_NAMES[options.provider] || options.provider;

  if (!baseUrl) {
    throw new Error(`${providerName} 缺少接口地址`);
  }
  if (!model) {
    throw new Error(`${providerName} 缺少模型`);
  }

  const response = await fetch(toChatCompletionsUrl(baseUrl, options.provider), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(options.provider, config)
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: "You are a professional translation engine. Return only the translated text. Do not add explanations, quotes, markdown, labels, or extra commentary."
        },
        {
          role: "user",
          content: buildUserPrompt(options.text, options.targetLanguage, options.direction)
        }
      ]
    })
  });
  if (!response.ok) {
    const detail = await safeReadText(response);
    throw buildHttpErrorFromDetail(`${providerName} 请求失败`, response.status, detail, options.provider);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

function isOpenAICompatibleProvider(provider) {
  return ["openai", "deepseek", "doubao", "custom"].includes(provider);
}

function buildAuthHeaders(provider, config) {
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    return {};
  }
  return provider === "doubao"
    ? { Authorization: `Bearer ${apiKey}`, "Api-Key": apiKey }
    : { Authorization: `Bearer ${apiKey}` };
}

function buildUserPrompt(text, targetLanguage, direction) {
  const languageName = LANGUAGE_NAMES[targetLanguage] || targetLanguage;
  const tone = direction === "send"
    ? "Keep the wording natural, polite, and suitable for chatting with an international customer."
    : "Keep the meaning faithful and readable.";
  return `Translate the following text into ${languageName}. ${tone}

Source text:
${text}

Translated text:`;
}

function toChatCompletionsUrl(baseUrl, provider) {
  const trimmed = provider === "deepseek" ? normalizeDeepSeekBaseUrl(baseUrl) : baseUrl.replace(/\/+$/, "");
  return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

function mapDeepLLanguage(language) {
  const map = {
    "zh-CN": "ZH",
    "zh-TW": "ZH",
    en: "EN-US",
    pt: "PT-PT"
  };
  return map[language] || language.toUpperCase();
}

function shouldUpgradeProviderOrder(order) {
  if (!Array.isArray(order) || !order.length) {
    return true;
  }
  return JSON.stringify(order) === JSON.stringify(LEGACY_PROVIDER_ORDER);
}

function prepareDeepSeekConfig(config) {
  config.baseUrl = normalizeDeepSeekBaseUrl(config.baseUrl || DEFAULT_SETTINGS.providers.deepseek.baseUrl);
  if (!config.model) {
    config.model = DEEPSEEK_FALLBACK_MODELS[0].id;
  }
  config.models = mergeModels(DEEPSEEK_FALLBACK_MODELS, config.models);
  return config;
}

function normalizeDeepSeekBaseUrl(baseUrl) {
  return String(baseUrl || "https://api.deepseek.com")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1$/i, "")
    .replace(/\/chat\/completions$/i, "");
}

async function listDeepSeekModels(config) {
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    throw new Error("DeepSeek 缺少 API Key");
  }
  const baseUrl = normalizeDeepSeekBaseUrl(config.baseUrl);
  const response = await fetch(`${baseUrl}/models`, {
    headers: buildAuthHeaders("deepseek", { ...config, apiKey })
  });
  if (!response.ok) {
    const detail = await safeReadText(response);
    if ([404, 405].includes(response.status)) {
      return { ok: true, models: DEEPSEEK_FALLBACK_MODELS, fallback: true };
    }
    throw buildHttpErrorFromDetail("读取 DeepSeek 模型失败", response.status, detail, "deepseek");
  }
  const data = await response.json();
  const models = (data.data || data.models || [])
    .map((model) => ({ id: model.id || model.name, name: model.id || model.name }))
    .filter((model) => model.id);
  return { ok: true, models: mergeModels(DEEPSEEK_FALLBACK_MODELS, models), fallback: !models.length };
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

function normalizeText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function normalizeTranslation(text) {
  return normalizeText(text)
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
}

function makeCacheKey(provider, targetLanguage, text) {
  return `tr:${provider}:${targetLanguage}:${hashText(text)}`;
}

function hashText(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

let cacheTrimTimer;
function trimCacheSoon() {
  clearTimeout(cacheTrimTimer);
  cacheTrimTimer = setTimeout(async () => {
    const bytes = await chrome.storage.local.getBytesInUse();
    if (bytes > 4 * 1024 * 1024) {
      await chrome.storage.local.clear();
    }
  }, 5000);
}

async function safeReadText(response) {
  try {
    return (await response.text()).slice(0, 240);
  } catch {
    return "";
  }
}

async function buildHttpError(prefix, response, provider) {
  const detail = await safeReadText(response);
  return buildHttpErrorFromDetail(prefix, response.status, detail, provider);
}

function buildHttpErrorFromDetail(prefix, status, detail, provider) {
  const hintMap = {
    400: "请求参数错误，请检查模型名和接口地址",
    401: "认证失败，请检查 API Key 是否正确、是否已复制完整",
    403: "无权限访问，请检查账号权限、余额或模型权限",
    404: provider === "deepseek"
      ? "地址或模型不存在，DeepSeek 推荐 Base URL: https://api.deepseek.com"
      : "地址或模型不存在，请检查 Base URL 和模型名",
    429: "请求过快或额度不足，请稍后重试或检查余额",
    500: "服务端异常，请稍后重试",
    502: "服务网关异常，请稍后重试",
    503: "服务暂不可用，请稍后重试"
  };
  const hint = hintMap[status] || "请求失败";
  return new Error(`${prefix}: HTTP ${status}，${hint}${detail ? `。返回：${detail}` : ""}`);
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || "未知错误");
}
