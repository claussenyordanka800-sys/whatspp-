const MESSAGE_SELECTOR = ".message-in, .message-out, [data-id], [role='row'], [data-pre-plain-text]";
const TEXT_SELECTORS = [
  "span.selectable-text.copyable-text",
  "div.copyable-text span.selectable-text",
  "span._ao3e.selectable-text.copyable-text",
  "span._akbu",
  "[data-pre-plain-text] [data-lexical-text='true']",
  "span[data-lexical-text='true']",
  "div.copyable-text",
  "span.selectable-text",
  "div[dir='auto']",
  ".copyable-text"
];
const INPUT_SELECTORS = [
  "#main footer div[contenteditable='true'][role='textbox']",
  "#main div[contenteditable='true'][role='textbox']",
  "footer div[contenteditable='true']"
];
const QUOTED_SELECTORS = [
  "[data-testid='quoted-message']",
  "[data-testid='quoted-message-container']",
  "[aria-label*='Quoted']",
  "[aria-label*='\u5f15\u7528']",
  "[role='button'] img",
  "canvas",
  "video"
];
const SYSTEM_LINE_PATTERNS = [
  /^[↪↩⤴⤵]\s*/,
  /^(?:已转发|转发|轉發|forwarded|reenviado|reenviada|replying to|reply)$/i,
  /^(?:图片|照片|image|video|sticker|gif|document|audio|voice message)$/i
];

const LANGUAGE_LABELS = {
  "zh-CN": "\u4e2d\u6587(\u7b80\u4f53)",
  "zh-TW": "\u4e2d\u6587(\u7e41\u4f53)",
  en: "\u82f1\u8bed",
  es: "\u897f\u73ed\u7259\u8bed",
  pt: "\u8461\u8404\u7259\u8bed",
  fr: "\u6cd5\u8bed",
  de: "\u5fb7\u8bed",
  it: "\u610f\u5927\u5229\u8bed",
  ar: "\u963f\u62c9\u4f2f\u8bed",
  ru: "\u4fc4\u8bed",
  ja: "\u65e5\u8bed",
  ko: "\u97e9\u8bed",
  vi: "\u8d8a\u5357\u8bed",
  th: "\u6cf0\u8bed",
  id: "\u5370\u5c3c\u8bed",
  tr: "\u571f\u8033\u5176\u8bed",
  hi: "\u5370\u5730\u8bed"
};

const DETECT_MAP = {
  zh: "zh-CN",
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
  en: "en",
  es: "es",
  pt: "pt",
  fr: "fr",
  de: "de",
  it: "it",
  ar: "ar",
  ru: "ru",
  ja: "ja",
  ko: "ko",
  vi: "vi",
  th: "th",
  id: "id",
  tr: "tr",
  hi: "hi"
};

const MAX_CONCURRENT_BUBBLE_TRANSLATIONS = 3;
const TIMING = {
  scanFallback: 3000,
  conversationFallback: 1500,
  scanDebounce: 250,
  languageDetect: 350,
  draftTranslate: 900
};

if (globalThis.WAChatTools) {
  const names = new Intl.DisplayNames(['zh-CN'], { type: 'language' });
  for (const code of WAChatTools.languageCodes) {
    LANGUAGE_LABELS[code] ||= names.of(code);
    DETECT_MAP[code] = code;
  }
}

const state = {
  settings: null,
  observer: null,
  scanTimer: null,
  draftTimer: null,
  detectTimer: null,
  detectedLanguage: "",
  manualLanguage: "",
  lastDraftSource: "",
  lastTranslatedDraft: null,
  isReplacingDraft: false,
  isTranslatingDraft: false,
  isDetectingLanguage: false,
  translatingContainers: new WeakSet(),
  queuedContainers: new WeakSet(),
  bubbleQueue: [],
  activeBubbleTranslations: 0,
  lastConversationId: "",
  lastLanguageDetectionSignature: "",
  detectedLanguagesByConversation: new Map(),
  manualLanguagesByConversation: new Map()
};
state.profiles = {};
state.phrases = globalThis.WAChatTools?.defaultPhrases || [];
state.draftRevision = 0;
state.composing = false;
state.bypassSend = false;
state.draftRequest = null;
state.composerReplacement = null;
state.runtimeUnavailable = false;
state.bubbleResults = new Map();
state.bubbleSettingsRevision = 0;
state.failedWrite = null;
state.consecutiveSendFailures = 0;
state.instanceId = crypto.randomUUID();
state.listenerController = new AbortController();
state.watchedInputs = new WeakSet();
state.cachedInput = null;
state.containerMemo = new WeakMap();
globalThis.WATranslatorLifecycle?.dispose();
document.documentElement.dataset.waTranslatorInstance = state.instanceId;
globalThis.WATranslatorLifecycle = { dispose: disposeTranslator };

init().catch(error => {
  if (!ownsPage()) return;
  state.settings ||= { enabled: true, sendLanguage: 'en' };
  state.runtimeUnavailable = true;
  enhanceComposer();
  const message = formatTranslationError(error);
  reportDiag({ level: "error", event: "content.init_failure", message });
  showComposerNotice(message, { error: true });
});

function ownsPage() {
  return document.documentElement.dataset.waTranslatorInstance === state.instanceId;
}

function disposeTranslator(removeUI = true) {
  state.runtimeUnavailable = true;
  state.draftRequest = null;
  state.listenerController.abort();
  state.observer?.disconnect();
  for (const timer of ['scanInterval', 'conversationInterval']) clearInterval(state[timer]);
  for (const timer of ['scanTimer', 'draftTimer', 'detectTimer', 'noticeTimer']) clearTimeout(state[timer]);
  chrome.storage.onChanged.removeListener?.(state.settingsListener);
  if (removeUI) document.querySelectorAll('.wa-language-prompt, .wa-chat-panel, .wa-ai-panel').forEach(node => node.remove());
}

function listenOwned(target, event, handler, capture = false) {
  target.addEventListener(event, payload => {
    if (!ownsPage()) { disposeTranslator(false); return; }
    handler(payload);
  }, { capture, signal: state.listenerController.signal });
}

async function init() {
  state.settings = await loadSettings();
  if (!ownsPage()) return;
  const local = await chrome.storage.local?.get(null);
  if (!ownsPage()) return;
  for (const [key, value] of Object.entries(local || {})) {
    if (key.startsWith('contact:') && value && typeof value === 'object') state.profiles[key.slice(8)] = value;
  }
  if (Array.isArray(local?.quickPhrases)) state.phrases = local.quickPhrases;
  state.settingsListener = (changes, area) => {
    if (!ownsPage()) return;
    if (area === 'local') {
      const previousLanguage = getActiveSendLanguage();
      for (const [key, change] of Object.entries(changes)) {
        if (key.startsWith('contact:')) state.profiles[key.slice(8)] = change.newValue || {};
        if (key === 'quickPhrases') state.phrases = change.newValue || [];
      }
      state.manualLanguage = state.profiles[state.lastConversationId]?.language || '';
      if (previousLanguage !== getActiveSendLanguage()) invalidateDraftTranslation('客户语言已改变，请重新翻译');
      updateLanguagePrompt();
    }
    if (area === "sync" && changes.settings) {
      const oldSignature = bubbleSettingsSignature(state.settings);
      state.settings = { ...state.settings, ...changes.settings.newValue };
      if (oldSignature !== bubbleSettingsSignature(state.settings)) {
        state.bubbleSettingsRevision += 1;
        state.bubbleResults.clear();
      }
      state.draftRevision += 1;
      invalidateDraftTranslation('设置已改变，已取消旧翻译，请重新翻译');
      updateLanguagePrompt();
      scheduleScan();
    }
  };
  chrome.storage.onChanged.addListener(state.settingsListener);

  scanPage();
  installObserver();
  state.scanInterval = setInterval(scanPage, TIMING.scanFallback);
  watchConversationSwitch();
}

async function loadSettings() {
  const response = await chrome.storage.sync.get("settings");
  const settings = {
    enabled: true,
    provider: "google",
    receiveLanguage: "zh-CN",
    sendLanguage: "en",
    autoReceive: true,
    autoSend: false,
    autoDetectLanguage: true,
    sendTrigger: "enter",
    forbidChinese: false,
    translationColor: "#a127b8",
    translationSize: "default",
    ...(response.settings || {})
  };
  if (settings.sendTrigger === "manual") {
    settings.sendTrigger = "enter";
    settings.autoSend = false;
  }
  return settings;
}

