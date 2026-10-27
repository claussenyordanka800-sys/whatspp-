import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(rootDir, file), "utf8");
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const SECRET = "sk-supersecretvalue123456";

function createStorageArea(initial = {}) {
  const store = { ...initial };
  return {
    store,
    async get(keys) {
      if (keys == null) return { ...store };
      if (typeof keys === "string") return { [keys]: store[keys] };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, store[key]]));
      return Object.fromEntries(Object.keys(keys).map((key) => [key, store[key] ?? keys[key]]));
    },
    async set(values) {
      Object.assign(store, values);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
    },
    async getBytesInUse() {
      return Buffer.byteLength(JSON.stringify(store));
    }
  };
}

function loadDiagnostics(contextExtras = {}) {
  const context = { console, setTimeout, clearTimeout, ...contextExtras };
  vm.createContext(context);
  vm.runInContext(read("diagnostics.js"), context);
  return context;
}

function loadBackground(fetchImpl, settings = {}) {
  const sync = createStorageArea({ settings });
  const local = createStorageArea();
  const listeners = { messages: [] };
  const context = {
    AbortController,
    URLSearchParams,
    structuredClone,
    console,
    fetch: fetchImpl,
    setTimeout(fn, ms) {
      const timer = setTimeout(fn, ms);
      timer.unref?.();
      return timer;
    },
    clearTimeout,
    chrome: {
      runtime: {
        onInstalled: { addListener() {} },
        onMessage: { addListener: (fn) => listeners.messages.push(fn) }
      },
      storage: { sync, local }
    }
  };
  vm.createContext(context);
  vm.runInContext(read("diagnostics.js"), context);
  vm.runInContext(read("background.js"), context);
  return { context, local, listeners };
}

function mockResponse(body, status = 200) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return text; },
    async json() { return JSON.parse(text); }
  };
}

const diag = loadDiagnostics();
const stamp = new Date("2026-10-24T02:03:04.000Z");
let entries = [];
for (let index = 0; index < 405; index += 1) {
  entries = diag.WbtDiag.appendEntry(entries, diag.WbtDiag.createEntry({
    level: "error",
    event: "translate.failure",
    message: `n${index}`,
    text: `hello ${index}`
  }, stamp), 400);
}
assert.equal(entries.length, 400);
assert.equal(entries[0].message, "n5");
assert.equal(entries.at(-1).message, "n404");
assert.equal(entries[0].ts, "2026-10-24T02:03:04.000Z");
assert.equal(entries[0].textLength, "hello 5".length);
assert.equal(entries[0].textHash, diag.WbtDiag.hashText("hello 5"));
assert.equal(JSON.stringify(entries).includes("hello "), false);
assert.equal(diag.WbtDiag.appendEntry([{ id: "keep" }], { id: "next" }, 1).length, 1);

const leaked = diag.WbtDiag.createEntry({
  level: "error",
  event: "translate.failure",
  message: `DeepSeek 请求失败 Bearer ${SECRET} key=${SECRET} apiKey=${SECRET} DeepL-Auth-Key ${SECRET}:fx`,
  apiKey: SECRET,
  authorization: `Bearer ${SECRET}`,
  headers: { Authorization: `Bearer ${SECRET}` },
  body: JSON.stringify({ api_key: SECRET, text: "full request body" }),
  text: `客户原文 ${SECRET} 不要入库`
});
const leakedJson = JSON.stringify(leaked);
assert.doesNotMatch(leakedJson, new RegExp(SECRET));
assert.equal(leaked.apiKey, undefined);
assert.equal(leaked.headers, undefined);
assert.equal(leaked.body, undefined);
assert.match(leaked.message, /\[redacted\]/);
assert.equal(leaked.textLength, `客户原文 ${SECRET} 不要入库`.length);
assert.equal(leaked.textHash, diag.WbtDiag.hashText(`客户原文 ${SECRET} 不要入库`));
assert.match(diag.WbtDiag.redactString("https://example.test/v1?key=AIzaSyA1234567890abcd&q=hello"), /key=\[redacted\]/);
assert.doesNotMatch(diag.WbtDiag.redactString("https://example.test/v1?key=AIzaSyA1234567890abcd"), /AIzaSyA1234567890abcd/);

