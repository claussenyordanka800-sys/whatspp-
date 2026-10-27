import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

function createStorageArea(initial = {}) {
  const store = { ...initial };
  return {
    store,
    async get(keys) {
      if (keys == null) return { ...store };
      if (typeof keys === "string") return { [keys]: store[keys] };
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map((key) => [key, store[key]]));
      }
      return Object.fromEntries(Object.keys(keys).map((key) => [key, store[key] ?? keys[key]]));
    },
    async set(values) {
      Object.assign(store, values);
    },
    async clear() {
      for (const key of Object.keys(store)) delete store[key];
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
    },
    async getBytesInUse() {
      return Buffer.byteLength(JSON.stringify(store));
    }
  };
}

function loadBackground(fetchImpl, settings = {}) {
  const sync = createStorageArea({ settings });
  const local = createStorageArea();
  const listeners = { installed: [], messages: [] };
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
        onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
        onMessage: { addListener: (fn) => listeners.messages.push(fn) }
      },
      storage: { sync, local }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(rootDir, "background.js"), "utf8"), context);
  return { context, local };
}

function mockJson(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return data;
    },
    async text() {
      return JSON.stringify(data);
    }
  };
}

function mockText(text, status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return JSON.parse(text);
    },
    async text() {
      return text;
    }
  };
}

function mockGoogleRpc(translatedText) {
  const payload = [null, [[[null, null, null, null, null, [[translatedText]]]]]];
  const frames = [["wrb.fr", "MkEWBc", JSON.stringify(payload), null, null, null, "generic"]];
  return mockText(`)]}'\n\n${JSON.stringify(frames)}\n`, 200);
}