function installObserver() {
  state.observer?.disconnect();
  state.observer = new MutationObserver(() => scheduleScan());
  state.observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function scheduleScan() {
  clearTimeout(state.scanTimer);
  state.scanTimer = setTimeout(scanPage, TIMING.scanDebounce);
}

// 获取当前对话标题，用多个 selector 兜底
function getConversationTitle() {
  const jid = document.querySelector('#main [data-id]')?.getAttribute('data-id')?.match(/^(?:true|false)_([^_]+@[^_]+)_/i)?.[1];
  if (jid) return jid;
  const selectors = [
    "#main header [data-testid='conversation-info-header-chat-title'] span",
    "#main header ._ao3e",
    "#main header span[dir='auto'][title]",
    "#main header span[dir='auto']",
    "#main header div[role='button'] span[dir='auto']"
  ];
  for (const sel of selectors) {
    const text = document.querySelector(sel)?.textContent?.trim();
    if (text) return text;
  }
  // 最后兜底：URL + hash（部分版本切换对话会改 hash）
  return '';
}

// 对话切换检测：独立 interval + URL 事件双保险
function watchConversationSwitch() {
  const check = () => {
    if (!ownsPage()) { disposeTranslator(false); return; }
    const currentId = getConversationTitle();
    if (!currentId || currentId === state.lastConversationId) return;
    switchConversation(currentId);
  };
  check();
  state.conversationInterval = setInterval(check, TIMING.conversationFallback);
  listenOwned(window, "hashchange", check);
  listenOwned(window, "popstate", check);
}

function switchConversation(conversationId) {
  clearComposerNotice();
  invalidateDraftTranslation();
  state.composing = false;
  state.cachedInput = null;
  state.lastConversationId = conversationId;
  state.draftRevision += 1;
  state.lastDraftSource = '';
  state.lastTranslatedDraft = null;
  state.failedWrite = null;
  state.consecutiveSendFailures = 0;
  clearTimeout(state.draftTimer);
  document.querySelector('.wa-chat-panel')?.remove();
  document.querySelector('.wa-ai-panel')?.remove();
  document.querySelector('.wa-ai-toggle')?.setAttribute('aria-expanded', 'false');
  document.querySelector('.wa-tools-toggle')?.setAttribute('aria-expanded', 'false');
  state.manualLanguage = state.profiles[conversationId]?.language || state.manualLanguagesByConversation.get(conversationId) || "";
  state.detectedLanguage = state.profiles[conversationId]?.detectedLanguage || state.detectedLanguagesByConversation.get(conversationId) || "";
  state.lastLanguageDetectionSignature = "";
  clearTimeout(state.detectTimer);
  scheduleLanguageDetection();
  updateLanguagePrompt();
}

function scanPage() {
  if (!ownsPage()) { disposeTranslator(false); return; }
  if (state.runtimeUnavailable) return;
  const conversationId = getConversationTitle();
  if (conversationId !== state.lastConversationId) switchConversation(conversationId);
  document.documentElement.classList.toggle('wa-translator-disabled', !state.settings.enabled);
  if (!state.settings.enabled) {
    return;
  }
  scheduleLanguageDetection();
  applyTranslationStyle();
  findMessageNodes().forEach(enhanceMessage);
  enhanceComposer();
  updateLanguagePrompt();
}

function scheduleLanguageDetection() {
  clearTimeout(state.detectTimer);
  state.detectTimer = setTimeout(updateDetectedLanguage, TIMING.languageDetect);
}

function applyTranslationStyle() {
  const root = document.documentElement;
  const sizeMap = {
    small: "12.5px",
    default: "13.5px",
    large: "15px",
    xlarge: "16.5px"
  };
  root.style.setProperty("--wa-translator-color", state.settings.translationColor || "#a127b8");
  root.style.setProperty("--wa-translator-size", sizeMap[state.settings.translationSize] || sizeMap.default);
}

function enhanceMessage(messageNode) {
  // Skip bubbles already settled under the same text, language and engine config.
  if (messageNode.dataset.waTranslatorSig === messageSignature(messageNode)) {
    return;
  }

  const containers = findAllTextContainers(messageNode);
  if (!containers.length) {
    return;
  }

  messageNode.dataset.waTranslatorReady = "1";
  let pending = false;
  for (const textContainer of containers) {
    if (shouldAutoTranslateMessage(messageNode, textContainer)) {
      queueBubbleTranslation(messageNode, textContainer);
      pending = true;
    } else if (state.translatingContainers.has(textContainer) || state.queuedContainers.has(textContainer)) {
      pending = true;
    }
  }
  // Only record completion once nothing is in flight, so a dropped request is retried.
  if (pending) delete messageNode.dataset.waTranslatorSig;
  else messageNode.dataset.waTranslatorSig = messageSignature(messageNode);
}

function messageSignature(messageNode) {
  return [
    messageNode.getAttribute("data-id") || "",
    hashString(messageNode.textContent),
    state.bubbleSettingsRevision,
    getReceiveLanguage(),
    state.settings?.autoReceive ? 1 : 0
  ].join("|");
}

function hashString(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function findMessageNodes(root = document) {
  const nodes = new Set();
  for (const node of root.querySelectorAll(MESSAGE_SELECTOR)) {
    const messageNode = normalizeMessageNode(node);
    if (messageNode && isLikelyMessageNode(messageNode)) {
      nodes.add(messageNode);
    }
  }
  return [...nodes].filter((node) => ![...nodes].some((other) => other !== node && other.contains(node)));
}

function normalizeMessageNode(node) {
  if (!(node instanceof Element)) {
    return null;
  }
  return node.closest(".message-in, .message-out")
    || node.closest("[role='row']")
    || node.closest("[data-id]")
    || node.closest("[data-pre-plain-text]")
    || node;
}

function isLikelyMessageNode(node) {
  if (!(node instanceof Element) || node.closest("footer, [contenteditable='true']")) {
    return false;
  }
  if (!document.querySelector("#main")?.contains(node)) {
    return false;
  }
  const hasMessageMarker = node.matches(".message-in, .message-out, [data-id], [data-pre-plain-text]")
    || Boolean(node.querySelector("[data-id], [data-pre-plain-text]"));
  const hasModernText = Boolean(node.querySelector("[data-lexical-text='true'], .selectable-text, .copyable-text"));
  return (hasMessageMarker || hasModernText) && findAllTextContainers(node).length > 0;
}

function shouldAutoTranslateMessage(messageNode, textContainer) {
  if (state.runtimeUnavailable || !state.settings.enabled) {
    return false;
  }
  if (!state.settings.autoReceive) {
    return false;
  }
  const existing = textContainer.querySelector('.wa-bubble-translator-output');
  if (existing) {
    if (existing.dataset.source === extractMessageText(textContainer) && existing.dataset.language === getReceiveLanguage()
      && existing.dataset.settingsRevision === String(state.bubbleSettingsRevision)) return false;
    existing.remove();
  }
  if (state.translatingContainers.has(textContainer) || state.queuedContainers.has(textContainer)) {
    return false;
  }
  const text = extractMessageText(textContainer);
  if (textContainer.dataset.waTranslatorSkip === skipKey(text)) return false;
  return hasTranslatableText(text);
}

// Marks a bubble that is already in the receive language, so it is not re-sent every scan.
function skipKey(text) {
  return `${getReceiveLanguage()}|${state.bubbleSettingsRevision}|${hashString(text)}`;
}

function isSameLanguage(language, targetLanguage) {
  if (!language) return false;
  if (targetLanguage.startsWith('zh')) {
    return ({ zh: 'zh-CN', 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW' }[language] || language) === targetLanguage;
  }
  return language.split('-')[0] === targetLanguage.split('-')[0];
}

function getMessageDirection(messageNode, textContainer) {
  if (messageNode.classList.contains("message-in")) return "incoming";
  if (messageNode.classList.contains("message-out")) return "outgoing";

  const idNode = messageNode.matches("[data-id]") ? messageNode : messageNode.querySelector("[data-id]");
  const messageId = idNode?.getAttribute("data-id") || "";
  if (/^false_/i.test(messageId)) return "incoming";
  if (/^true_/i.test(messageId)) return "outgoing";

  const rowRect = messageNode.getBoundingClientRect();
  const anchorRect = (textContainer || messageNode.firstElementChild)?.getBoundingClientRect?.();
  if (rowRect.width > 0 && anchorRect?.width > 0) {
    const rowCenter = (rowRect.left + rowRect.right) / 2;
    const anchorCenter = (anchorRect.left + anchorRect.right) / 2;
    return anchorCenter > rowCenter ? "outgoing" : "incoming";
  }
  return "unknown";
}

// 找出消息节点内所有独立的文本容器（不互相包含），逐个翻译
function findAllTextContainers(messageNode) {
  const signature = containerSignature(messageNode);
  const memo = state.containerMemo.get(messageNode);
  if (memo?.signature === signature
    && memo.containers.every((node) => node.isConnected && messageNode.contains(node))) {
    return memo.containers;
  }
  const containers = collectTextContainers(messageNode);
  state.containerMemo.set(messageNode, { signature, containers });
  return containers;
}

// Cheap change detector: the container set only moves when the bubble's text or shape changes.
function containerSignature(messageNode) {
  return `${messageNode.childElementCount}:${hashString(messageNode.textContent)}`;
}

function collectTextContainers(messageNode) {
  for (const selector of TEXT_SELECTORS) {
    const candidates = new Map();
    for (const node of messageNode.querySelectorAll(selector)) {
      if (!isRenderableNode(node, messageNode)) continue;
      if (candidates.has(node)) continue;
      const text = extractMessageText(node);
      if (text) candidates.set(node, text);
    }

    if (candidates.size) {
      const nodes = filterMessageTextNodes([...candidates.keys()], messageNode);
      if (nodes.length) return nodes;
    }
  }

  // 后备：扫描所有含直接文本的 span/div
  const candidates = new Map();
  for (const node of messageNode.querySelectorAll("span, div")) {
    if (node.hidden || node.getAttribute("aria-hidden") === "true") continue;
    const directText = [...node.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent.trim())
      .join("");
    if (!directText) continue;
    const text = extractMessageText(node);
    if (text) candidates.set(node, text);
  }

  // 只保留最外层容器（去掉被其他节点包含的子节点）
  const nodes = filterMessageTextNodes([...candidates.keys()], messageNode);
  return nodes.filter(
    (node) => !nodes.some((other) => other !== node && other.contains(node))
  );
}

function filterMessageTextNodes(nodes, messageNode) {
  let filtered = nodes.filter((node) => !node.closest([
    "[data-testid='quoted-message']",
    "[data-testid='quoted-message-container']",
    "[aria-label*='Quoted']",
    "[aria-label*='\u5f15\u7528']"
  ].join(",")));

  const nestedButtonFor = (node) => {
    const button = node.closest("[role='button']");
    return button && button !== messageNode && messageNode.contains(button) ? button : null;
  };
  if (filtered.some((node) => !nestedButtonFor(node))) {
    filtered = filtered.filter((node) => !nestedButtonFor(node));
  }

  return filtered.filter(
    (node) => !filtered.some((other) => other !== node && other.contains(node))
  );
}

function queueBubbleTranslation(messageNode, textContainer) {
  if (state.queuedContainers.has(textContainer) || state.translatingContainers.has(textContainer)) return;
  state.queuedContainers.add(textContainer);
  state.bubbleQueue.push({ messageNode, textContainer, conversationId: getConversationTitle() });
  // Start after the scan has queued every bubble, so the newest ones can go first.
  if (state.bubbleQueueScheduled) return;
  state.bubbleQueueScheduled = true;
  queueMicrotask(() => { state.bubbleQueueScheduled = false; processBubbleQueue(); });
}

// Visible bubbles first, then newest (queue is in DOM order, oldest at the top).
function nextBubbleIndex() {
  for (let index = state.bubbleQueue.length - 1; index >= 0; index -= 1) {
    const node = state.bubbleQueue[index].messageNode;
    if (node.isConnected && isInViewport(node)) return index;
  }
  return state.bubbleQueue.length - 1;
}

function processBubbleQueue() {
  while (state.activeBubbleTranslations < MAX_CONCURRENT_BUBBLE_TRANSLATIONS && state.bubbleQueue.length) {
    const [item] = state.bubbleQueue.splice(nextBubbleIndex(), 1);
    state.activeBubbleTranslations += 1;
    Promise.resolve().then(async () => {
      if (!state.runtimeUnavailable && state.settings.enabled && state.settings.autoReceive && item.conversationId === getConversationTitle() && item.messageNode.isConnected && item.textContainer.isConnected) {
        await translateBubble(item.messageNode, item.textContainer, false);
      }
    }).finally(() => {
      state.queuedContainers.delete(item.textContainer);
      state.activeBubbleTranslations -= 1;
      processBubbleQueue();
    });
  }
}

async function translateBubble(messageNode, textContainer, forceRefresh) {
  if (state.runtimeUnavailable) {
    showComposerNotice('扩展连接已失效，请刷新 WhatsApp 页面后重试', { error: true });
    return;
  }
  const text = extractMessageText(textContainer);
  const targetLanguage = getReceiveLanguage();
  if (!hasTranslatableText(text) || state.translatingContainers.has(textContainer)) {
    return;
  }

  const conversationId = getConversationTitle();
  const settingsRevision = state.bubbleSettingsRevision;
  const messageId = messageNode.getAttribute('data-id') || messageNode.querySelector('[data-id]')?.getAttribute('data-id');
  const key = JSON.stringify([conversationId, messageId || '', text, targetLanguage, settingsRevision]);
  const known = state.bubbleResults.get(key);
  if (!forceRefresh && known) {
    insertTranslation(textContainer, known, false, messageNode);
    return;
  }
  const isCurrent = () => state.settings.enabled && state.settings.autoReceive
    && ownsPage()
    && settingsRevision === state.bubbleSettingsRevision
    && conversationId === getConversationTitle() && messageNode.isConnected && textContainer.isConnected
    && messageNode.contains(textContainer) && extractMessageText(textContainer) === text && getReceiveLanguage() === targetLanguage
    && messageId === (messageNode.getAttribute('data-id') || messageNode.querySelector('[data-id]')?.getAttribute('data-id'));

  state.translatingContainers.add(textContainer);
  if (forceRefresh) {
    removeOutput(textContainer);
  } else {
    messageNode.querySelectorAll(".wa-bubble-translator-error").forEach((node) => node.remove());
  }

  const skipBubble = () => {
    if (!isCurrent()) return;
    removeOutput(textContainer);
    textContainer.dataset.waTranslatorSkip = skipKey(text);
  };

  try {
    if (!forceRefresh) {
      let detection;
      try { detection = await chrome.i18n.detectLanguage(text.slice(0, 1000)); } catch { /* translate when unsure */ }
      const best = detection?.languages?.[0];
      if (detection?.isReliable === true && best?.percentage >= 85 && isSameLanguage(best.language, targetLanguage)) {
        skipBubble();
        return;
      }
    }

    const response = await chrome.runtime.sendMessage({
      type: "translate",
      payload: {
        text,
        targetLanguage,
        sourceLanguage: guessSourceLanguage(text),
        direction: "receive"
      }
    });

    if (!response?.ok) {
      if (!response) reportDiag({ level: "error", event: "translate.runtime", message: "翻译请求没有返回", direction: "receive", targetLanguage, sourceLanguage: guessSourceLanguage(text), text });
      throw new Error(response?.error || "\u7ffb\u8bd1\u5931\u8d25");
    }

    if (!normalizeText(response.text)) throw new Error('翻译结果为空');
    if (isEquivalentDraft(response.text, text)) {
      skipBubble();
      return;
    }
    if (isCurrent()) {
      state.bubbleResults.set(key, response.text);
      if (state.bubbleResults.size > 300) state.bubbleResults.delete(state.bubbleResults.keys().next().value);
      insertTranslation(textContainer, response.text, false, messageNode);
    }
  } catch (error) {
    handleRuntimeError(error);
    if (state.runtimeUnavailable) {
      reportDiag({ level: "error", event: "translate.runtime", message: formatTranslationError(error), direction: "receive", targetLanguage, sourceLanguage: guessSourceLanguage(text), text });
    }
    if (isCurrent()) insertTranslation(textContainer, formatTranslationError(error), true, messageNode);
  } finally {
    state.translatingContainers.delete(textContainer);
  }
}

function bubbleSettingsSignature(settings) {
  return JSON.stringify([settings.provider, settings.providerOrder, settings.providerEnabled, settings.providers, settings.translationPrompt]);
}

function insertTranslation(textContainer, translatedText, isError = false, messageNode = null) {
  const messageError = isError ? messageNode?.querySelector(".wa-bubble-translator-error") : null;
  if (messageError && !textContainer.contains(messageError)) return;
  const existing = textContainer.querySelector(":scope > .wa-bubble-translator-output");
  const output = existing || document.createElement("span");
  output.className = `wa-bubble-translator-output${isError ? " wa-bubble-translator-error" : ""}`;
  output.textContent = translatedText;
  output.dataset.source = extractMessageText(textContainer);
  output.dataset.language = getReceiveLanguage();
  output.dataset.settingsRevision = String(state.bubbleSettingsRevision);
  output.dir = 'auto';
  if (isError) {
    output.setAttribute('role', 'button');
    output.tabIndex = 0;
    output.title = '点击重试翻译';
    const retry = (event) => {
      if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); event.stopPropagation();
      if (state.settings.enabled && !state.translatingContainers.has(textContainer)) translateBubble(messageNode, textContainer, true);
    };
    output.onclick = retry;
    output.onkeydown = retry;
  } else {
    output.removeAttribute('role'); output.removeAttribute('tabindex'); output.removeAttribute('title');
    output.onclick = null; output.onkeydown = null;
  }

  if (!existing) {
    textContainer.appendChild(output);
  }
  // Force one cheap re-check so every container of this bubble settles before it is marked done.
  if (messageNode) delete messageNode.dataset.waTranslatorSig;
}

function removeOutput(textContainer) {
  textContainer.querySelector(":scope > .wa-bubble-translator-output")?.remove();
}

function removeError(textContainer) {
  textContainer.querySelector(":scope > .wa-bubble-translator-error")?.remove();
}

function extractMessageText(textContainer) {
  const clone = textContainer.cloneNode(true);
  // 移除翻译输出、图标、媒体，以及 WhatsApp 自带的时间/状态 UI 元素
  clone.querySelectorAll([
    ".wa-bubble-translator-output",
    "[data-icon]",
    "svg",
    "img",
    "canvas",
    "video",
    "[data-testid='msg-meta']",
    "[data-testid='msg-time']",
    "[data-testid='msg-dblchk']",
    "[data-testid='msg-check']"
  ].join(",")).forEach((node) => node.remove());
  clone.querySelectorAll(QUOTED_SELECTORS.join(",")).forEach((node) => removeBlock(node, clone));

  const textParts = [...clone.querySelectorAll("span.selectable-text, span._ao3e, span[dir='auto'], div[dir='auto'], li")]
    .filter((node, _index, nodes) => !nodes.some(other => other !== node && other.contains(node)))
    .filter((node) => !node.querySelector(".wa-bubble-translator-output"))
    .map((node) => normalizeMessageBody(node.innerText || node.textContent || ""))
    .filter(Boolean);

  const raw = textParts.length ? textParts.join("\n") : (clone.innerText || clone.textContent || "");
  const structuredText = normalizeMessageBody(raw);
  const fallbackText = normalizeMessageBody(clone.innerText || clone.textContent || "");
  return fallbackText.length > structuredText.length ? fallbackText : structuredText;
}

function enhanceComposer() {
  const input = findInput();
  if (!input) {
    return;
  }

  const footer = input.closest("footer") || input.closest("#main");
  if (!footer) {
    return;
  }

  installLanguagePrompt(footer);
  installDraftWatcher(input);
}

function installLanguagePrompt(footer) {
  if (footer.querySelector(".wa-language-prompt") && footer.dataset.waTranslatorComposerOwner === state.instanceId) {
    return;
  }
  footer.querySelector('.wa-language-prompt')?.remove();
  footer.dataset.waTranslatorComposerOwner = state.instanceId;

  const prompt = document.createElement("div");
  prompt.className = "wa-language-prompt";

  const label = document.createElement("span");
  label.className = "wa-language-prompt-label";

  const select = document.createElement("select");
  select.className = "wa-language-select";
  select.setAttribute('aria-label', '此客户的发送语言');
  select.add(createOption('自动识别', ''));
  for (const [value, labelText] of Object.entries(LANGUAGE_LABELS)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = labelText;
    select.appendChild(option);
  }
  select.addEventListener("change", async () => {
    syncComposerConversation();
    invalidateDraftTranslation('目标语言已改变，已取消旧翻译，请重新翻译');
    state.manualLanguage = select.value;
    if (state.lastConversationId) {
      state.manualLanguagesByConversation.set(state.lastConversationId, select.value);
    }
    state.draftRevision += 1;
    await saveContact({ language: select.value });
    if (!select.value) scheduleLanguageDetection();
    updateLanguagePrompt();
  });

  prompt.append(label, select);
  const tools = document.createElement('button');
  tools.type = 'button';
  tools.className = 'wa-tools-toggle';
  tools.textContent = '客户 · 常用语';
  tools.setAttribute('aria-expanded', 'false');
  tools.addEventListener('click', () => toggleChatPanel(footer, tools));
  prompt.append(tools);
  const ai = document.createElement('button');
  ai.type = 'button'; ai.className = 'wa-ai-toggle'; ai.textContent = 'AI 助手';
  ai.setAttribute('aria-expanded', 'false');
  ai.addEventListener('click', () => toggleAIPanel(footer, ai));
  prompt.append(ai);
  const summary = document.createElement('span');
  summary.className = 'wa-contact-summary wa-contact-compact';
  prompt.append(summary);
  const restore = document.createElement('button');
  restore.type = 'button';
  restore.className = 'wa-restore-draft';
  restore.textContent = '撤销翻译';
  restore.hidden = true;
  restore.addEventListener('click', async () => {
    if (state.isTranslatingDraft || state.isReplacingDraft) return;
    const draft = state.lastTranslatedDraft;
    const input = findInput();
    if (draft?.source && draft.conversationId === getConversationTitle() && isEquivalentDraft(readComposerText(input), draft.text)) {
      await replaceComposerText(input, draft.source);
      state.lastTranslatedDraft = null;
      restore.hidden = true;
    }
  });
  prompt.append(restore);
  footer.insertBefore(prompt, footer.firstChild);
  listenOwned(footer, 'click', (event) => {
    if (state.bypassSend || !state.settings.enabled) return;
    const button = event.target.closest('button, [role="button"]');
    if (!isNativeSendButton(button)) return;
    syncComposerConversation();
    const text = readComposerText(findInput());
    if (state.composing || state.isReplacingDraft || state.isTranslatingDraft) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (state.isTranslatingDraft) showComposerNotice('正在翻译，请等待完成后再点击发送');
      return;
    }
    if (shouldTranslateDraftText(text)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      translateComposer(true, Boolean(state.settings.sendAfterTranslate), true);
    } else if (state.settings.forbidChinese && containsChinese(text)) {
      event.preventDefault(); event.stopImmediatePropagation();
      showComposerNotice('请先翻译，已阻止中文发送');
    }
  }, true);
}

function updateLanguagePrompt() {
  const prompt = document.querySelector(".wa-language-prompt");
  if (!prompt || !state.settings) {
    return;
  }

  const language = getActiveSendLanguage();
  const label = prompt.querySelector(".wa-language-prompt-label");
  const select = prompt.querySelector(".wa-language-select");
  const languageText = LANGUAGE_LABELS[language] || language;

  const labelHtml = `\u53d1\u9001\u6d88\u606f\u5c06\u7ffb\u8bd1\u4e3a<span>${escapeHtml(languageText)}</span>\uff0c\u5207\u6362\u8bed\u8a00`;
  if (label.innerHTML !== labelHtml) label.innerHTML = labelHtml;
  select.value = language;
  const autoLabel = state.manualLanguage ? '恢复自动识别' : `自动 · ${languageText}`;
  if (select.options[0].textContent !== autoLabel) select.options[0].textContent = autoLabel;
  const restore = prompt.querySelector('.wa-restore-draft');
  if (restore) {
    restore.hidden = !state.lastTranslatedDraft?.source || !isEquivalentDraft(readComposerText(findInput()), state.lastTranslatedDraft.text);
    restore.disabled = state.isTranslatingDraft || state.isReplacingDraft;
  }
  updateContactSummary();
}

function installDraftWatcher(input) {
  if (state.watchedInputs.has(input)) {
    return;
  }
  state.watchedInputs.add(input);
  input.dataset.waTranslatorDraftReady = state.instanceId;
  listenOwned(input, 'compositionstart', () => {
    syncComposerConversation();
    state.composing = true;
    state.draftRevision += 1;
    invalidateDraftTranslation();
  });
  listenOwned(input, 'compositionend', () => { state.composing = false; scheduleDraftTranslation(input); });
  listenOwned(input, "input", (event) => {
    syncComposerConversation();
    const text = readComposerText(input);
    const replacement = state.composerReplacement;
    const programmatic = replacement?.input === input && (replacement.executingCommand || isEquivalentDraft(text, replacement.text)
      || (!event.isTrusted && (event.data === replacement.text || ((event.data == null || event.data === '') && ['insertText', 'insertFromPaste'].includes(event.inputType)))));
    const prepared = isTranslatedDraft(text, getActiveSendLanguage());
    if (!programmatic && !prepared) {
      state.draftRevision += 1;
      invalidateDraftTranslation();
    }
    if (!programmatic && !prepared) {
      state.lastTranslatedDraft = null;
      state.failedWrite = null;
      clearComposerNotice();
    }
    scheduleDraftTranslation(input);
  });
  listenOwned(input, "keydown", (event) => {
    syncComposerConversation();
    if (!state.settings.enabled || state.composing || event.isComposing || event.keyCode === 229 || event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    if (event.repeat || state.isReplacingDraft || state.isTranslatingDraft) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    const text = readComposerText(input);
    if (!text) {
      return;
    }

    if (shouldTranslateDraftText(text)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      translateComposer(true, Boolean(state.settings.sendAfterTranslate), true);
      return;
    }

    if (containsChinese(text) && state.settings.forbidChinese) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showComposerNotice("\u8bf7\u5148\u7ffb\u8bd1\uff0c\u5df2\u963b\u6b62\u4e2d\u6587\u53d1\u9001");
    }
  }, true);
}

async function autoTranslateDraft(input) {
  if (state.runtimeUnavailable || !state.settings.enabled || !state.settings.autoSend || state.settings.sendTrigger !== 'typing' || state.composing || input !== findInput() || !input.isConnected) return;
  const text = readComposerText(input);
  if (!text || text === state.lastDraftSource || !shouldTranslateDraftText(text) || state.isTranslatingDraft) {
    return;
  }

  await translateComposer(false);
}

function syncComposerConversation() {
  const id = getConversationTitle();
  if (id !== state.lastConversationId) switchConversation(id);
}

function invalidateDraftTranslation(reason = '') {
  const wasPending = state.isTranslatingDraft;
  clearTimeout(state.draftTimer);
  state.draftRequest = null;
  state.isTranslatingDraft = false;
  state.lastDraftSource = '';
  setComposerBusy(false);
  if (reason && wasPending) showComposerNotice(reason);
}

function scheduleDraftTranslation(input) {
  clearTimeout(state.draftTimer);
  if (!state.settings.enabled || state.composing || !state.settings.autoSend || state.settings.sendTrigger !== 'typing' || state.isReplacingDraft || !shouldTranslateDraftText(readComposerText(input))) return;
  state.draftTimer = setTimeout(() => autoTranslateDraft(input), TIMING.draftTranslate);
}

function findInput() {
  if (state.cachedInput?.isConnected) {
    return state.cachedInput;
  }
  for (const selector of INPUT_SELECTORS) {
    const node = document.querySelector(selector);
    if (node) {
      state.cachedInput = node;
      return node;
    }
  }
  state.cachedInput = null;
  return null;
}

async function translateComposer(showNotice, sendAfter = false, sendIfAlreadyTarget = false) {
  syncComposerConversation();
  if (!state.settings.enabled || state.composing) return;
  if (state.runtimeUnavailable) {
    showComposerNotice('扩展连接已失效，请刷新 WhatsApp 页面后重试', { error: true });
    return;
  }
  if (state.isTranslatingDraft) {
    if (showNotice) {
      showComposerNotice("\u6b63\u5728\u7ffb\u8bd1\uff0c\u8bf7\u7a0d\u5019");
    }
    return;
  }

  const input = findInput();
  const displayedText = readComposerText(input);
  if (!input || (!displayedText && !(state.failedWrite?.input === input && state.failedWrite.conversationId === getConversationTitle() && state.failedWrite.current === ''))) {
    if (showNotice) {
      showComposerNotice("\u6ca1\u6709\u53ef\u7ffb\u8bd1\u7684\u5185\u5bb9");
    }
    return;
  }
  if (!shouldTranslateDraftText(displayedText)) return;

  let resultLabel = "";
  let resultError = false;
  let preparedDraft = null;
  const conversationId = getConversationTitle();
  const targetLanguage = getActiveSendLanguage();
  const previous = state.lastTranslatedDraft;
  // An explicit target change translates the original source, not the last translation.
  const failedWrite = state.failedWrite;
  const text = failedWrite?.conversationId === conversationId && failedWrite.input === input && isEquivalentDraft(failedWrite.current, displayedText)
    ? failedWrite.source : previous?.source && previous.conversationId === conversationId && isEquivalentDraft(previous.text, displayedText)
    ? previous.source : displayedText;
  const revision = state.draftRevision;
  const request = { conversationId, targetLanguage, input, manualLanguage: state.manualLanguage };
  const isCurrent = () => state.draftRequest === request && state.settings.enabled && !state.composing
    && ownsPage()
    && revision === state.draftRevision && conversationId === getConversationTitle()
    && input === findInput() && targetLanguage === getActiveSendLanguage();
  state.draftRequest = request;
  state.lastDraftSource = text;
  clearTimeout(state.draftTimer);
  state.isTranslatingDraft = true;
  setComposerBusy(true);

  try {
    {
      let detection;
      try { detection = await chrome.i18n.detectLanguage(text.slice(0, 1000)); } catch { /* No reliable local detection: use the configured translator. */ }
      if (!isCurrent()) return;
      const best = detection?.languages?.[0];
      const sameLanguage = isSameLanguage(best?.language, targetLanguage);
      const reliable = detection?.isReliable === true && best?.percentage >= 85;
      // Preserve the English default for uncertain Latin text, but translate reliably detected foreign prose.
      const assumedEnglish = targetLanguage === 'en' && !/(?=\p{L})\P{Script=Latin}/u.test(text) && !reliable;
      if ((reliable && sameLanguage) || assumedEnglish) {
        preparedDraft = { text, source: '', targetLanguage, conversationId, manualLanguage: state.manualLanguage };
        state.lastTranslatedDraft = preparedDraft;
        if (!isEquivalentDraft(text, displayedText)) {
          await replaceComposerText(input, text);
          if (!isCurrent()) return;
          if (!isEquivalentWrittenDraft(readComposerText(input), text)) {
            state.failedWrite = { input, source: text, current: readComposerText(input), conversationId };
            throw new Error('原文未能完整写入输入框，请重试');
          }
        }
        state.failedWrite = null;
        updateLanguagePrompt();
        resultLabel = '当前草稿已是目标语言，可直接发送';
        if (sendIfAlreadyTarget) {
          const sent = noteSendAttempt(triggerNativeSend(input, text), { targetLanguage, text, message: "已是目标语言，但未能触发 WhatsApp 发送" });
          resultLabel = sent ? '已触发发送，请查看消息状态' : '未能触发发送，请手动点击发送按钮';
        }
        return;
      }
    }
    const response = await chrome.runtime.sendMessage({
      type: "translate",
      payload: {
        text,
        targetLanguage,
        sourceLanguage: guessSourceLanguage(text),
        direction: "send"
      }
    });

    if (!response?.ok) {
      if (!response) reportDiag({ level: "error", event: "translate.runtime", message: "发送翻译请求没有返回", direction: "send", targetLanguage, sourceLanguage: guessSourceLanguage(text), text });
      throw new Error(response?.error || "\u7ffb\u8bd1\u5931\u8d25");
    }

    if (!isCurrent() || !isEquivalentDraft(readComposerText(input), displayedText)) {
      resultLabel = '草稿或会话已改变，已忽略旧译文';
      return;
    }
    if (!normalizeText(response.text)) throw new Error('翻译结果为空');
    preparedDraft = {
      text: normalizeText(response.text), targetLanguage, source: text, conversationId, manualLanguage: state.manualLanguage
    };
    // Set provenance before Lexical can echo a delayed paste/input event.
    state.lastTranslatedDraft = preparedDraft;
    await replaceComposerText(input, response.text);
    if (!isCurrent()) return;
    if (!isEquivalentWrittenDraft(readComposerText(input), response.text)) {
      state.failedWrite = { input, source: text, current: readComposerText(input), conversationId };
      throw new Error('译文未能写入输入框，原文已保留在提示中，请重试');
    }
    state.failedWrite = null;
    updateLanguagePrompt();
    resultLabel = "\u5df2\u7ffb\u8bd1\uff0c\u518d\u6309 Enter \u53d1\u9001";
    if (sendAfter && isCurrent()) {
      if (state.settings.forbidChinese && containsChinese(response.text)) {
        resultLabel = '译文仍含中文，请检查后发送';
      } else {
        if (noteSendAttempt(triggerNativeSend(input, response.text), { targetLanguage, text: response.text, message: "译文已填入，但未能触发 WhatsApp 发送" })) {
          resultLabel = '已触发发送，请查看消息状态';
        } else resultLabel = '译文已填入，请点击发送';
      }
    }
  } catch (error) {
    if (state.draftRequest !== request) return;
    handleRuntimeError(error);
    if (state.lastTranslatedDraft === preparedDraft) state.lastTranslatedDraft = null;
    resultError = true;
    resultLabel = formatTranslationError(error);
    state.lastDraftSource = '';
    if (/写入输入框/.test(resultLabel)) {
      reportDiag({ level: "error", event: "composer.write_failure", message: resultLabel, direction: "send", targetLanguage, sourceLanguage: guessSourceLanguage(text), text });
    } else if (state.runtimeUnavailable) {
      reportDiag({ level: "error", event: "translate.runtime", message: resultLabel, direction: "send", targetLanguage, sourceLanguage: guessSourceLanguage(text), text });
    }
  } finally {
    if (ownsPage() && state.draftRequest === request) {
      state.draftRequest = null;
      state.isTranslatingDraft = false;
      setComposerBusy(false);
      updateLanguagePrompt();
      if (conversationId === getConversationTitle() && (showNotice || resultLabel)) showComposerNotice(resultLabel, { error: resultError, retry: resultError && !state.runtimeUnavailable ? () => translateComposer(true) : null, originalText: resultError ? state.failedWrite?.source : '' });
    }
  }
}

function isNativeSendButton(button) {
  if (!button || !button.closest('#main footer')) return false;
  if (button.matches('[data-testid="compose-btn-send"]') || button.querySelector('[data-icon="send"], [data-icon="wds-ic-send-filled"], [data-icon="wds-ic-send"]')) return true;
  return /^(?:send(?: message)?|发送(?:消息)?|傳送(?:訊息)?|enviar|envoyer|senden|отправить|إرسال)$/i.test((button.getAttribute('aria-label') || button.getAttribute('title') || '').trim());
}

function triggerNativeSend(input, expectedText) {
  if (state.composing || !state.settings.enabled || (state.settings.forbidChinese && containsChinese(expectedText)) || input !== findInput() || !isEquivalentDraft(readComposerText(input), expectedText)) return false;
  const send = [...document.querySelectorAll('#main footer button, #main footer [role="button"]')].find(isNativeSendButton);
  if (!send || send.disabled || send.getAttribute('aria-disabled') === 'true') return false;
  state.bypassSend = true;
  try { send.click(); } finally { state.bypassSend = false; }
  return true;
}

async function replaceComposerText(input, text) {
  const replacement = { input, text, revision: state.draftRevision, conversationId: getConversationTitle() };
  state.composerReplacement = replacement;
  state.isReplacingDraft = true;
  try {
    input.focus();

    const data = new DataTransfer();
    data.setData("text/plain", text);
    const pasteEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: data
    });

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    selection.removeAllRanges();
    selection.addRange(range);
    const accepted = input.dispatchEvent(pasteEvent);
    if (accepted) {
      replacement.executingCommand = true;
      try { if (!document.execCommand("insertText", false, text)) return; }
      finally { replacement.executingCommand = false; }
    }

    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text
    }));

    const deadline = Date.now() + 500;
    while (!isEquivalentWrittenDraft(readComposerText(input), text) && Date.now() < deadline) {
      if (!input.isConnected || input !== findInput() || state.draftRevision !== replacement.revision || getConversationTitle() !== replacement.conversationId) return;
      await new Promise(resolve => setTimeout(resolve, 15));
    }

  } finally {
    if (state.composerReplacement === replacement) {
      state.composerReplacement = null;
      state.isReplacingDraft = false;
      if (state.draftRevision !== replacement.revision && input === findInput()) scheduleDraftTranslation(input);
    }
  }
}

