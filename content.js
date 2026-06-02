const MESSAGE_SELECTOR = ".message-in, .message-out";
const TEXT_SELECTORS = [
  "span.selectable-text.copyable-text",
  "div.copyable-text span.selectable-text",
  "span._ao3e.selectable-text.copyable-text",
  "span._akbu",
  "div.copyable-text",
  "div[dir='auto']",
  ".copyable-text"
];
const INPUT_SELECTORS = [
  "#main footer div[contenteditable='true'][role='textbox']",
  "#main div[contenteditable='true'][role='textbox']",
  "footer div[contenteditable='true']"
];
const QUOTED_SELECTORS = [
  "[data-pre-plain-text]",
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
  lastConversationId: "",
  lastLanguageDetectionSignature: "",
  detectedLanguagesByConversation: new Map(),
  manualLanguagesByConversation: new Map()
};

init();

async function init() {
  state.settings = await loadSettings();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.settings) {
      state.settings = { ...state.settings, ...changes.settings.newValue };
      updateLanguagePrompt();
      scheduleScan();
    }
  });

  scanPage();
  installObserver();
  setInterval(scanPage, 1500);
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
  state.scanTimer = setTimeout(scanPage, 250);
}

// 获取当前对话标题，用多个 selector 兜底
function getConversationTitle() {
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
  return window.location.href + window.location.hash;
}

// 对话切换检测：独立 interval + URL 事件双保险
function watchConversationSwitch() {
  const check = () => {
    const currentId = getConversationTitle();
    if (!currentId || currentId === state.lastConversationId) return;
    switchConversation(currentId);
  };
  check();
  setInterval(check, 600);
  window.addEventListener("hashchange", check);
  window.addEventListener("popstate", check);
}

function switchConversation(conversationId) {
  state.lastConversationId = conversationId;
  state.manualLanguage = state.manualLanguagesByConversation.get(conversationId) || "";
  state.detectedLanguage = state.detectedLanguagesByConversation.get(conversationId) || "";
  state.lastLanguageDetectionSignature = "";
  clearTimeout(state.detectTimer);
  scheduleLanguageDetection();
  updateLanguagePrompt();
}

function scanPage() {
  if (!state.settings.enabled) {
    return;
  }
  scheduleLanguageDetection();
  applyTranslationStyle();
  document.querySelectorAll(MESSAGE_SELECTOR).forEach(enhanceMessage);
  enhanceComposer();
  updateLanguagePrompt();
}

function scheduleLanguageDetection() {
  clearTimeout(state.detectTimer);
  state.detectTimer = setTimeout(updateDetectedLanguage, 350);
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
  const containers = findAllTextContainers(messageNode);
  if (!containers.length) {
    return;
  }

  messageNode.dataset.waTranslatorReady = "1";

  for (const textContainer of containers) {
    if (shouldAutoTranslateMessage(messageNode, textContainer)) {
      translateBubble(messageNode, textContainer, false);
    }
  }
}

function shouldAutoTranslateMessage(messageNode, textContainer) {
  if (!state.settings.enabled) {
    return false;
  }
  const isIncoming = messageNode.classList.contains("message-in");
  const isOutgoing = messageNode.classList.contains("message-out");
  if (!isIncoming && !isOutgoing) {
    return false;
  }
  // 收到的消息：受 autoReceive 开关控制
  if (isIncoming && !state.settings.autoReceive) {
    return false;
  }
  if (textContainer.querySelector(".wa-bubble-translator-output")) {
    return false;
  }
  if (state.translatingContainers.has(textContainer)) {
    return false;
  }
  return true;
}

// 找出消息节点内所有独立的文本容器（不互相包含），逐个翻译
function findAllTextContainers(messageNode) {
  const candidates = new Map();

  for (const selector of TEXT_SELECTORS) {
    for (const node of messageNode.querySelectorAll(selector)) {
      if (!isRenderableNode(node, messageNode)) continue;
      if (candidates.has(node)) continue;
      const text = extractMessageText(node);
      if (text) candidates.set(node, text);
    }
  }

  // 后备：扫描所有含直接文本的 span/div
  if (!candidates.size) {
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
  }

  // 只保留最外层容器（去掉被其他节点包含的子节点）
  const nodes = [...candidates.keys()];
  return nodes.filter(
    (node) => !nodes.some((other) => other !== node && other.contains(node))
  );
}

