import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Window } from 'happy-dom';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 30));
const failures = [];
let passed = 0;
async function scenario(name, run) {
  try { await run(); passed++; }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
}
async function fixture({ settings = {}, translate } = {}) {
  const window = new Window({ url: 'https://web.whatsapp.com' });
  window.document.write(`<div id="main"><header><span dir="auto">Customer</span></header>
    <div class="message-in" data-id="false_491234567890@c.us_A"><span class="selectable-text copyable-text">Hello</span></div>
    <footer><div contenteditable="true" role="textbox"></div><button data-testid="compose-btn-send"><span data-icon="send"></span></button></footer></div>`);
  const listeners = [], calls = [];
  const config = { enabled: true, autoReceive: false, autoDetectLanguage: false, sendLanguage: 'es', sendTrigger: 'enter', ...settings };
  window.chrome = { storage: { sync: { async get() { return { settings: config }; } }, local: { async get() { return {}; }, async set() {} }, onChanged: { addListener(fn) { listeners.push(fn); } } },
    runtime: { async sendMessage(message) { calls.push(message); return translate ? translate(message) : { ok: true, text: 'Translated reply' }; } },
    i18n: { async detectLanguage() { return { languages: [] }; } } };
  const input = window.document.querySelector('[role="textbox"]');
  const setText = text => { input.textContent = text; };
  const edit = text => { setText(text); input.dispatchEvent(new window.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })); };
  window.document.execCommand = (command, _, value) => { if (command === 'insertText') setText(value); return true; };
  window.eval(read('chat-tools.js'));
  window.eval(read('content.js'));
  await tick();
  const enter = (options = {}) => {
    const event = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options });
    input.dispatchEvent(event); return event;
  };
  const send = window.document.querySelector('[data-testid="compose-btn-send"]');
  const changeSettings = partial => listeners[0]({ settings: { newValue: partial } }, 'sync');
  const changeChat = () => { window.document.querySelector('[data-id]').dataset.id = 'false_33123456789@c.us_B'; };
  return { window, input, calls, edit, enter, send, changeSettings, changeChat };
}