async function updateDetectedLanguage() {
  if (!state.settings.enabled || !state.settings.autoDetectLanguage || state.manualLanguage || state.isDetectingLanguage) {
    return;
  }

  const conversationId = getConversationTitle();
  if (conversationId && conversationId !== state.lastConversationId) {
    switchConversation(conversationId);
    return;
  }

  const incomingText = getIncomingLanguageSample();

  if (incomingText.length < 3) {
    return;
  }

  const signature = `${state.lastConversationId || "unknown"}:${incomingText.slice(-1000)}`;
  if (signature === state.lastLanguageDetectionSignature) {
    return;
  }

  state.isDetectingLanguage = true;
  try {
    const result = await chrome.i18n.detectLanguage(incomingText.slice(0, 1000));
    if (!state.settings.enabled || conversationId !== getConversationTitle() || state.manualLanguage || !state.settings.autoDetectLanguage) return;
    const first = result?.languages?.[0];
    const detected = DETECT_MAP[first?.language];
    // Only reliable detections count, and an established language needs stronger evidence to change.
    const minimum = state.detectedLanguage ? 85 : 70;
    if (detected && result.isReliable === true && first.percentage >= minimum && detected !== state.detectedLanguage) {
      const previousLanguage = getActiveSendLanguage();
      state.detectedLanguage = detected;
      if (getActiveSendLanguage() !== previousLanguage) {
        invalidateDraftTranslation();
        state.draftRevision += 1;
      }
      await saveContact({ detectedLanguage: detected });
      if (conversationId !== getConversationTitle()) return;
      if (state.lastConversationId) {
        state.detectedLanguagesByConversation.set(state.lastConversationId, detected);
      }
      updateLanguagePrompt();
    }
    state.lastLanguageDetectionSignature = signature;
  } catch (error) {
    console.warn("[WhatsApp Translator] language detection failed", error);
  } finally {
    state.isDetectingLanguage = false;
  }
}

