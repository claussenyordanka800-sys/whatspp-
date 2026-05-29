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

  const models = await context.listModels("custom", { baseUrl: "http://127.0.0.1:8000/v1" });
  assert.deepEqual(JSON.parse(JSON.stringify(models.models)), [{ id: "model-a", name: "model-a" }]);

  const migrated = context.migrateSettings({ providerOrder: ["google"], providerEnabled: { google: true } });
  assert.equal(migrated.providerOrder[0], "google");
  assert.equal(migrated.providers.deepseek.baseUrl, "https://api.deepseek.com");
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
  assert.equal(document.querySelectorAll(".provider-card").length, 8);
  document.querySelector("#save").click();
  await tick();
  assert.equal(document.querySelector('input[name="sendTrigger"][value="manual"]'), null);
  assert.equal(window.__savedSettings.sendTrigger, "enter");
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
  await tick();
  assert.equal(document.querySelector(".wa-bubble-translator-output").textContent, "translated bubble");
  assert.equal(document.querySelector(".wa-manual-translate"), null);
  assert.deepEqual(window.__messages.map((messagePayload) => messagePayload.payload.direction), ["receive"]);
  assert.deepEqual(window.__messages.map((messagePayload) => messagePayload.payload.text), ["Hello"]);
  assert.equal(window.__messages[0].payload.targetLanguage, "zh-CN");
  assert.equal(window.__messages[0].payload.text, "Hello");
  assert.equal(window.normalizeMessageBody("你发送了这个09:52"), "你发送了这个");
  assert.equal(window.normalizeMessageBody("再次16:10"), "再次");
  assert.equal(window.normalizeMessageBody("11:29"), "");
  assert.equal(window.normalizeMessageBody("Forwarded"), "");

  window.close();
}

await testBackground();
await testPopup();
await testContentScript();
console.log("All extension tests passed.");
process.exit(0);