const neutral = ['', '   ', '\u200b\ufeff', '123456', '１２３４５', '١٢٣٤', '+49 (123) 456-7890', '1,234.56', '$99.50', 'USD 1,200.00', '2026-10-02', '12:30 PM', '50%', '👍😊', '!?…', 'https://example.com/a?q=123', 'www.example.com', 'example.com/catalog', 'sales@example.com', 'AB-12345', '(AB-12345)', 'ab-12345', 'SKU2026', 'https://example.com\nsales@example.com\n123'];
for (const text of neutral) {
  await scenario(`neutral Enter/click: ${JSON.stringify(text)}`, async () => {
    const f = await fixture();
    try {
      f.edit(text);
      assert.equal(f.enter().defaultPrevented, false, 'native Enter must pass through');
      f.send.click(); await tick();
      assert.equal(f.calls.length, 0, 'must not call translation');
      assert.equal(f.input.textContent, text, 'must preserve the original input');
    } finally { f.window.close(); }
  });
}
for (const text of ['报价 123 美元', 'Please check https://example.com', 'Contact sales@example.com please', '联系sales@example.com', 'I need AB-12345', '50 pcs', '明天见 12:30', 'مرحبا', 'こんにちは']) {
  await scenario(`prose translates: ${text}`, async () => {
    const f = await fixture();
    try { f.edit(text); assert.equal(f.enter().defaultPrevented, true); await tick(); assert.equal(f.calls[0].payload.text, text); }
    finally { f.window.close(); }
  });
}
await scenario('typing skips neutral text and waits for IME completion', async () => {
  const f = await fixture({ settings: { autoSend: true, sendTrigger: 'typing' } });
  try {
    for (const text of neutral) f.edit(text);
    await new Promise(resolve => setTimeout(resolve, 980));
    assert.equal(f.calls.length, 0);
    f.input.dispatchEvent(new f.window.CompositionEvent('compositionstart')); f.edit('需要翻译');
    await new Promise(resolve => setTimeout(resolve, 980)); assert.equal(f.calls.length, 0);
    f.input.dispatchEvent(new f.window.CompositionEvent('compositionend'));
    await new Promise(resolve => setTimeout(resolve, 980)); assert.equal(f.calls.length, 1);
  } finally { f.window.close(); }
});
await scenario('typing resumes for a newer draft while old translation is pending', async () => {
  const pending = [];
  const f = await fixture({ settings: { autoSend: true, sendTrigger: 'typing' }, translate: () => new Promise(resolve => pending.push(resolve)) });
  try {
    f.edit('旧草稿'); f.enter(); await tick(); f.edit('新草稿');
    await new Promise(resolve => setTimeout(resolve, 980)); assert.equal(f.calls.length, 2);
    pending[1]({ ok: true, text: 'NEW' }); await tick();
    pending[0]({ ok: true, text: 'OLD' }); await tick(); assert.equal(f.input.textContent, 'NEW');
  } finally { f.window.close(); }
});
for (const response of [{ ok: false, error: 'Network unavailable' }, { ok: true, text: '  ' }]) {
  await scenario(`failed/empty translation can retry and never sends: ${JSON.stringify(response)}`, async () => {
    let attempt = 0, sends = 0;
    const f = await fixture({ settings: { sendAfterTranslate: true }, translate: async () => ++attempt === 1 ? response : { ok: true, text: 'Translation' } });
    try {
      f.send.addEventListener('click', () => { sends++; });
      f.edit('需要翻译'); f.enter(); await tick();
      assert.equal(f.input.textContent, '需要翻译'); assert.equal(sends, 0);
      f.enter(); await tick(); assert.equal(f.calls.length, 2); assert.equal(sends, 1);
    } finally { f.window.close(); }
  });
}
await scenario('double click / repeated Enter sends only once', async () => {
  let finish, sends = 0;
  const f = await fixture({ settings: { sendAfterTranslate: true }, translate: () => new Promise(resolve => { finish = resolve; }) });
  try {
    f.send.addEventListener('click', () => { sends++; });
    f.edit('需要翻译'); f.send.click(); f.send.click(); f.enter(); await tick();
    assert.equal(f.calls.length, 1); assert.equal(sends, 0);
    finish({ ok: true, text: 'Translation' }); await tick(); assert.equal(sends, 1);
    assert.equal(f.enter({ repeat: true }).defaultPrevented, true);
  } finally { f.window.close(); }
});
await scenario('immediate edit after replacement prevents automatic send', async () => {
  let sends = 0;
  const f = await fixture({ settings: { sendAfterTranslate: true } });
  try {
    f.send.addEventListener('click', () => { sends++; });
    f.input.addEventListener('input', event => {
      if (event.data === 'Translated reply') queueMicrotask(() => f.edit('新的草稿'));
    });
    f.edit('需要翻译'); f.enter(); await tick();
    assert.equal(sends, 0); assert.equal(f.input.textContent, '新的草稿');
  } finally { f.window.close(); }
});
await scenario('non-Latin text translates to English', async () => {
  const f = await fixture({ settings: { sendLanguage: 'en' } });
  try { f.edit('مرحبا'); assert.equal(f.enter().defaultPrevented, true); await tick(); assert.equal(f.calls.length, 1); }
  finally { f.window.close(); }
});
await scenario('immediate second Enter and editing are recognized', async () => {
  const f = await fixture();
  try {
    f.edit('需要翻译'); f.enter(); await tick();
    assert.equal(f.enter().defaultPrevented, false, 'second deliberate Enter should send');
    f.edit('新的草稿'); f.enter(); await tick();
    assert.equal(f.calls.length, 2, 'typing right after translation must count as an edit');
  } finally { f.window.close(); }
});
await scenario('holding Enter never sends a translated preview', async () => {
  const f = await fixture();
  try {
    f.edit('需要翻译'); f.enter(); await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(f.enter({ repeat: true }).defaultPrevented, true);
    assert.equal(f.calls.length, 1);
  } finally { f.window.close(); }
});
for (const modifier of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey', 'isComposing']) {
  await scenario(`keyboard leaves ${modifier} alone`, async () => {
    const f = await fixture();
    try { f.edit('需要翻译'); assert.equal(f.enter({ [modifier]: true }).defaultPrevented, false); assert.equal(f.calls.length, 0); }
    finally { f.window.close(); }
  });
}
for (const change of ['edit', 'chat', 'language']) {
  await scenario(`new request after ${change} does not wait for obsolete request`, async () => {
    const pending = [];
    const f = await fixture({ translate: () => new Promise(resolve => pending.push(resolve)) });
    try {
      f.edit('旧草稿'); f.enter(); await tick();
      if (change === 'chat') f.changeChat();
      if (change === 'language') { const select = f.window.document.querySelector('.wa-language-select'); select.value = 'fr'; select.dispatchEvent(new f.window.Event('change')); }
      f.edit('新草稿'); f.enter(); await tick();
      assert.equal(f.calls.length, 2);
      if (change === 'chat') assert.equal(f.calls[1].payload.targetLanguage, 'es');
      pending[0]({ ok: true, text: 'OLD' }); await tick();
      assert.equal(f.input.textContent, '新草稿');
      assert.equal(f.window.document.querySelector('.wa-language-prompt').classList.contains('wa-language-prompt-busy'), true);
      pending[1]({ ok: true, text: 'NEW' }); await tick();
      assert.equal(f.input.textContent, 'NEW');
    } finally { f.window.close(); }
  });
}
await scenario('pending typing timer obeys disabled setting', async () => {
  const f = await fixture({ settings: { autoSend: true, sendTrigger: 'typing' } });
  try {
    f.edit('需要翻译'); f.changeSettings({ enabled: false });
    await new Promise(resolve => setTimeout(resolve, 980));
    assert.equal(f.calls.length, 0);
  } finally { f.window.close(); }
});
await scenario('IME click cannot submit unfinished composition', async () => {
  const f = await fixture();
  try {
    f.edit('拼音草稿'); f.input.dispatchEvent(new f.window.CompositionEvent('compositionstart'));
    let sends = 0; f.send.addEventListener('click', () => { sends++; });
    f.send.click(); await tick();
    assert.equal(f.calls.length, 0); assert.equal(sends, 0);
  } finally { f.window.close(); }
});
await scenario('Chinese send protection applies to both Enter and click', async () => {
  const f = await fixture({ settings: { sendLanguage: 'zh-CN', forbidChinese: true } });
  try {
    f.edit('保留中文'); assert.equal(f.enter().defaultPrevented, true);
    let sends = 0; f.send.addEventListener('click', () => { sends++; }); f.send.click(); await tick();
    assert.equal(f.calls.length, 0); assert.equal(sends, 0);
  } finally { f.window.close(); }
});
await scenario('message bubbles and language samples skip neutral content', async () => {
  const f = await fixture();
  try {
    const message = f.window.document.querySelector('.message-in span'); message.textContent = 'https://example.com';
    f.changeSettings({ autoReceive: true }); f.window.scanPage(); await tick();
    assert.equal(f.calls.length, 0); assert.equal(f.window.getIncomingLanguageSample(), '');
  } finally { f.window.close(); }
});
for (const change of ['edit', 'chat', 'disable', 'autoReceive']) {
  await scenario(`late bubble error ignored after ${change}`, async () => {
    let finish;
    const f = await fixture({ settings: { autoReceive: true }, translate: () => new Promise(resolve => { finish = resolve; }) });
    try {
      if (change === 'edit') f.window.document.querySelector('.message-in span').textContent = 'New message';
      if (change === 'chat') f.changeChat();
      if (change === 'disable') f.changeSettings({ enabled: false });
      if (change === 'autoReceive') f.changeSettings({ autoReceive: false });
      finish({ ok: false, error: 'Old error' }); await tick();
      assert.equal(f.window.document.querySelector('.wa-bubble-translator-error'), null);
    } finally { f.window.close(); }
  });
}
await scenario('nested formatted text is not duplicated and body times are preserved', async () => {
  const f = await fixture();
  try {
    const body = f.window.document.querySelector('.message-in span');
    body.innerHTML = `Hello <span dir="auto">customer <span dir="auto">today</span></span> at 12:30<span data-testid="msg-time">13:45</span>`;
    f.changeSettings({ autoReceive: true }); f.window.scanPage(); await tick();
    assert.equal(f.calls[0].payload.text, 'Hello customer today at 12:30');
  } finally { f.window.close(); }
});
await scenario('failed text insertion keeps the source and never sends', async () => {
  const f = await fixture({ settings: { sendAfterTranslate: true } });
  try {
    f.window.document.execCommand = () => false;
    let sends = 0; f.send.addEventListener('click', () => { sends++; });
    f.edit('原始草稿'); f.enter(); await tick();
    assert.equal(f.input.textContent, '原始草稿'); assert.equal(sends, 0);
    assert.match(f.window.document.querySelector('.wa-language-prompt').dataset.notice, /未能写入/);
    assert.equal(f.window.document.querySelector('.wa-restore-draft').hidden, true);
  } finally { f.window.close(); }
});
console.log(`Input scenarios: ${passed} passed, ${failures.length} failed.`);
process.exit(failures.length ? 1 : 0);