function formatTranslationError(error) {
  let message = String(error?.message || error || "\u7ffb\u8bd1\u5931\u8d25").replace(/\s+/g, " ").trim();
  if (/extension context invalidated|receiving end does not exist|could not establish connection|message port closed/i.test(message)) return '扩展连接已失效，请刷新 WhatsApp 页面后重试';
  if (/failed to fetch|fetch failed|networkerror|network request failed|ERR_(?:INTERNET_DISCONNECTED|CONNECTION|NETWORK)/i.test(message)) return '无法连接翻译服务，请检查网络、代理或接口地址后重试';
  if (/<!doctype|<html|<head|<body|content-type/i.test(message)) {
    return "翻译服务暂时不可用，请稍后重试";
  }
  try { if (globalThis.WbtDiag?.redactString) message = globalThis.WbtDiag.redactString(message); } catch { /* keep the readable error */ }
  return message.length > 180 ? `${message.slice(0, 177)}...` : message;
}

function guessSourceLanguage(text) {
  return containsChinese(text) ? "zh" : "auto";
}

function reportDiag(partial) {
  try { globalThis.WbtDiag?.record?.(partial); } catch { /* diagnostics must not block the composer */ }
}

function noteSendSuccess() {
  state.consecutiveSendFailures = 0;
}