const slow = loadDiagnostics();
const delayed = [];
let delayedStore = [];
slow.chrome = {
  storage: {
    local: {
      async get() {
        await tick(15);
        return { wbtDiagLog: delayedStore.slice() };
      },
      async set(values) {
        await tick(15);
        delayedStore = values.wbtDiagLog.slice();
        delayed.push(delayedStore.length);
      }
    }
  }
};
slow.WbtDiag.installWriter();
await Promise.all([
  slow.WbtDiag.persistEntry({ level: "info", event: "provider.cooldown", message: "one" }),
  slow.WbtDiag.persistEntry({ level: "warn", event: "cache.write_failure", message: "two" })
]);
assert.equal(delayedStore.length, 2);
assert.deepEqual(delayedStore.map((entry) => entry.message), ["one", "two"]);

const { context, local, listeners } = loadBackground(async () => mockResponse({
  error: { message: `bad key ${SECRET}` }
}, 401), {
  provider: "custom",
  providerOrder: ["custom"],
  providerEnabled: { google: false, microsoft: false, deepseek: false, custom: true },
  providers: { custom: { baseUrl: "http://127.0.0.1:8000/v1", model: "demo", apiKey: SECRET } }
});
await assert.rejects(
  () => context.translateMessage({ text: "你好，请报价", targetLanguage: "en", direction: "send", sourceLanguage: "zh" }),
  /认证失败/
);
await context.WbtDiag.whenIdle();
const failureLog = JSON.stringify(local.store.wbtDiagLog);
assert.doesNotMatch(failureLog, new RegExp(SECRET));
assert.ok(local.store.wbtDiagLog.some((entry) => entry.event === "translate.failure" && entry.engine === "custom" && entry.status === 401));
assert.ok(local.store.wbtDiagLog.some((entry) => entry.event === "translate.exhausted" && entry.sourceLanguage === "zh" && entry.targetLanguage === "en"));
assert.equal(local.store.wbtDiagLog.every((entry) => entry.textHash && entry.text !== "你好，请报价"), true);
assert.equal(JSON.stringify(local.store).includes("你好，请报价"), false);

await new Promise((resolve) => {
  const keepOpen = listeners.messages[0]({
    type: "diagLog",
    entry: {
      level: "error",
      event: "composer.write_failure",
      message: `写入失败 apiKey=${SECRET}`,
      text: "这是完整草稿，不能进日志",
      apiKey: SECRET,
      headers: { Authorization: `Bearer ${SECRET}` }
    }
  }, {}, resolve);
  assert.equal(keepOpen, true);
});
await context.WbtDiag.whenIdle();
const forwarded = local.store.wbtDiagLog.at(-1);
assert.equal(forwarded.event, "composer.write_failure");
assert.doesNotMatch(JSON.stringify(forwarded), new RegExp(SECRET));
assert.equal(JSON.stringify(forwarded).includes("这是完整草稿"), false);
assert.equal(forwarded.textHash, context.WbtDiag.hashText("这是完整草稿，不能进日志"));

const customOnly = {
  provider: "custom",
  providerOrder: ["custom"],
  providerEnabled: { google: false, microsoft: false, deepseek: false, grok: false, deepl: false, openai: false, doubao: false, gemini: false, custom: true },
  providers: { custom: { baseUrl: "http://127.0.0.1:8000/v1", model: "demo", apiKey: "local" } }
};
const emptyRun = loadBackground(async () => mockResponse({ choices: [{ message: { content: "   " } }] }), customOnly);
await assert.rejects(() => emptyRun.context.translateMessage({ text: "hello", targetLanguage: "zh-CN", direction: "receive" }), /翻译结果为空/);
await emptyRun.context.WbtDiag.whenIdle();
assert.ok(emptyRun.local.store.wbtDiagLog.some((entry) => entry.event === "translate.empty"));

const cacheRun = loadBackground(async () => mockResponse({ choices: [{ message: { content: "Hola" } }] }), customOnly);
cacheRun.local.set = async (values) => {
  if (Object.keys(values).some((key) => key.startsWith("tr:"))) throw new Error("cache quota");
  Object.assign(cacheRun.local.store, values);
};
const originalWarn = console.warn;
console.warn = () => {};
let cachedResult;
try {
  cachedResult = await cacheRun.context.translateMessage({ text: "hello", targetLanguage: "es", direction: "send" });
} finally {
  console.warn = originalWarn;
}
assert.equal(cachedResult.text, "Hola");
await cacheRun.context.WbtDiag.whenIdle();
assert.ok(cacheRun.local.store.wbtDiagLog.some((entry) => entry.event === "cache.write_failure"));