async function translateBubble(messageNode, textContainer, forceRefresh) {
  const text = extractMessageText(textContainer);
  if (!text) {
    return;
  }

  state.translatingContainers.add(textContainer);
  if (forceRefresh) {
    removeOutput(textContainer);
  } else {
    removeError(textContainer);
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "translate",
      payload: {
        text,
        targetLanguage: getReceiveLanguage(),
        direction: "receive"
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "\u7ffb\u8bd1\u5931\u8d25");
    }

    insertTranslation(textContainer, response.text);
  } catch (error) {
    insertTranslation(textContainer, error.message || "\u7ffb\u8bd1\u5931\u8d25", true);
  } finally {
    state.translatingContainers.delete(textContainer);
  }
}

function insertTranslation(textContainer, translatedText, isError = false) {
  const existing = textContainer.querySelector(":scope > .wa-bubble-translator-output");
  const output = existing || document.createElement("span");
  output.className = `wa-bubble-translator-output${isError ? " wa-bubble-translator-error" : ""}`;
  output.textContent = translatedText;

  if (!existing) {
    textContainer.appendChild(output);
  }
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
  if (footer.querySelector(".wa-language-prompt")) {
    return;
  }

  const prompt = document.createElement("div");
  prompt.className = "wa-language-prompt";

  const label = document.createElement("span");
  label.className = "wa-language-prompt-label";

  const select = document.createElement("select");
  select.className = "wa-language-select";
  for (const [value, labelText] of Object.entries(LANGUAGE_LABELS)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = labelText;
    select.appendChild(option);
  }
  select.addEventListener("change", async () => {
    state.manualLanguage = select.value;
    if (state.lastConversationId) {
      state.manualLanguagesByConversation.set(state.lastConversationId, select.value);
    }
    state.settings.sendLanguage = select.value;
    await saveSettings({ sendLanguage: select.value });
    updateLanguagePrompt();
  });

  prompt.append(label, select);
  footer.insertBefore(prompt, footer.firstChild);
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

  label.innerHTML = `\u53d1\u9001\u6d88\u606f\u5c06\u7ffb\u8bd1\u4e3a<span>${escapeHtml(languageText)}</span>\uff0c\u5207\u6362\u8bed\u8a00`;
  select.value = language;
}