function noteSendFailure(partial) {
  state.consecutiveSendFailures += 1;
  const attempt = state.consecutiveSendFailures;
  const fingerprint = { targetLanguage: partial.targetLanguage, sourceLanguage: guessSourceLanguage(partial.text), text: partial.text, attempt };
  reportDiag({ level: "error", event: "composer.send_failure", message: partial.message || "未能触发发送", ...fingerprint });
  if (attempt >= 2) {
    reportDiag({ level: "error", event: "composer.send_repeated_failure", message: `连续 ${attempt} 次未能触发发送`, ...fingerprint });
  }
}

function noteSendAttempt(sent, partial) {
  if (sent) noteSendSuccess();
  else noteSendFailure(partial);
  return sent;
}

function getIncomingLanguageSample() {
  return findMessageNodes()
    .filter((node) => getMessageDirection(node, findAllTextContainers(node)[0]) === "incoming")
    .slice(-8)
    .flatMap((node) => findAllTextContainers(node).map(extractMessageText))
    .filter(hasTranslatableText)
    .join(" ");
}

function getActiveSendLanguage() {
  const id = getConversationTitle();
  const input = findInput();
  const request = state.draftRequest;
  if (request && request.conversationId === id && request.input === input && request.manualLanguage === state.manualLanguage) return request.targetLanguage;
  const draft = state.lastTranslatedDraft;
  if (draft && draft.conversationId === id && (draft.manualLanguage || '') === state.manualLanguage && isEquivalentDraft(readComposerText(input), draft.text)) return draft.targetLanguage;
  return state.manualLanguage || (state.settings.autoDetectLanguage && state.detectedLanguage) || state.settings.sendLanguage || "en";
}

