const MESSAGE_SELECTOR = ".message-in, .message-out";
const TEXT_SELECTORS = [
  "span.selectable-text.copyable-text",
  "div.copyable-text span.selectable-text",
  "span._ao3e.selectable-text.copyable-text",
  "span._akbu",
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
  detectedLanguage: "",
  manualLanguage: "",
  lastDraftSource: "",
  isReplacingDraft: false,
  translatingMessages: new WeakSet()
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
}

async function loadSettings() {
  const response = await chrome.storage.sync.get("settings");
  return {
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

function scanPage() {
  if (!state.settings.enabled) {
    return;
  }
  updateDetectedLanguage();
  applyTranslationStyle();
  document.querySelectorAll(MESSAGE_SELECTOR).forEach(enhanceMessage);
  enhanceComposer();
  updateLanguagePrompt();
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
  const textContainer = findTextContainer(messageNode);
  if (!textContainer) {
    return;
  }

  const text = extractMessageText(textContainer);
  if (!text) {
    return;
  }

  messageNode.dataset.waTranslatorReady = "1";

  if (shouldAutoTranslateMessage(messageNode, textContainer)) {
    translateBubble(messageNode, textContainer, false);
  }
}

function shouldAutoTranslateMessage(messageNode, textContainer) {
  if (!state.settings.enabled || !state.settings.autoReceive) {
    return false;
  }
  if (!messageNode.classList.contains("message-in") && !messageNode.classList.contains("message-out")) {
    return false;
  }
  if (textContainer.querySelector(":scope > .wa-bubble-translator-output")) {
    return false;
  }
  if (state.translatingMessages.has(messageNode)) {
    return false;
  }
  return isInViewport(messageNode);
}

function findTextContainer(messageNode) {
  for (const selector of TEXT_SELECTORS) {
    const node = messageNode.querySelector(selector);
    if (node && extractMessageText(node)) {
      return node;
    }
  }
  return null;
}

async function translateBubble(messageNode, textContainer, forceRefresh) {
  const text = extractMessageText(textContainer);
  if (!text) {
    return;
  }

  state.translatingMessages.add(messageNode);
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
        targetLanguage: state.settings.receiveLanguage || "zh-CN",
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
    state.translatingMessages.delete(messageNode);
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
  clone.querySelectorAll(".wa-bubble-translator-output, [data-icon], svg, img, canvas, video").forEach((node) => node.remove());
  clone.querySelectorAll(QUOTED_SELECTORS.join(",")).forEach((node) => removeBlock(node, clone));

  const textParts = [...clone.querySelectorAll("span.selectable-text, span._ao3e, span[dir='auto']")]
    .filter((node) => !node.querySelector(".wa-bubble-translator-output"))
    .map((node) => normalizeMessageBody(node.innerText || node.textContent || ""))
    .filter(Boolean);

  const raw = textParts.length ? textParts.join("\n") : (clone.innerText || clone.textContent || "");
  return normalizeMessageBody(raw);
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

  label.innerHTML = `\u5f53\u524d\u573a\u666f\u8bed\u8a00\u4e3a<span>${escapeHtml(languageText)}</span>\uff0c\u5207\u6362\u8bed\u8a00`;
  select.value = language;
}

function installDraftWatcher(input) {
  if (input.dataset.waTranslatorDraftReady === "1") {
    return;
  }
  input.dataset.waTranslatorDraftReady = "1";
  input.addEventListener("input", () => {
    if (!state.settings.enabled || !state.settings.autoSend || state.settings.sendTrigger !== "typing" || state.isReplacingDraft) {
      return;
    }
    clearTimeout(state.draftTimer);
    state.draftTimer = setTimeout(() => autoTranslateDraft(input), 900);
  });
  input.addEventListener("keydown", (event) => {
    if (!state.settings.enabled || event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || state.isReplacingDraft) {
      return;
    }

    const text = normalizeText(input.innerText || input.textContent || "");
    if (!text) {
      return;
    }

    if (containsChinese(text) && state.settings.sendTrigger === "enter") {
      event.preventDefault();
      event.stopPropagation();
      translateComposer(true);
      return;
    }

    if (containsChinese(text) && state.settings.forbidChinese) {
      event.preventDefault();
      event.stopPropagation();
      showComposerNotice("\u8bf7\u5148\u7ffb\u8bd1\uff0c\u5df2\u963b\u6b62\u4e2d\u6587\u53d1\u9001");
    }
  }, true);
}

async function autoTranslateDraft(input) {
  const text = normalizeText(input.innerText || input.textContent || "");
  if (!text || text === state.lastDraftSource || !containsChinese(text)) {
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
  const input = findInput();
  const text = normalizeText(input?.innerText || input?.textContent || "");
  if (!input || !text) {
    if (showNotice) {
      showComposerNotice("\u6ca1\u6709\u53ef\u7ffb\u8bd1\u7684\u5185\u5bb9");
    }
    return;
  }

  let resultLabel = "";
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
    resultLabel = "\u5df2\u7ffb\u8bd1\uff0c\u518d\u6309 Enter \u53d1\u9001";
  } catch (error) {
    resultLabel = "\u7ffb\u8bd1\u5931\u8d25";
    console.warn("[WhatsApp Translator]", error);
  } finally {
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
  if (!state.settings.autoDetectLanguage || state.manualLanguage) {
    return;
  }

  const incomingText = [...document.querySelectorAll(".message-in")]
    .slice(-8)
    .map((node) => {
      const container = findTextContainer(node);
      return container ? extractMessageText(container) : "";
    })
    .filter(Boolean)
    .join(" ");

  if (incomingText.length < 3) {
    return;
  }

  try {
    const result = await chrome.i18n.detectLanguage(incomingText.slice(0, 1000));
    const first = result?.languages?.[0];
    const detected = DETECT_MAP[first?.language];
    if (detected && first.percentage >= 35 && detected !== state.detectedLanguage) {
      state.detectedLanguage = detected;
      state.settings.sendLanguage = detected;
      await saveSettings({ sendLanguage: detected });
    }
  } catch (error) {
    console.warn("[WhatsApp Translator] language detection failed", error);
  }
}

function getActiveSendLanguage() {
  return state.manualLanguage || state.detectedLanguage || state.settings.sendLanguage || "en";
}

async function saveSettings(partial) {
  const stored = await chrome.storage.sync.get("settings");
  const settings = { ...state.settings, ...(stored.settings || {}), ...partial };
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
    .map((line) => line.replace(/\s+\d{1,2}:\d{2}\s*(?:AM|PM)?\s*$/i, "").trim())
    .filter((line) => line && !/^\d{1,2}:\d{2}\s*(?:AM|PM)?$/i.test(line))
    .join("\n")
    .trim();
}

function removeBlock(node, root) {
  const block = node.closest("[role='button'], [data-pre-plain-text], div") || node;
  if (block !== root && root.contains(block)) {
    block.remove();
  } else {
    node.remove();
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
