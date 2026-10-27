/* Shared diagnostics ring buffer for the extension popup, service worker, and content script.
   Never store API keys, Authorization headers, or full source text. */
(function initDiagnostics(root) {
  const STORAGE_KEY = "wbtDiagLog";
  const MAX_ENTRIES = 400;
  const LEVELS = new Set(["info", "warn", "error"]);
  const ALLOWED_FIELDS = [
    "engine",
    "status",
    "direction",
    "targetLanguage",
    "sourceLanguage",
    "textLength",
    "textHash",
    "action",
    "attempt",
    "cooldownMs",
    "code",
    "providerCount"
  ];

  function hashText(text) {
    const value = String(text ?? "");
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function textMeta(text) {
    const value = String(text ?? "");
    return { textLength: value.length, textHash: hashText(value) };
  }

  function redactString(input) {
    let value = String(input ?? "");
    value = value.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-[redacted]");
    value = value.replace(/\bxai-[A-Za-z0-9_-]{8,}/g, "xai-[redacted]");
    value = value.replace(/\bAIza[0-9A-Za-z_-]{10,}/g, "AIza[redacted]");
    value = value.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]");
    value = value.replace(/DeepL-Auth-Key\s+\S+/gi, "DeepL-Auth-Key [redacted]");
    value = value.replace(/([?&](?:key|api_key|apikey|access_token|token|secret)=)[^&\s#]+/gi, "$1[redacted]");
    value = value.replace(/(api[_-]?key|authorization|x-api-key|api-key)(["']?\s*[:=]\s*["']?)([^"',\s}&]+)/gi, "$1$2[redacted]");
    return value;
  }

  function clip(value, max) {
    const text = String(value ?? "");
    return text.length > max ? text.slice(0, max) : text;
  }

  function createEntry(partial, now = new Date()) {
    const source = partial && typeof partial === "object" ? partial : { message: String(partial ?? "") };
    const nowDate = now instanceof Date ? now : new Date(now);
    const stamp = Number.isNaN(nowDate.getTime()) ? new Date() : nowDate;
    const entry = {
      id: `${stamp.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      ts: stamp.toISOString(),
      level: LEVELS.has(source.level) ? source.level : "error",
      event: clip(redactString(source.event || "event"), 80),
      message: clip(redactString(source.message || ""), 300)
    };
    if (source.text != null && source.textLength == null && source.textHash == null) {
      const meta = textMeta(source.text);
      entry.textLength = meta.textLength;
      entry.textHash = meta.textHash;
    }
    for (const key of ALLOWED_FIELDS) {
      const value = source[key];
      if (value == null || value === "") continue;
      if (typeof value === "number" && Number.isFinite(value)) entry[key] = value;
      else if (typeof value === "boolean") entry[key] = value;
      else if (typeof value === "string") entry[key] = clip(redactString(value), 80);
    }
    return entry;
  }

  function sanitizeEntry(entry) {
    const created = createEntry(entry && typeof entry === "object" ? entry : { message: String(entry ?? "") });
    if (entry && typeof entry.id === "string" && entry.id.trim()) created.id = clip(entry.id.trim(), 40);
    if (entry && typeof entry.ts === "string" && !Number.isNaN(Date.parse(entry.ts))) created.ts = entry.ts;
    return created;
  }

  function appendEntry(entries, entry, max = MAX_ENTRIES) {
    const list = Array.isArray(entries) ? entries.slice() : [];
    list.push(entry);
    const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : MAX_ENTRIES;
    if (list.length <= limit) return list;
    return list.slice(list.length - limit);
  }

  function formatEntries(entries) {
    return (Array.isArray(entries) ? entries : []).map((entry) => {
      const head = [entry?.ts, String(entry?.level || "").toUpperCase(), entry?.event].filter(Boolean).join(" ");
      const meta = [];
      for (const key of ALLOWED_FIELDS) {
        if (entry?.[key] != null && entry[key] !== "") meta.push(`${key}=${entry[key]}`);
      }
      const message = entry?.message ? ` | ${entry.message}` : "";
      return `${head}${meta.length ? ` ${meta.join(" ")}` : ""}${message}`.trim();
    }).join("\n");
  }

  let queue = Promise.resolve();

  function isWriter() {
    return root.__WBT_DIAG_WRITER === true;
  }

  function whenIdle() {
    return queue;
  }

  async function readEntries() {
    const stored = await root.chrome.storage.local.get(STORAGE_KEY);
    const entries = stored?.[STORAGE_KEY];
    return Array.isArray(entries) ? entries : [];
  }

  function persistEntry(entry) {
    const safe = sanitizeEntry(entry);
    const run = queue.then(async () => {
      const current = await readEntries();
      const next = appendEntry(current, safe, MAX_ENTRIES);
      await root.chrome.storage.local.set({ [STORAGE_KEY]: next });
      return safe;
    });
    queue = run.then(() => {}, () => {});
    return run;
  }

  async function clearEntries() {
    const run = queue.then(async () => {
      await root.chrome.storage.local.set({ [STORAGE_KEY]: [] });
    });
    queue = run.then(() => {}, () => {});
    return run;
  }

  function record(partial) {
    let entry = null;
    try {
      entry = createEntry(partial);
      if (!isWriter() && root.chrome?.runtime?.sendMessage) {
        Promise.resolve(root.chrome.runtime.sendMessage({ type: "diagLog", entry })).catch(() => {});
        return entry;
      }
      if (isWriter() && root.chrome?.storage?.local) persistEntry(entry).catch(() => {});
    } catch {
      /* Diagnostics must never break translation or sending. */
    }
    return entry;
  }

  function installWriter() {
    root.__WBT_DIAG_WRITER = true;
  }

  root.WbtDiag = {
    STORAGE_KEY,
    MAX_ENTRIES,
    hashText,
    textMeta,
    redactString,
    createEntry,
    sanitizeEntry,
    appendEntry,
    formatEntries,
    readEntries,
    persistEntry,
    clearEntries,
    record,
    whenIdle,
    installWriter
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