function isEquivalentDraft(first, second) {
  const canonical = text => normalizeText(text).replace(/[\u200b\u200e\u200f\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  return canonical(first) === canonical(second);
}

function isEquivalentWrittenDraft(first, second) {
  const clean = text => normalizeText(String(text || '').replace(/\r\n?/g, '\n')).replace(/[\u200b\u200e\u200f\ufeff]/g, '');
  return clean(first) === clean(second);
}

function readComposerText(input) {
  if (!input) return '';
  const isBlock = node => node.nodeType === Node.ELEMENT_NODE && /^(DIV|P|LI)$/.test(node.tagName);
  const readNode = node => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (node.tagName === 'BR') return '\n';
    if (node.tagName === 'IMG') return node.getAttribute('alt') || '';
    const children = [...node.childNodes];
    // Lexical uses a sole BR as an empty paragraph/caret placeholder.
    const meaningful = children.filter(child => child.nodeType === Node.ELEMENT_NODE || child.textContent);
    if ((node === input || isBlock(node)) && meaningful.length === 1 && meaningful[0].nodeName === 'BR') return '';
    let text = '';
    children.forEach((child, index) => {
      if (index > 0 && (isBlock(child) || isBlock(children[index - 1]))) text += '\n';
      text += readNode(child);
    });
    return text;
  };
  return normalizeText(readNode(input).replace(/\r\n?/g, '\n'));
}

function shouldTranslateDraftText(text) {
  if (state.failedWrite?.conversationId === getConversationTitle() && state.failedWrite.input === findInput() && isEquivalentDraft(state.failedWrite.current, text)) return true;
  const targetLanguage = getActiveSendLanguage();
  if (!hasTranslatableText(text) || isTranslatedDraft(text, targetLanguage)) {
    return false;
  }
  if (containsChinese(text)) {
    return !targetLanguage.startsWith("zh");
  }
  return true;
}

// Translate prose; keep standalone contact details, identifiers and symbols intact.
function hasTranslatableText(text) {
  const plain = normalizeText(text).replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '');
  if (/^ok[.!]*$/i.test(plain)) return false;
  const stripped = plain
    .replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, '')
    .replace(/[a-z\d._%+-]+@[a-z\d.-]+\.[a-z]{2,}/gi, '')
    .replace(/\b(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}(?:[/:?#][^\s<>]*)?/gi, '')
    .replace(/\b(?:USD|EUR|GBP|CNY|RMB|JPY|HKD|AUD|CAD|CHF)\s*(?=[\d.,])/g, '')
    .replace(/([\d.,])\s*(?:USD|EUR|GBP|CNY|RMB|JPY|HKD|AUD|CAD|CHF)\b/g, '$1')
    .replace(/(\d{1,2}:\d{2}(?::\d{2})?)\s*[AP]M\b/gi, '$1');
  return stripped.split(/\s+/).some(token => {
    const identifier = token.replace(/^[([{]+|[)\]},;!]+$/g, '');
    if (/^(?=.*\d)[A-Z\d]+(?:[-_/.][A-Z\d]+)*$/.test(identifier)
      || /^[a-z]+[-_/]\d+[a-z\d_-]*$/i.test(identifier)) return false;
    return /\p{L}/u.test(token);
  });
}

function isTranslatedDraft(text, targetLanguage) {
  return Boolean(
    state.lastTranslatedDraft
      && state.lastTranslatedDraft.targetLanguage === targetLanguage
      && state.lastTranslatedDraft.conversationId === getConversationTitle()
      && isEquivalentDraft(state.lastTranslatedDraft.text, text)
  );
}

function getReceiveLanguage() {
  return state.settings.receiveLanguage || "zh-CN";
}

async function saveSettings(partial) {
  const stored = await chrome.storage.sync.get("settings");
  const settings = { ...state.settings, ...(stored.settings || {}), ...partial };
  if (settings.sendTrigger === "manual") {
    settings.sendTrigger = "enter";
    settings.autoSend = false;
  }
  state.settings = settings;
  await chrome.storage.sync.set({ settings });
}

function setComposerBusy(isBusy) {
  const prompt = document.querySelector('.wa-language-prompt');
  if (!prompt) return;
  prompt.classList.toggle('wa-language-prompt-busy', isBusy);
  if (isBusy) {
    clearComposerNotice();
    const status = getComposerStatus(prompt);
    status.hidden = false;
    status.setAttribute('role', 'status');
    status.querySelector('span').textContent = '翻译中，可继续编辑草稿…';
  } else if (!prompt.classList.contains('wa-language-prompt-notice')) {
    const status = getComposerStatus(prompt); status.hidden = true; status.querySelector('span').textContent = '';
  }
}

function getComposerStatus(prompt) {
  let status = prompt.querySelector('.wa-composer-status');
  if (status) return status;
  status = document.createElement('div');
  status.className = 'wa-composer-status';
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;
  status.append(document.createElement('span'));
  prompt.append(status);
  return status;
}

function clearComposerNotice() {
  clearTimeout(state.noticeTimer);
  const prompt = document.querySelector('.wa-language-prompt');
  if (!prompt) return;
  prompt.classList.remove('wa-language-prompt-notice');
  delete prompt.dataset.notice;
  const status = getComposerStatus(prompt);
  status.querySelectorAll('button').forEach(button => button.remove());
  status.querySelector('details')?.remove();
  status.classList.remove('wa-composer-status-error');
  status.hidden = true;
}

function handleRuntimeError(error) {
  if (!/extension context invalidated|receiving end does not exist|could not establish connection/i.test(String(error?.message || error))) return;
  state.runtimeUnavailable = true;
  state.observer?.disconnect();
  for (const timer of ['scanInterval', 'conversationInterval']) clearInterval(state[timer]);
  for (const timer of ['scanTimer', 'draftTimer', 'detectTimer']) clearTimeout(state[timer]);
}

function showComposerNotice(label, { error = false, retry = null, originalText = '' } = {}) {
  const prompt = document.querySelector(".wa-language-prompt");
  if (!prompt) {
    return;
  }
  prompt.dataset.notice = label;
  prompt.classList.add("wa-language-prompt-notice");
  clearTimeout(state.noticeTimer);
  const status = getComposerStatus(prompt);
  status.hidden = false;
  status.classList.toggle('wa-composer-status-error', error);
  status.setAttribute('role', error ? 'alert' : 'status');
  status.querySelector('span').textContent = label;
  status.querySelectorAll('button').forEach(button => button.remove());
  status.querySelector('details')?.remove();
  if (error) {
    if (retry) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '重试翻译';
      button.addEventListener('click', retry); status.append(button);
    }
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '关闭提示';
    close.addEventListener('click', clearComposerNotice); status.append(close);
    if (originalText) {
      const details = document.createElement('details'); details.className = 'wa-composer-original';
      const summary = document.createElement('summary'); summary.textContent = '查看／复制保留的原文';
      const original = document.createElement('textarea'); original.readOnly = true; original.value = originalText; original.setAttribute('aria-label', '保留的原文');
      details.append(summary, original); status.append(details);
      const restore = document.createElement('button'); restore.type = 'button'; restore.textContent = '恢复原稿';
      const backup = state.failedWrite;
      restore.addEventListener('click', async () => {
        const input = findInput();
        if (backup !== state.failedWrite || !input || state.composing || state.isTranslatingDraft || state.isReplacingDraft
          || backup?.input !== input || backup.conversationId !== getConversationTitle() || !isEquivalentDraft(readComposerText(input), backup.current)) return;
        const revision = state.draftRevision;
        restore.disabled = true;
        await replaceComposerText(input, originalText);
        if (!ownsPage() || revision !== state.draftRevision || input !== findInput() || backup !== state.failedWrite) return;
        state.lastTranslatedDraft = null;
        if (isEquivalentWrittenDraft(readComposerText(input), originalText)) {
          state.failedWrite = null; clearComposerNotice(); updateLanguagePrompt();
        } else {
          backup.current = readComposerText(input); restore.disabled = false;
          status.querySelector('span').textContent = '原稿未能完整写入，请复制保留的原文后粘贴';
        }
      });
      status.append(restore);
    }
  } else state.noticeTimer = setTimeout(clearComposerNotice, 2300);
}

function isInViewport(node) {
  const rect = node.getBoundingClientRect();
  const height = window.innerHeight || document.documentElement.clientHeight;
  return rect.bottom > 0 && rect.top < height;
}

function isRenderableNode(node, scopeRoot) {
  if (!(node instanceof Element)) {
    return false;
  }
  if (scopeRoot && !scopeRoot.contains(node)) {
    return false;
  }
  if (node.hidden || node.getAttribute("aria-hidden") === "true") {
    return false;
  }
  const inlineStyle = (node.getAttribute("style") || "").toLowerCase();
  if (inlineStyle.includes("display:none") || inlineStyle.includes("display: none") || inlineStyle.includes("visibility:hidden") || inlineStyle.includes("visibility: hidden")) {
    return false;
  }
  if (node.closest("[hidden], [aria-hidden='true']")) {
    return false;
  }
  const style = window.getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  return true;
}

function containsChinese(text) {
  return /[\u3400-\u9fff]/.test(text);
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function normalizeMessageBody(text) {
  return normalizeText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !isSystemBubbleLine(line))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isSystemBubbleLine(line) {
  const clean = normalizeText(line).toLowerCase();
  if (!clean) {
    return true;
  }
  return /^\d+\s*(?:张|個|个)?\s*(?:照片|图片|images?|photos?)$/i.test(clean)
    || SYSTEM_LINE_PATTERNS.some((pattern) => pattern.test(clean));
}

function removeBlock(node, root) {
  if (node.hasAttribute("data-pre-plain-text")) {
    const block = node.closest("[data-pre-plain-text]") || node;
    block.remove();
    return;
  }
  const quotedByLabel = node.closest("[aria-label*='Quoted'], [aria-label*='引用']");
  if (quotedByLabel && root.contains(quotedByLabel) && quotedByLabel !== root) {
    quotedByLabel.remove();
    return;
  }
  node.remove();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function saveContact(partial) {
  const id = state.lastConversationId;
  if (!id) return;
  const profile = { ...state.profiles[id], ...partial };
  state.profiles[id] = profile;
  try {
    await chrome.storage.local?.set({ [`contact:${id}`]: profile });
  } catch {
    showComposerNotice('客户设置保存失败，请重试');
  }
}

function createOption(label, value) {
  const option = document.createElement('option');
  option.textContent = label;
  option.value = value;
  return option;
}

function toggleAIPanel(footer, toggle) {
  const previous = footer.querySelector('.wa-ai-panel');
  if (previous) { previous.remove(); toggle.setAttribute('aria-expanded', 'false'); return; }
  const panel = document.createElement('section');
  panel.className = 'wa-ai-panel';
  panel.setAttribute('aria-label', 'AI 回复助手');
  panel.innerHTML = `<div class="wa-ai-head"><strong>AI 回复助手</strong><span>生成后预览，确认再填入</span></div>
    <p>建议回复会使用当前会话最近 8 条文字消息；润色仅使用草稿。内容发送至已配置的 AI 引擎。</p>
    <div class="wa-ai-actions"><button type="button" data-action="reply">建议回复</button><button type="button" data-action="polish">润色草稿</button></div>
    <p class="wa-ai-status" role="status" aria-live="polite">点击生成，结果可编辑。</p>
    <textarea class="wa-ai-result" rows="3" aria-label="AI 回复预览" placeholder="AI 建议将在这里显示" hidden></textarea>
    <button type="button" class="wa-ai-apply" hidden>填入草稿</button>`;
  footer.insertBefore(panel, footer.querySelector('.wa-language-prompt').nextSibling);
  toggle.setAttribute('aria-expanded', 'true');
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { panel.remove(); toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); }
  });
  const status = panel.querySelector('.wa-ai-status');
  const output = panel.querySelector('textarea');
  const apply = panel.querySelector('.wa-ai-apply');
  const buttons = [...panel.querySelectorAll('[data-action]')];
  let snapshot;
  for (const button of buttons) button.addEventListener('click', async () => {
    if (!state.settings.enabled || state.isTranslatingDraft) { status.textContent = '请先开启插件，并等待草稿翻译完成'; return; }
    const input = findInput();
    snapshot = { conversationId: getConversationTitle(), input, draft: readComposerText(input), language: getActiveSendLanguage(), revision: state.draftRevision };
    const action = button.dataset.action;
    if (action === 'polish' && !snapshot.draft) { status.textContent = '请先输入需要润色的草稿'; return; }
    buttons.forEach(item => { item.disabled = true; });
    output.hidden = true; apply.hidden = true;
    status.textContent = 'AI 正在生成…';
    try {
      const messages = action === 'reply' ? findMessageNodes().slice(-8).map(node => ({ direction: getMessageDirection(node, findAllTextContainers(node)[0]), text: findAllTextContainers(node).map(extractMessageText).join('\n') })) : [];
      const response = await chrome.runtime.sendMessage({ type: 'aiAssist', payload: { action, draft: snapshot.draft, targetLanguage: snapshot.language, messages } });
      if (!panel.isConnected || snapshot.conversationId !== getConversationTitle()) return;
      if (!response) {
        reportDiag({ level: "error", event: "ai.runtime", message: "AI 请求没有返回", action, targetLanguage: snapshot.language, text: snapshot.draft });
        throw new Error('AI 生成失败');
      }
      if (!response.ok) throw new Error(response.error || 'AI 生成失败');
      if (!normalizeText(response.text)) throw new Error('AI 返回空内容');
      output.value = response.text; output.hidden = false; apply.hidden = false;
      status.textContent = `由 ${response.providerName || response.provider || 'AI'} 生成 · 请核对事实与承诺后填入`;
    } catch (error) {
      if (panel.isConnected) status.textContent = formatTranslationError(error);
      if (state.runtimeUnavailable) reportDiag({ level: "error", event: "ai.runtime", message: formatTranslationError(error), action, targetLanguage: snapshot.language, text: snapshot.draft });
    }
    finally { buttons.forEach(item => { item.disabled = false; }); }
  });
  apply.addEventListener('click', async () => {
    const input = findInput();
    if (!snapshot || !state.settings.enabled || state.isTranslatingDraft || state.composing || snapshot.conversationId !== getConversationTitle() || snapshot.language !== getActiveSendLanguage() || snapshot.input !== input || snapshot.revision !== state.draftRevision || readComposerText(input) !== snapshot.draft) {
      status.textContent = '草稿、会话或语言已改变，请重新生成，避免覆盖新内容'; return;
    }
    const text = normalizeText(output.value);
    if (!text) { status.textContent = '回复内容不能为空'; return; }
    const prepared = { text, targetLanguage: snapshot.language, source: snapshot.draft, conversationId: snapshot.conversationId, manualLanguage: state.manualLanguage };
    state.lastTranslatedDraft = prepared;
    apply.disabled = true;
    try {
      await replaceComposerText(input, text);
      if (!ownsPage() || snapshot.revision !== state.draftRevision || input !== findInput() || snapshot.conversationId !== getConversationTitle() || snapshot.language !== getActiveSendLanguage()) return;
      if (!isEquivalentWrittenDraft(readComposerText(input), text)) {
        state.lastTranslatedDraft = null;
        state.failedWrite = { input, source: snapshot.draft || text, current: readComposerText(input), conversationId: snapshot.conversationId };
        status.textContent = 'AI 草稿未能完整写入，请恢复原稿或复制预览内容后粘贴';
        reportDiag({ level: "error", event: "ai.apply_failure", message: status.textContent, action: "apply", targetLanguage: snapshot.language, text: snapshot.draft || text });
        showComposerNotice(status.textContent, { error: true, originalText: state.failedWrite.source });
        return;
      }
      state.failedWrite = null;
      apply.hidden = true; updateLanguagePrompt();
      status.textContent = '已填入草稿，检查后自行发送';
    } catch (error) {
      handleRuntimeError(error); if (state.lastTranslatedDraft === prepared) state.lastTranslatedDraft = null;
      status.textContent = formatTranslationError(error);
    } finally { apply.disabled = false; }
  });
}