const aiRun = loadBackground(async () => mockResponse({ error: { message: "slow" } }, 503), {
  ...customOnly,
  enabled: true,
  providers: { custom: { baseUrl: "http://127.0.0.1:8000/v1", model: "demo", apiKey: SECRET } }
});
await new Promise((resolve) => {
  aiRun.listeners.messages[0]({
    type: "aiAssist",
    payload: { action: "polish", draft: `润色这段 ${SECRET}`, targetLanguage: "en" }
  }, {}, resolve);
});
await aiRun.context.WbtDiag.whenIdle();
const aiLog = JSON.stringify(aiRun.local.store.wbtDiagLog);
assert.doesNotMatch(aiLog, new RegExp(SECRET));
assert.ok(aiRun.local.store.wbtDiagLog.some((entry) => entry.event === "ai.failure" && entry.engine === "custom" && entry.action === "polish"));
assert.equal(aiLog.includes("润色这段"), false);

const window = new Window({ url: "https://web.whatsapp.com/", settings: { disableJavaScriptFileLoading: true } });
const messages = [];
window.chrome = {
  storage: {
    sync: { async get() { return { settings: { enabled: true, autoReceive: false, autoDetectLanguage: false, sendLanguage: "es" } }; } },
    local: { async get() { return {}; }, async set() {} },
    onChanged: { addListener() {} }
  },
  runtime: {
    async sendMessage(message) {
      messages.push(JSON.parse(JSON.stringify(message)));
      return { ok: true, text: "translated" };
    }
  },
  i18n: { async detectLanguage() { return { languages: [] }; } }
};
window.document.body.innerHTML = `<div id="main"><header><span dir="auto">Customer</span></header><footer><div contenteditable="true" role="textbox"></div></footer></div>`;
window.eval(read("chat-tools.js"));
window.eval(read("diagnostics.js"));
window.eval(read("content.js"));
await tick(40);
window.noteSendFailure({ message: "未能触发发送", targetLanguage: "es", text: `报价 ${SECRET}` });
window.noteSendFailure({ message: "未能触发发送", targetLanguage: "es", text: `报价 ${SECRET}` });
const diagMessages = messages.filter((message) => message.type === "diagLog");
assert.equal(diagMessages.length, 3);
assert.equal(diagMessages.filter((message) => message.entry.event === "composer.send_failure").length, 2);
assert.equal(diagMessages.at(-1).entry.event, "composer.send_repeated_failure");
assert.equal(diagMessages.at(-1).entry.attempt, 2);
assert.doesNotMatch(JSON.stringify(diagMessages), new RegExp(SECRET));
assert.equal(JSON.stringify(diagMessages).includes("报价"), false);
window.close();

const popup = new Window({
  url: `file://${path.join(rootDir, "popup.html")}`,
  settings: { disableJavaScriptFileLoading: true }
});
popup.document.write(read("popup.html"));
popup.document.close();
popup.structuredClone = structuredClone;
const popupStore = { wbtDiagLog: [
  diag.WbtDiag.createEntry({ level: "error", event: "translate.failure", message: "接口 401", engine: "deepseek", status: 401 }, stamp),
  diag.WbtDiag.createEntry({ level: "info", event: "provider.cooldown", message: "冷却中", engine: "google" }, stamp)
] };
popup.chrome = {
  storage: {
    sync: { async get() { return { settings: { provider: "google", providerEnabled: { google: true }, providerOrder: ["google"] } }; }, async set() {} },
    local: {
      async get(key) { return { [key]: popupStore[key] }; },
      async set(values) { Object.assign(popupStore, values); }
    }
  },
  runtime: { async sendMessage() { return { ok: true }; } }
};
let copied = "";
Object.defineProperty(popup.navigator, "clipboard", {
  configurable: true,
  value: { writeText: async (text) => { copied = text; } }
});
popup.confirm = () => true;
popup.eval(read("diagnostics.js"));
popup.eval(read("popup.js"));
popup.document.dispatchEvent(new popup.Event("DOMContentLoaded"));
await tick();
popup.document.querySelector("#openDiagLog").click();
await tick();
assert.equal(popup.document.querySelectorAll(".diag-item").length, 2);
assert.match(popup.document.querySelector("#diagStatus").textContent, /共 2 条/);
popup.document.querySelector("#diagLevel").value = "error";
popup.document.querySelector("#diagLevel").dispatchEvent(new popup.Event("change", { bubbles: true }));
assert.equal(popup.document.querySelectorAll(".diag-item").length, 1);
assert.match(popup.document.querySelector(".diag-item").textContent, /接口 401/);
await popup.copyDiagLog();
assert.match(copied, /translate\.failure/);
assert.match(copied, /provider\.cooldown/);
popup.document.querySelector("#clearDiagLog").click();
await tick();
assert.equal(popupStore.wbtDiagLog.length, 0);
assert.match(popup.document.querySelector("#diagStatus").textContent, /已清空|共 0 条/);
popup.close();

console.log("All diagnostics tests passed.");
process.exit(0);