function installDraftWatcher(input) {
  if (input.dataset.waTranslatorDraftReady === "1") {
    return;
  }
  input.dataset.waTranslatorDraftReady = "1";
  input.addEventListener("input", () => {
    const text = normalizeText(input.innerText || input.textContent || "");
    if (!state.isReplacingDraft && !isTranslatedDraft(text, getActiveSendLanguage())) {
      state.lastTranslatedDraft = null;
    }
    if (!state.settings.enabled || !state.settings.autoSend || state.settings.sendTrigger !== "typing" || state.isReplacingDraft) {
      return;
    }
    clearTimeout(state.draftTimer);
    state.draftTimer = setTimeout(() => autoTranslateDraft(input), 900);
  });
  input.addEventListener("keydown", (event) => {
    if (!state.settings.enabled || event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    if (state.isReplacingDraft || state.isTranslatingDraft) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    const text = normalizeText(input.innerText || input.textContent || "");
    if (!text) {
      return;
    }

    if (state.settings.sendTrigger === "enter" && shouldTranslateDraftText(text)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      translateComposer(true);
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
  const text = normalizeText(input.innerText || input.textContent || "");
  if (!text || text === state.lastDraftSource || !shouldTranslateDraftText(text) || state.isTranslatingDraft) {
    return;
  }

  state.lastDraftSource = text;
  await translateComposer(false);
}

function findInput() {
  for (const selector of INPUT_SELECTORS) {
    const node = document.querySelector(selector);
    if (node) {
      return node;
    }
  }
  return null;
}

async function translateComposer(showNotice) {
  if (state.isTranslatingDraft) {
    if (showNotice) {
      showComposerNotice("\u6b63\u5728\u7ffb\u8bd1\uff0c\u8bf7\u7a0d\u5019");
    }
    return;
  }

  const input = findInput();
  const text = normalizeText(input?.innerText || input?.textContent || "");
  if (!input || !text) {
    if (showNotice) {
      showComposerNotice("\u6ca1\u6709\u53ef\u7ffb\u8bd1\u7684\u5185\u5bb9");
    }
    return;
  }

  let resultLabel = "";
  state.isTranslatingDraft = true;
  setComposerBusy(true);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "translate",
      payload: {
        text,
        targetLanguage: getActiveSendLanguage(),
        direction: "send"
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "\u7ffb\u8bd1\u5931\u8d25");
    }

    await replaceComposerText(input, response.text);
    state.lastTranslatedDraft = {
      text: normalizeText(response.text),
      targetLanguage: getActiveSendLanguage()
    };
    resultLabel = "\u5df2\u7ffb\u8bd1\uff0c\u518d\u6309 Enter \u53d1\u9001";
  } catch (error) {
    resultLabel = "\u7ffb\u8bd1\u5931\u8d25";
    console.warn("[WhatsApp Translator]", error);
  } finally {
    state.isTranslatingDraft = false;
    setComposerBusy(false);
    if (showNotice || resultLabel === "\u7ffb\u8bd1\u5931\u8d25") {
      showComposerNotice(resultLabel);
    }
  }
}

async function replaceComposerText(input, text) {
  state.isReplacingDraft = true;
  input.focus();

  const data = new DataTransfer();
  data.setData("text/plain", text);
  const pasteEvent = new ClipboardEvent("paste", {
    bubbles: true,
    cancelable: true,
    clipboardData: data
  });

  document.execCommand("selectAll");
  const accepted = input.dispatchEvent(pasteEvent);
  if (accepted) {
    document.execCommand("insertText", false, text);
  }

  input.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: "insertText",
    data: text
  }));

  setTimeout(() => {
    state.isReplacingDraft = false;
  }, 300);
}

async function updateDetectedLanguage() {
  if (!state.settings.autoDetectLanguage || state.manualLanguage || state.isDetectingLanguage) {
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
    const first = result?.languages?.[0];
    const detected = DETECT_MAP[first?.language];
    if (detected && first.percentage >= 35 && detected !== state.detectedLanguage) {
      state.detectedLanguage = detected;
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

function getIncomingLanguageSample() {
  return [...document.querySelectorAll(".message-in")]
    .slice(-8)
    .flatMap((node) => findAllTextContainers(node).map(extractMessageText))
    .filter(Boolean)
    .join(" ");
}

function getActiveSendLanguage() {
  return state.manualLanguage || state.detectedLanguage || state.settings.sendLanguage || "en";
}

function shouldTranslateDraftText(text) {
  const targetLanguage = getActiveSendLanguage();
  if (!text || isTranslatedDraft(text, targetLanguage)) {
    return false;
  }
  if (containsChinese(text)) {
    return !targetLanguage.startsWith("zh");
  }
  return targetLanguage !== "en";
}

function isTranslatedDraft(text, targetLanguage) {
  return Boolean(
    state.lastTranslatedDraft
      && state.lastTranslatedDraft.targetLanguage === targetLanguage
      && state.lastTranslatedDraft.text === normalizeText(text)
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
  document.querySelector(".wa-language-prompt")?.classList.toggle("wa-language-prompt-busy", isBusy);
}

function showComposerNotice(label) {
  const prompt = document.querySelector(".wa-language-prompt");
  if (!prompt) {
    return;
  }
  prompt.dataset.notice = label;
  prompt.classList.add("wa-language-prompt-notice");
  clearTimeout(state.noticeTimer);
  state.noticeTimer = setTimeout(() => {
    prompt.classList.remove("wa-language-prompt-notice");
    delete prompt.dataset.notice;
  }, 1600);
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
    .map((line) => line.replace(/\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\s*$/i, "").trim())
    .filter((line) => !isSystemBubbleLine(line))
    .filter((line) => line && !/^\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?$/i.test(line))
    .join("\n")
    .trim();
}

function isSystemBubbleLine(line) {
  const clean = normalizeText(line).toLowerCase();
  if (!clean) {
    return true;
  }
  return SYSTEM_LINE_PATTERNS.some((pattern) => pattern.test(clean));
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