function getContactRegion() {
  const profile = state.profiles[state.lastConversationId] || {};
  const id = state.lastConversationId;
  // Group JIDs and opaque LIDs must never be interpreted as phone numbers.
  const phone = /@(?:c\.us|s\.whatsapp\.net)$/.test(id) ? id.split('@')[0] : (/^\+[\d\s()-]+$/.test(id) ? id : '');
  return { profile, region: profile.region || (phone && globalThis.WAChatTools?.inferRegion(phone)) || '' };
}

function updateContactSummary() {
  const summaries = document.querySelectorAll('.wa-contact-summary');
  if (!summaries.length) return;
  const { profile, region } = getContactRegion();
  const info = globalThis.WAChatTools?.regions[region];
  if (!info) { summaries.forEach(summary => { if (summary.textContent !== '地区未知 · 可手动选择客户地区') summary.textContent = '地区未知 · 可手动选择客户地区'; }); return; }
  const zone = info[2].includes(profile.timeZone) ? profile.timeZone : (info[2].length === 1 ? info[2][0] : '');
  const time = zone ? new Intl.DateTimeFormat('zh-CN', { timeZone: zone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()) : '多个时区，请选择';
  const text = `${info[0]} · ${info[1]} · ${time}${profile.region ? '' : '（号码推测）'}`;
  summaries.forEach(summary => { if (summary.textContent !== text) summary.textContent = text; });
}

function toggleChatPanel(footer, toggle) {
  const old = footer.querySelector('.wa-chat-panel');
  if (old) { old.remove(); toggle.setAttribute('aria-expanded', 'false'); return; }
  toggle.setAttribute('aria-expanded', 'true');
  const panel = document.createElement('section');
  panel.className = 'wa-chat-panel';
  panel.setAttribute('aria-label', '客户资料和常用语');
  panel.innerHTML = `<div class="wa-contact-summary" role="status"></div>
    <div class="wa-contact-fields"><label>客户地区 <select class="wa-region"><option value="">按号码识别</option></select></label>
    <label>当地时区 <select class="wa-timezone"><option value="">请选择</option></select></label></div>
    <div class="wa-phrase-heading"><strong>常用语</strong><span>点击填入草稿，按 Enter 翻译</span></div>
    <input class="wa-phrase-search" type="search" placeholder="搜索常用语" aria-label="搜索常用语">
    <div class="wa-phrase-list"></div>
    <form class="wa-phrase-form"><input name="title" maxlength="40" required placeholder="标题" aria-label="常用语标题">
    <textarea name="text" maxlength="2000" required placeholder="常用语内容" aria-label="常用语内容" rows="2"></textarea>
    <button type="submit">保存常用语</button><span class="wa-phrase-status" role="status"></span></form>`;
  footer.insertBefore(panel, footer.querySelector('.wa-language-prompt').nextSibling);
  panel.addEventListener('keydown', (event) => { if (event.key === 'Escape') { panel.remove(); toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); } });
  const regionSelect = panel.querySelector('.wa-region');
  for (const [code, item] of Object.entries(globalThis.WAChatTools?.regions || {})) regionSelect.add(createOption(item[0], code));
  regionSelect.value = getContactRegion().profile.region || '';
  const zones = panel.querySelector('.wa-timezone');
  const renderZones = () => {
    const { region, profile } = getContactRegion();
    const choices = globalThis.WAChatTools?.regions[region]?.[2] || [];
    zones.replaceChildren(createOption(choices.length === 1 ? '使用地区时区' : '请选择时区', ''));
    choices.forEach((zone) => zones.add(createOption(zone.replaceAll('_', ' '), zone)));
    zones.value = profile.timeZone || '';
    updateContactSummary();
  };
  regionSelect.addEventListener('change', async () => { await saveContact({ region: regionSelect.value, timeZone: '' }); renderZones(); });
  zones.addEventListener('change', async () => { await saveContact({ timeZone: zones.value }); updateContactSummary(); });
  renderZones();
  const status = panel.querySelector('.wa-phrase-status');
  const form = panel.querySelector('form');
  let editing = null;
  const persist = async (next) => {
    try {
      await chrome.storage.local?.set({ quickPhrases: next });
      state.phrases = next;
      status.textContent = '已保存';
      renderPhrases();
      return true;
    } catch { status.textContent = '保存失败，请重试'; return false; }
  };
  const renderPhrases = () => {
    const list = panel.querySelector('.wa-phrase-list');
    const query = panel.querySelector('.wa-phrase-search').value.trim().toLocaleLowerCase();
    list.replaceChildren();
    state.phrases.forEach((phrase, index) => {
      if (!`${phrase.title} ${phrase.text}`.toLocaleLowerCase().includes(query)) return;
      const row = document.createElement('div');
      const use = document.createElement('button');
      use.type = 'button';
      use.textContent = phrase.title;
      use.title = phrase.text;
      use.addEventListener('click', async () => {
        const input = findInput();
        if (!input || state.isTranslatingDraft) { status.textContent = '请等待当前翻译完成'; return; }
        if (readComposerText(input)) { status.textContent = '草稿已有内容，请先发送或清空'; return; }
        state.draftRevision += 1;
        state.lastTranslatedDraft = null;
        await replaceComposerText(input, phrase.text);
        status.textContent = '已填入草稿';
      });
      const edit = document.createElement('button');
      edit.type = 'button'; edit.textContent = '编辑';
      edit.setAttribute('aria-label', `编辑 ${phrase.title}`);
      edit.addEventListener('click', () => { editing = index; form.elements.title.value = phrase.title; form.elements.text.value = phrase.text; form.elements.title.focus(); });
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = '删除';
      remove.setAttribute('aria-label', `删除 ${phrase.title}`);
      remove.addEventListener('click', async () => { if (await persist(state.phrases.filter((_, i) => i !== index))) { editing = null; form.reset(); } });
      row.append(use, edit, remove); list.append(row);
    });
    if (!list.children.length) list.textContent = '没有匹配的常用语';
  };
  panel.querySelector('.wa-phrase-search').addEventListener('input', renderPhrases);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const phrase = { title: form.elements.title.value.trim(), text: form.elements.text.value.trim() };
    if (!phrase.title || !phrase.text) return;
    const next = [...state.phrases];
    if (editing === null) next.push(phrase); else next[editing] = phrase;
    if (next.length > 100) { status.textContent = '最多保存 100 条常用语'; return; }
    if (await persist(next)) { editing = null; form.reset(); }
  });
  renderPhrases();
}