async function testBackground() {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("translate.googleapis.com")) {
      return mockJson([[["google result"]]]);
    }
    if (String(url).includes("edge.microsoft.com/translate/auth")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {};
        },
        async text() {
          return "edge-token";
        }
      };
    }
    if (String(url).includes("api-edge.cognitive.microsofttranslator.com")) {
      assert.equal(options.headers.Authorization, "Bearer edge-token");
      return mockJson([{ translations: [{ text: "microsoft result" }] }]);
    }
    if (String(url).includes(":generateContent")) {
      return mockJson({ candidates: [{ content: { parts: [{ text: "gemini result" }] } }] });
    }
    if (String(url).endsWith("/models")) {
      return mockJson({ data: [{ id: "model-a" }] });
    }
    if (String(url).endsWith("/chat/completions")) {
      return mockJson({ choices: [{ message: { content: "llm result" } }] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const { context, local } = loadBackground(fetchImpl, {
    provider: "google",
    providerEnabled: { google: true, microsoft: true, deepseek: false },
    providers: {}
  });

  const google = await context.translateMessage({ text: "Hello", targetLanguage: "zh-CN" });
  assert.equal(google.ok, true);
  assert.equal(google.text, "google result");
  assert.equal(google.provider, "google");

  const cached = await context.translateMessage({ text: "Hello", targetLanguage: "zh-CN" });
  assert.equal(cached.cached, true);
  assert.equal(calls.filter((call) => call.url.includes("translate.googleapis.com")).length, 1);

  let googleAttempts = 0;
  const { context: retryContext } = loadBackground(async (url, options = {}) => {
    googleAttempts += 1;
    if (String(url).includes("translate.googleapis.com")) {
      return mockText("<!DOCTYPE html><html><title>429</title></html>", 429);
    }
    if (String(url) === "https://translate.google.com/") {
      return mockText('<script>"FdrFJe":"test-fsid","cfb2h":"test-bl"</script>', 200);
    }
    if (String(url).includes("api.mymemory.translated.net")) {
      return mockJson({ responseStatus: "403", responseDetails: "quota" });
    }
    assert.match(String(url), /TranslateWebserverUi\/data\/batchexecute/);
    assert.match(String(url), /f\.sid=test-fsid/);
    assert.match(String(url), /bl=test-bl/);
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "include");
    assert.equal(options.headers["X-Same-Domain"], "1");
    return mockGoogleRpc("retried result");
  });
  retryContext.waitForRetry = async () => {};
  assert.equal(await retryContext.translateWithGoogleChunk("retry", "zh-CN"), "retried result");
  assert.equal(googleAttempts, 4);
  assert.equal(retryContext.parseGoogleRpcResponse(await mockGoogleRpc("parsed result").text()), "parsed result");
  assert.equal(await context.safeReadText(mockText("<!DOCTYPE html><html><body>rate limited</body></html>", 429)), "");
  assert.doesNotMatch(
    context.buildHttpErrorFromDetail("Google 翻译失败", 429, "<!DOCTYPE html><html>rate limited</html>").message,
    /doctype|html/i
  );

  let limitedGoogleCalls = 0;
  const { context: fallbackContext } = loadBackground(async (url, options = {}) => {
    if (String(url).includes("translate.googleapis.com")) {
      limitedGoogleCalls += 1;
      return mockText("<!DOCTYPE html><html>rate limited</html>", 429);
    }
    if (String(url) === "https://translate.google.com/") {
      return mockText('<script>"FdrFJe":"test-fsid","cfb2h":"test-bl"</script>', 200);
    }
    if (String(url).includes("translate.google.com/_/TranslateWebserverUi")) {
      limitedGoogleCalls += 1;
      return mockText("<!DOCTYPE html><html>rate limited</html>", 429);
    }
    if (String(url).includes("api.mymemory.translated.net")) {
      return mockJson({ responseStatus: "403", responseDetails: "quota" });
    }
    if (String(url).includes("edge.microsoft.com/translate/auth")) {
      return mockText("edge-token", 200);
    }
    if (String(url).includes("api-edge.cognitive.microsofttranslator.com")) {
      assert.equal(options.headers.Authorization, "Bearer edge-token");
      return mockJson([{ translations: [{ text: "fallback result" }] }]);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }, {
    provider: "google",
    providerEnabled: { google: true, microsoft: true, deepseek: false },
    providers: {}
  });
  fallbackContext.waitForRetry = async () => {};
  const firstFallback = await fallbackContext.translateMessage({ text: "first", targetLanguage: "zh-CN" });
  const secondFallback = await fallbackContext.translateMessage({ text: "second", targetLanguage: "zh-CN" });
  assert.equal(firstFallback.provider, "microsoft");
  assert.equal(secondFallback.provider, "microsoft");
  assert.equal(limitedGoogleCalls, 4);

  const { context: myMemoryContext } = loadBackground(async (url) => {
    if (String(url).includes("translate.googleapis.com")) return mockText("rate limited", 429);
    if (String(url) === "https://translate.google.com/") {
      return mockText('<script>"FdrFJe":"test-fsid","cfb2h":"test-bl"</script>', 200);
    }
    if (String(url).includes("translate.google.com/_/TranslateWebserverUi")) {
      return mockText("bad request", 400);
    }
    if (String(url).includes("api.mymemory.translated.net")) {
      assert.match(String(url), /langpair=en%7Czh-CN/);
      return mockJson({ responseStatus: "200", responseData: { translatedText: "好的" } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  myMemoryContext.waitForRetry = async () => {};
  assert.equal(await myMemoryContext.translateWithGoogleChunk("Ok", "zh-CN"), "好的");

  const microsoft = await context.translateWithMicrosoftEdge("A longer message\nwith another line", "zh-CN", {});
  assert.equal(microsoft, "microsoft result");

  const openai = await context.translateWithOpenAICompatible({
    provider: "custom",
    text: "hello",
    targetLanguage: "en",
    direction: "send",
    config: { baseUrl: "http://127.0.0.1:8000/v1", model: "local-model" }
  });
  assert.equal(openai, "llm result");

  const grok = await context.translateWithOpenAICompatible({
    provider: "grok",
    text: "hello",
    targetLanguage: "zh-CN",
    direction: "receive",
    config: { baseUrl: "https://api.x.ai/v1", model: "grok-4.5", apiKey: "xai-test-key" }
  });
  assert.equal(grok, "llm result");
  assert.equal(calls.at(-1).url, "https://api.x.ai/v1/chat/completions");
  assert.equal(calls.at(-1).options.headers.Authorization, "Bearer xai-test-key");

  await assert.rejects(
    context.translateWithOpenAICompatible({
      provider: "grok",
      text: "hello",
      targetLanguage: "zh-CN",
      direction: "receive",
      config: { baseUrl: "https://api.x.ai/v1", model: "grok-4.5", apiKey: "" }
    }),
    /Grok 缺少 API Key/
  );

  const models = await context.listModels("custom", { baseUrl: "http://127.0.0.1:8000/v1" });
  assert.deepEqual(JSON.parse(JSON.stringify(models.models)), [{ id: "model-a", name: "model-a" }]);

  const migrated = context.migrateSettings({ providerOrder: ["google"], providerEnabled: { google: true } });
  assert.equal(migrated.providerOrder[0], "google");
  assert.equal(migrated.providers.deepseek.baseUrl, "https://api.deepseek.com");
  assert.equal(migrated.providers.deepseek.model, "deepseek-v4-flash");
  const legacyMigrated = context.migrateSettings({ providers: { deepseek: { model: "deepseek-chat" } } });
  assert.equal(legacyMigrated.providers.deepseek.model, "deepseek-chat");
  assert.match(context.buildHttpErrorFromDetail("DeepSeek 请求失败", 401, "Authentication Fails", "deepseek").message, /认证失败/);
  assert.ok(Object.keys(local.store).some((key) => key.startsWith("tr:google:zh-CN:")));
}

function createWindow(html) {
  return new Window({
    url: "https://web.whatsapp.com/",
    settings: { disableJavaScriptFileLoading: true }
  }).happyDOM.setInnerHTML(html).ownerDocument.defaultView;
}

async function testPopup() {
  const window = new Window({
    url: `file://${path.join(rootDir, "popup.html").replaceAll("\\", "/")}`,
    settings: { disableJavaScriptFileLoading: true }
  });
  const { document } = window;
  document.write(fs.readFileSync(path.join(rootDir, "popup.html"), "utf8"));
  document.close();

  window.structuredClone = structuredClone;
  window.__savedSettings = null;
  window.chrome = {
    storage: {
        sync: {
          async get() {
          return { settings: { provider: "google", sendTrigger: "manual", providerEnabled: { google: true }, providerOrder: ["google"] } };
          },
        async set(values) {
          window.__savedSettings = values.settings;
        }
      }
    },
    runtime: {
      async sendMessage(message) {
        if (message.type === "listModels") return { ok: true, models: [{ id: "demo", name: "demo" }] };
        if (message.type === "testProvider") return { ok: true, text: "ok", config: message.config };
        return { ok: true };
      }
    }
  };

  window.eval(fs.readFileSync(path.join(rootDir, "popup.js"), "utf8"));
  document.dispatchEvent(new window.Event("DOMContentLoaded"));
  await tick();

  assert.equal(document.querySelector("#provider").value, "google");
  assert.equal(document.querySelectorAll("#sendLanguage option").length, 17);
  document.querySelector("#openEngineSettings").click();
  assert.equal(document.querySelectorAll(".provider-card").length, 9);
  document.querySelector("#save").click();
  await tick();
  assert.equal(document.querySelector('input[name="sendTrigger"][value="manual"]'), null);
  assert.equal(window.__savedSettings.sendTrigger, "enter");
  document.querySelector('[data-provider="google"] .provider-enabled').checked = false;
  document.querySelector('[data-provider="google"] .provider-enabled').dispatchEvent(new window.Event('change', { bubbles: true }));
  document.querySelector('#cancelEngineSettings').click();
  document.querySelector('#openEngineSettings').click();
  assert.equal(document.querySelector('[data-provider="google"] .provider-enabled').checked, true, 'cancel restores engine configuration');
  document.querySelector('#saveEngineSettings').click();
  await tick();
  assert.equal(window.__savedSettings.providers.deepseek.models, undefined, 'model catalogue must not fill sync quota');
  assert.match(document.querySelector('#aiProviderStatus').textContent, /尚未就绪/);
  window.close();
}

async function testContentScript() {
  const window = new Window({ url: "https://web.whatsapp.com/" });
  const { document } = window;
  document.write(`
    <!doctype html>
    <html>
      <body>
        <div id="main">
          <div class="message-in">
            <span class="selectable-text copyable-text">Hello 12:30</span>
          </div>
          <div class="message-out">
            <span class="selectable-text copyable-text">Should not translate</span>
          </div>
          <footer>
            <div contenteditable="true" role="textbox">source text</div>
          </footer>
        </div>
      </body>
    </html>
  `);
  document.close();

  window.structuredClone = structuredClone;
  const message = document.querySelector(".message-in");
  message.getBoundingClientRect = () => ({ top: 0, bottom: 20 });
  window.__messages = [];
  window.chrome = {
    storage: {
      sync: {
        async get() {
          return {
            settings: {
              enabled: true,
              receiveLanguage: "zh-CN",
              sendLanguage: "en",
              autoReceive: true,
              autoSend: false,
              autoDetectLanguage: false,
              sendTrigger: "manual",
              translationColor: "#a127b8",
              translationSize: "default"
            }
          };
        },
        async set(values) {
          window.__settings = values.settings;
        }
      },
      onChanged: { addListener() {} }
    },
    runtime: {
      async sendMessage(messagePayload) {
        window.__messages.push(messagePayload);
        return {
          ok: true,
          text: messagePayload.payload.direction === "send" ? "translated draft" : "translated bubble"
        };
      }
    },
    i18n: {
      async detectLanguage() {
        return { languages: [{ language: "en", percentage: 99 }] };
      }
    }
  };
  window.document.execCommand = (command, _showUi, value) => {
    if (command === "insertText") {
      const input = document.querySelector("[role='textbox']");
      input.textContent = value;
      input.innerText = value;
      return true;
    }
    return true;
  };

  window.eval(fs.readFileSync(path.join(rootDir, "content.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(document.querySelector(".wa-bubble-translator-output").textContent, "translated bubble");
  assert.equal(document.querySelector(".wa-manual-translate"), null);
  assert.deepEqual(window.__messages.map((messagePayload) => messagePayload.payload.direction), ["receive", "receive"]);
  assert.deepEqual(window.__messages.map((messagePayload) => messagePayload.payload.text), ["Hello 12:30", "Should not translate"]);
  assert.equal(window.__messages[0].payload.targetLanguage, "zh-CN");
  assert.equal(window.__messages[0].payload.text, "Hello 12:30");
  assert.equal(window.normalizeMessageBody("你发送了这个09:52"), "你发送了这个09:52");
  assert.equal(window.normalizeMessageBody("再次16:10"), "再次16:10");
  assert.equal(window.normalizeMessageBody("11:29"), "11:29");
  assert.equal(window.normalizeMessageBody("Forwarded"), "");

  const input = document.querySelector("[role='textbox']");
  let sameTargetSendCount = 0;
  input.textContent = "需要翻译";
  input.innerText = "需要翻译";
  input.addEventListener("keydown", () => {
    sameTargetSendCount += 1;
  });

  const beforeSendCount = window.__messages.length;
  const firstEnter = new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  const secondEnter = new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  input.dispatchEvent(firstEnter);
  input.dispatchEvent(secondEnter);
  await tick();

  assert.equal(sameTargetSendCount, 0);
  assert.equal(firstEnter.defaultPrevented, true);
  assert.equal(secondEnter.defaultPrevented, true);
  assert.equal(window.__messages.length, beforeSendCount + 1);
  assert.equal(window.__messages.at(-1).payload.direction, "send");

  await new Promise((resolve) => setTimeout(resolve, 350));

  await window.saveSettings({ sendLanguage: "es" });
  window.updateLanguagePrompt();
  await tick();

  input.textContent = "Hello customer";
  input.innerText = "Hello customer";
  input.dispatchEvent(new window.InputEvent("input", { bubbles: true, inputType: "insertText", data: "Hello customer" }));

  const beforeSpanishSendCount = window.__messages.length;
  const englishEnter = new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  input.dispatchEvent(englishEnter);
  await tick();

  assert.equal(englishEnter.defaultPrevented, true);
  assert.equal(window.__messages.length, beforeSpanishSendCount + 1);
  assert.equal(window.__messages.at(-1).payload.direction, "send");
  assert.equal(window.__messages.at(-1).payload.text, "Hello customer");
  assert.equal(window.__messages.at(-1).payload.targetLanguage, "es");

  await new Promise((resolve) => setTimeout(resolve, 350));

  const translatedSpanishEnter = new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  input.dispatchEvent(translatedSpanishEnter);
  assert.equal(translatedSpanishEnter.defaultPrevented, false);
  assert.equal(sameTargetSendCount, 1);

  window.close();
}

async function testContentScriptModernMessageMarkers() {
  const window = new Window({ url: "https://web.whatsapp.com/" });
  const { document } = window;
  document.write(`
    <!doctype html>
    <html>
      <body>
        <div id="main">
          <div role="row">
            <div data-id="false_1234567890@test_ABCDEF">
              <div data-pre-plain-text="[13:10, 2026/6/5] Customer: ">
                <span data-lexical-text="true">Hello from latest WhatsApp 13:10<span data-testid="msg-time">14:15</span></span>
              </div>
            </div>
          </div>
          <footer>
            <div contenteditable="true" role="textbox"></div>
          </footer>
        </div>
      </body>
    </html>
  `);
  document.close();

  window.structuredClone = structuredClone;
  window.__messages = [];
  window.chrome = {
    storage: {
      sync: {
        async get() {
          return {
            settings: {
              enabled: true,
              receiveLanguage: "zh-CN",
              sendLanguage: "en",
              autoReceive: true,
              autoSend: false,
              autoDetectLanguage: false,
              sendTrigger: "enter",
              translationColor: "#a127b8",
              translationSize: "default"
            }
          };
        },
        async set() {}
      },
      onChanged: { addListener() {} }
    },
    runtime: {
      async sendMessage(messagePayload) {
        window.__messages.push(messagePayload);
        return { ok: true, text: "translated modern bubble" };
      }
    },
    i18n: {
      async detectLanguage() {
        return { languages: [{ language: "en", percentage: 99 }] };
      }
    }
  };

  window.eval(fs.readFileSync(path.join(rootDir, "content.js"), "utf8"));
  await tick();

  assert.equal(document.querySelector(".wa-bubble-translator-output").textContent, "translated modern bubble");
  assert.equal(window.__messages.length, 1);
  assert.equal(window.__messages[0].payload.text, "Hello from latest WhatsApp 13:10");
  assert.equal(window.getIncomingLanguageSample(), "Hello from latest WhatsApp 13:10");
  window.close();
}

async function testContentScriptSkipsQuotedPreview() {
  const window = new Window({ url: "https://web.whatsapp.com/" });
  const { document } = window;
  document.write(`
    <!doctype html>
    <html>
      <body>
        <div id="main">
          <div role="row">
            <div data-id="false_customer_REPLY">
              <div data-pre-plain-text="[10:10, 2026/8/14] Customer: ">
                <div role="button">
                  <span class="selectable-text copyable-text">你</span>
                  <span class="selectable-text copyable-text">8张照片</span>
                </div>
                <span class="selectable-text copyable-text">El precio de esta imagen es la calidad de fábrica de $ 180.</span>
              </div>
            </div>
          </div>
          <footer><div contenteditable="true" role="textbox"></div></footer>
        </div>
      </body>
    </html>
  `);
  document.close();

  window.structuredClone = structuredClone;
  window.__messages = [];
  window.chrome = {
    storage: {
      sync: {
        async get() {
          return { settings: {
            enabled: true,
            receiveLanguage: "zh-CN",
            sendLanguage: "es",
            autoReceive: true,
            autoSend: false,
            autoDetectLanguage: false,
            sendTrigger: "enter",
            translationColor: "#a127b8",
            translationSize: "default"
          } };
        },
        async set() {}
      },
      onChanged: { addListener() {} }
    },
    runtime: {
      async sendMessage(messagePayload) {
        window.__messages.push(messagePayload);
        return { ok: true, text: "这张图片的出厂价是 180 美元。" };
      }
    },
    i18n: { async detectLanguage() { return { languages: [] }; } }
  };

  window.eval(fs.readFileSync(path.join(rootDir, "content.js"), "utf8"));
  await tick();

  assert.deepEqual(window.__messages.map((item) => item.payload.text), [
    "El precio de esta imagen es la calidad de fábrica de $ 180."
  ]);
  assert.equal(document.querySelectorAll(".wa-bubble-translator-output").length, 1);
  assert.equal(document.querySelector(".wa-bubble-translator-output").textContent, "这张图片的出厂价是 180 美元。");
  assert.equal(window.normalizeMessageBody("8张照片"), "");
  assert.doesNotMatch(window.formatTranslationError(new Error("HTTP 429 <!DOCTYPE html><html>blocked</html>")), /html/i);
  window.close();
}

async function testContentScriptModernDirection() {
  const window = new Window({ url: "https://web.whatsapp.com/" });
  const { document } = window;
  document.write(`
    <!doctype html>
    <html>
      <body>
        <div id="main">
          <div role="row">
            <div data-id="false_customer_IN"><span data-lexical-text="true">Incoming message</span></div>
          </div>
          <div role="row">
            <div data-id="true_customer_OUT"><span data-lexical-text="true">Outgoing message</span></div>
          </div>
          <footer><div contenteditable="true" role="textbox"></div></footer>
        </div>
      </body>
    </html>
  `);
  document.close();

  window.structuredClone = structuredClone;
  window.__messages = [];
  window.chrome = {
    storage: {
      sync: {
        async get() {
          return { settings: {
            enabled: true,
            receiveLanguage: "zh-CN",
            sendLanguage: "en",
            autoReceive: false,
            autoSend: false,
            autoDetectLanguage: false,
            sendTrigger: "enter",
            translationColor: "#a127b8",
            translationSize: "default"
          } };
        },
        async set() {}
      },
      onChanged: { addListener() {} }
    },
    runtime: {
      async sendMessage(messagePayload) {
        window.__messages.push(messagePayload);
        return { ok: true, text: "translated" };
      }
    },
    i18n: { async detectLanguage() { return { languages: [] }; } }
  };

  window.eval(fs.readFileSync(path.join(rootDir, "content.js"), "utf8"));
  await tick();

  assert.deepEqual(window.__messages.map((messagePayload) => messagePayload.payload.text), []);
  assert.equal(window.getIncomingLanguageSample(), "Incoming message");
  window.close();
}

async function testContentLanguageDetectionSwitch() {
  const window = new Window({ url: "https://web.whatsapp.com/" });
  const { document } = window;
  document.write(`
    <!doctype html>
    <html>
      <body>
        <div id="main">
          <header><span dir="auto" title="Spain">Spain</span></header>
          <div class="message-in">
            <span class="selectable-text copyable-text">Hola cliente</span>
          </div>
          <footer>
            <div contenteditable="true" role="textbox"></div>
          </footer>
        </div>
      </body>
    </html>
  `);
  document.close();

  const savedSettings = [];
  window.structuredClone = structuredClone;
  window.chrome = {
    storage: {
      sync: {
        async get() {
          return {
            settings: {
              enabled: true,
              receiveLanguage: "zh-CN",
              sendLanguage: "en",
              autoReceive: false,
              autoSend: false,
              autoDetectLanguage: true,
              sendTrigger: "enter",
              translationColor: "#a127b8",
              translationSize: "default"
            }
          };
        },
        async set(values) {
          savedSettings.push(values.settings);
        }
      },
      onChanged: { addListener() {} }
    },
    runtime: {
      async sendMessage() {
        return { ok: true, text: "translated bubble" };
      }
    },
    i18n: {
      async detectLanguage(text) {
        if (window.__detect) return window.__detect;
        if (text.includes("Bonjour")) {
          return { isReliable: true, languages: [{ language: "fr", percentage: 99 }] };
        }
        return { isReliable: true, languages: [{ language: "es", percentage: 99 }] };
      }
    }
  };

  window.eval(fs.readFileSync(path.join(rootDir, "content.js"), "utf8"));
  await tick();
  await window.updateDetectedLanguage();
  assert.equal(document.querySelector(".wa-language-select").value, "es");
  assert.equal(savedSettings.length, 0);

  document.querySelector("header span").textContent = "France";
  document.querySelector("header span").setAttribute("title", "France");
  document.querySelector(".message-in .selectable-text").textContent = "Bonjour client";
  window.dispatchEvent(new window.Event("hashchange"));
  await tick();
  await window.updateDetectedLanguage();
  await window.updateDetectedLanguage();

  assert.equal(document.querySelector(".wa-language-select").value, "fr");

  // Unreliable or weak detections must not retarget an established send language.
  window.__detect = { isReliable: false, languages: [{ language: "de", percentage: 99 }] };
  document.querySelector(".message-in .selectable-text").textContent = "Danke";
  await window.updateDetectedLanguage();
  assert.equal(document.querySelector(".wa-language-select").value, "fr");
  window.__detect = { isReliable: true, languages: [{ language: "de", percentage: 75 }] };
  document.querySelector(".message-in .selectable-text").textContent = "Danke schön";
  await window.updateDetectedLanguage();
  assert.equal(document.querySelector(".wa-language-select").value, "fr");
  window.close();
}

async function testMyMemoryWarningIsFailure() {
  const warning = "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY.";
  const { context, local } = loadBackground(async (url) => {
    if (String(url).includes("translate.googleapis.com")) return mockText("rate limited", 429);
    if (String(url) === "https://translate.google.com/") return mockText('<script>"FdrFJe":"s","cfb2h":"b"</script>', 200);
    if (String(url).includes("TranslateWebserverUi")) return mockText("bad request", 400);
    if (String(url).includes("api.mymemory.translated.net")) return mockJson({ responseStatus: "200", responseData: { translatedText: warning } });
    throw new Error(`Unexpected fetch: ${url}`);
  }, { provider: "google", providerEnabled: { google: true, microsoft: false, deepseek: false }, providers: {} });
  context.waitForRetry = async () => {};
  await assert.rejects(context.translateMessage({ text: "Hello", targetLanguage: "zh-CN" }), (error) => !error.message.includes("MYMEMORY"));
  await assert.rejects(context.translateWithMyMemory("Hello", "zh-CN"), /额度/);
  assert.equal(Object.keys(local.store).filter((key) => key.startsWith("tr:")).length, 0, "warnings are never cached");
}

async function testBubblePriorityAndSameLanguageSkip() {
  const window = new Window({ url: "https://web.whatsapp.com/" });
  const { document } = window;
  document.write(`
    <div id="main">
      <div class="message-in"><span class="selectable-text copyable-text">Old message one</span></div>
      <div class="message-in"><span class="selectable-text copyable-text">你好朋友，在吗</span></div>
      <div class="message-in"><span class="selectable-text copyable-text">Same text</span></div>
      <div class="message-in" id="newest"><span class="selectable-text copyable-text">Newest message</span></div>
      <footer><div contenteditable="true" role="textbox"></div></footer>
    </div>
  `);
  document.close();
  document.querySelector("#newest").getBoundingClientRect = () => ({ top: 100, bottom: 120, left: 0, right: 100, width: 100 });
  const sent = [];
  window.structuredClone = structuredClone;
  window.chrome = {
    storage: {
      sync: { async get() { return { settings: { enabled: true, receiveLanguage: "zh-CN", autoReceive: true, autoDetectLanguage: false } }; } },
      local: createStorageArea(),
      onChanged: { addListener() {} }
    },
    runtime: {
      async sendMessage(message) {
        sent.push(message.payload.text);
        return { ok: true, text: message.payload.text === "Same text" ? "Same text" : `译:${message.payload.text}` };
      }
    },
    i18n: {
      async detectLanguage(text) {
        return /[一-鿿]/.test(text)
          ? { isReliable: true, languages: [{ language: "zh", percentage: 99 }] }
          : { isReliable: false, languages: [{ language: "en", percentage: 60 }] };
      }
    }
  };
  window.eval(fs.readFileSync(path.join(rootDir, "content.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 450));

  assert.equal(sent[0], "Newest message", "visible newest bubble is translated first");
  assert.equal(sent.includes("你好朋友，在吗"), false, "bubble already in the receive language is not sent");
  const outputs = [...document.querySelectorAll(".message-in")].map((node) => node.querySelector(".wa-bubble-translator-output")?.textContent || "");
  assert.deepEqual(outputs, ["译:Old message one", "", "", "译:Newest message"]);

  const before = sent.length;
  window.scanPage();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(sent.length, before, "skipped bubbles are not re-sent on every scan");
  window.close();
}

async function testCacheIsolation() {
  const bodies = [];
  const { context, local } = loadBackground(async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return mockJson({ choices: [{ message: { content: 'Translated' } }] });
  }, { provider: 'custom', providerOrder: ['custom'], providerEnabled: { google: false, microsoft: false, deepseek: false, custom: true },
    translationPrompt: 'Preserve SKU', providers: { custom: { baseUrl: 'http://localhost/v1', model: 'test' } } });
  await context.translateMessage({ text: 'Hello', targetLanguage: 'de', direction: 'send' });
  await context.translateMessage({ text: 'Hello', targetLanguage: 'de', direction: 'receive' });
  assert.equal(bodies.length, 2, 'send and receive prompts must not share cached results');
  assert.match(bodies[0].messages[1].content, /Preserve SKU/);
  local.store['contact:customer'] = { language: 'de' };
  local.store.quickPhrases = [{ title: 'Hi', text: 'Hello' }];
  local.getBytesInUse = async () => 5 * 1024 * 1024;
  let trim;
  context.setTimeout = fn => { trim = fn; };
  context.trimCacheSoon();
  await trim();
  assert.equal(Object.keys(local.store).filter(key => key.startsWith('tr:')).length, 0);
  assert.equal(local.store['contact:customer'].language, 'de');
  assert.equal(local.store.quickPhrases.length, 1);
}

async function testConcurrentTranslationsAndCacheFailure() {
  const settings = { provider: 'custom', providerOrder: ['custom'], providerEnabled: { google: false, microsoft: false, deepseek: false, custom: true }, providers: { custom: { baseUrl: 'http://localhost/v1', model: 'test' } } };
  let calls = 0, finish;
  const { context, local } = loadBackground(async () => {
    calls++;
    await new Promise(resolve => { finish = resolve; });
    return mockJson({ choices: [{ message: { content: 'Shared translation' } }] });
  }, settings);
  const payload = { text: 'Repeated message', targetLanguage: 'es', direction: 'send' };
  const pending = [context.translateMessage(payload), context.translateMessage(payload), context.translateMessage(payload)];
  await tick(); assert.equal(calls, 1, 'identical in-flight requests share one API call');
  finish(); const results = await Promise.all(pending);
  assert.equal(results.every(result => result.text === 'Shared translation'), true);
  assert.equal((await context.translateMessage(payload)).cached, true);
  assert.equal(calls, 1);

  let fail = true, attempts = 0;
  const { context: retry } = loadBackground(async () => {
    attempts++;
    await tick();
    if (fail) throw new Error('Temporary outage');
    return mockJson({ choices: [{ message: { content: 'Recovered' } }] });
  }, settings);
  await Promise.all([assert.rejects(retry.translateMessage(payload), /Temporary outage/), assert.rejects(retry.translateMessage(payload), /Temporary outage/)]);
  assert.equal(attempts, 1); fail = false;
  assert.equal((await retry.translateMessage(payload)).text, 'Recovered'); assert.equal(attempts, 2);

  local.get = async () => { throw new Error('Cache unavailable'); };
  local.set = async () => { throw new Error('Quota exceeded'); };
  context.console = { ...console, warn() {} };
  const uncached = context.translateMessage({ ...payload, text: 'Uncached message' });
  await tick(); finish();
  assert.equal((await uncached).text, 'Shared translation', 'cache failure cannot discard successful translation');
  assert.equal(calls, 2);
  local.getBytesInUse = async () => { throw new Error('Cache unavailable'); };
  let cleanup; context.setTimeout = fn => { cleanup = fn; };
  context.trimCacheSoon(); await cleanup();
}

async function testAIAssistant() {
  const calls = [];
  const settings = { provider: 'google', providerEnabled: { custom: true }, providers: { custom: { model: 'test' } }, translationPrompt: 'Keep SKU' };
  const { context } = loadBackground(async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return mockJson({ choices: [{ message: { content: 'AI suggestion' } }] });
  }, settings);
  const result = await context.generateAssistantReply({ action: 'reply', targetLanguage: 'es', messages: [{ text: 'Need a price', direction: 'incoming' }] });
  assert.equal(result.provider, 'custom');
  assert.equal(result.text, 'AI suggestion');
  assert.match(calls[0].body.messages[1].content, /Need a price/);
  assert.match(calls[0].body.messages[1].content, /Keep SKU/);
  assert.doesNotMatch(calls[0].body.messages[0].content, /translation engine/);
  await assert.rejects(context.generateAssistantReply({ action: 'polish', draft: '' }), /润色/);
  const { context: missing } = loadBackground(() => { throw new Error('Must not call machine translation'); });
  await assert.rejects(missing.generateAssistantReply({ action: 'reply', messages: [{ text: 'Hello' }] }), /启用 AI/);
  const { context: empty } = loadBackground(async () => mockJson({ choices: [] }), settings);
  await assert.rejects(empty.generateAssistantReply({ action: 'polish', draft: 'Hi' }), /空内容/);
  let timeoutCallback;
  const { context: slow } = loadBackground(async (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  }), settings);
  slow.setTimeout = fn => { timeoutCallback = fn; };
  const pending = slow.fetchAI('https://example.test');
  timeoutCallback();
  await assert.rejects(pending, /25 秒/);
}

async function testProviderConfigurationAndErrors() {
  const { context } = loadBackground(async () => mockJson({ data: [{ id: 'account-model' }] }));
  const migrated = context.migrateSettings({ deepseekModel: 'old', deepseekApiKey: 'old-key', customModel: 'old-local',
    providers: { deepseek: { model: 'deepseek-reasoner', apiKey: '' }, custom: { model: 'current-local' } } });
  assert.equal(migrated.providers.deepseek.model, 'deepseek-reasoner');
  assert.equal(migrated.providers.deepseek.apiKey, '');
  assert.equal(migrated.providers.custom.model, 'current-local');
  const result = await context.listModels('deepseek', { apiKey: 'fixture-key' });
  assert.deepEqual(JSON.parse(JSON.stringify(result.models)), [{ id: 'account-model', name: 'account-model' }]);
  assert.match(context.buildHttpErrorFromDetail('请求失败', 402, '', 'deepseek').message, /余额/);
  assert.match(context.getErrorMessage(new TypeError('Failed to fetch')), /网络|连接/);
  const { context: malformed } = loadBackground(async () => mockText('<html>Bad gateway</html>'));
  const response = await malformed.fetchAI('https://example.test');
  await assert.rejects(response.json(), /非 JSON/);
}

await testAIAssistant();
await testProviderConfigurationAndErrors();
await testConcurrentTranslationsAndCacheFailure();
await testCacheIsolation();
await testBackground();
await testPopup();
await testContentScript();
await testContentScriptModernMessageMarkers();
await testContentScriptSkipsQuotedPreview();
await testContentScriptModernDirection();
await testContentLanguageDetectionSwitch();
await testBubblePriorityAndSameLanguageSkip();
await testMyMemoryWarningIsFailure();
console.log("All extension tests passed.");
process.exit(0);
