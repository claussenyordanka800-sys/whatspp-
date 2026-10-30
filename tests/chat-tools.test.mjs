import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Window } from 'happy-dom';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 30));
function area(store = {}) {
  return { store, async get(key) { return key ? { [key]: store[key] } : { ...store }; }, async set(values) { Object.assign(store, values); } };
}
async function fixture({ local = area(), translate, settings = {} } = {}) {
  const window = new Window({ url: 'https://web.whatsapp.com' });
  window.document.write(`<div id="main"><header><span dir="auto" title="Customer">Customer</span></header>
    <div class="message-in" data-id="false_491234567890@c.us_A"><span class="selectable-text copyable-text">Hello</span></div>
    <footer><div contenteditable="true" role="textbox"></div><button data-testid="compose-btn-send"><span data-icon="send"></span></button></footer></div>`);
  const sync = area({ settings: { enabled: true, autoReceive: false, autoDetectLanguage: false, sendLanguage: 'en', sendTrigger: 'enter', ...settings } });
  const listeners = [];
  const calls = [];
  window.chrome = { storage: { sync, local, onChanged: { addListener(fn) { listeners.push(fn); } } },
    runtime: { async sendMessage(message) { calls.push(message); return translate ? translate(message) : { ok: true, text: 'Translated reply' }; } },
    i18n: { async detectLanguage() { return { languages: [] }; } } };
  const input = window.document.querySelector('[role="textbox"]');
  const setText = text => { input.textContent = text; input.innerText = text; };
  window.document.execCommand = (command, _, value) => { if (command === 'insertText') setText(value); return true; };
  window.eval(read('chat-tools.js'));
  window.eval(read('content.js'));
  await tick();
  return { window, local, input, setText, calls, listeners, sync };
}

// Contact preferences survive reload and never overwrite the global default.
const local = area();
let f = await fixture({ local });
const select = f.window.document.querySelector('.wa-language-select');
select.value = 'es';
select.dispatchEvent(new f.window.Event('change'));
await tick();
assert.equal(local.store['contact:491234567890@c.us'].language, 'es');
assert.equal(f.sync.store.settings.sendLanguage, 'en');
f.window.close();
f = await fixture({ local });
assert.equal(f.window.getActiveSendLanguage(), 'es');
assert.equal(f.window.WAChatTools.inferRegion('+49 1234567890'), 'DE');
assert.equal(f.window.WAChatTools.inferRegion('+1 2125550123'), '');
f.window.document.querySelector('.wa-tools-toggle').click();
assert.match(f.window.document.querySelector('.wa-contact-summary').textContent, /德国.*EUR/);
const region = f.window.document.querySelector('.wa-region');
region.value = 'US'; region.dispatchEvent(new f.window.Event('change'));
await tick();
assert.match(f.window.document.querySelector('.wa-contact-summary').textContent, /多个时区/);
const form = f.window.document.querySelector('.wa-phrase-form');
form.elements.title.value = '<img src=x onerror=alert(1)>';
form.elements.text.value = 'Custom phrase';
form.dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
await tick();
assert.equal(local.store.quickPhrases.length, 5);
assert.equal(f.window.document.querySelector('.wa-phrase-list img'), null);
const search = f.window.document.querySelector('.wa-phrase-search');
search.value = 'Custom phrase'; search.dispatchEvent(new f.window.Event('input'));
assert.equal(f.window.document.querySelector('.wa-phrase-list').children.length, 1);
f.window.document.querySelector('.wa-phrase-list button').click();
await tick();
assert.equal(f.input.textContent, 'Custom phrase');
// A non-empty draft gets the phrase appended instead of a silent refusal.
f.window.document.querySelector('.wa-phrase-list button').click();
await tick();
assert.equal(f.input.textContent, 'Custom phrase Custom phrase');
// Edit mode is visible and cancellable; cancelling means the next save adds instead of overwriting.
search.value = ''; search.dispatchEvent(new f.window.Event('input'));
f.window.document.querySelector('.wa-phrase-list button[aria-label^="编辑"]').click();
const submitButton = form.querySelector('button[type="submit"]');
assert.equal(submitButton.textContent, '更新常用语');
const cancelEdit = [...form.querySelectorAll('button')].find(button => button.textContent === '取消编辑');
assert.equal(cancelEdit.hidden, false);
cancelEdit.click();
assert.equal(submitButton.textContent, '保存常用语');
form.elements.title.value = 'New'; form.elements.text.value = 'New phrase';
form.dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
await tick();
assert.equal(local.store.quickPhrases.length, 6);
assert.equal(local.store.quickPhrases[0].title, '欢迎咨询');
// Delete asks first; declining keeps the phrase.
f.window.confirm = () => false;
f.window.document.querySelector('.wa-phrase-list button[aria-label^="删除"]').click();
await tick();
assert.equal(local.store.quickPhrases.length, 6);
f.window.confirm = () => true;
f.window.document.querySelector('.wa-phrase-list button[aria-label^="删除"]').click();
await tick();
assert.equal(local.store.quickPhrases.length, 5);
f.window.close();

// A late response must not overwrite a newly edited draft or another chat.
for (const change of ['edit', 'chat', 'language', 'disable']) {
  let finish;
  f = await fixture({ translate: () => new Promise(resolve => { finish = resolve; }) });
  f.setText('原始草稿');
  const pending = f.window.translateComposer(true);
  await tick();
  if (change === 'edit') { f.setText('修改后的草稿'); f.input.dispatchEvent(new f.window.InputEvent('input')); }
  if (change === 'chat') f.window.document.querySelector('[data-id]').dataset.id = 'false_33123456789@c.us_B';
  if (change === 'language') { const language = f.window.document.querySelector('.wa-language-select'); language.value = 'fr'; language.dispatchEvent(new f.window.Event('change')); }
  if (change === 'disable') f.listeners[0]({ settings: { newValue: { enabled: false } } }, 'sync');
  finish({ ok: true, text: 'STALE' });
  await pending;
  assert.notEqual(f.input.textContent, 'STALE', change);
  f.window.close();
}

// IME Enter is not translation. Send mode sends once, preview mode never sends.
for (const sendAfterTranslate of [false, true]) {
  f = await fixture({ settings: { sendAfterTranslate } });
  f.setText('需要翻译');
  let sends = 0;
  f.window.document.querySelector('[data-testid="compose-btn-send"]').addEventListener('click', () => { sends++; });
  f.input.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
  assert.equal(f.calls.length, 0);
  const enter = new f.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  f.input.dispatchEvent(enter);
  await tick();
  assert.equal(enter.defaultPrevented, true);
  assert.equal(f.input.textContent, 'Translated reply');
  assert.equal(sends, Number(sendAfterTranslate));
  f.window.close();
}

// Native send button follows the same translation path; failures never send.
f = await fixture({ settings: { sendAfterTranslate: true }, translate: async () => ({ ok: false, error: 'Service unavailable' }) });
f.setText('需要翻译');
let sends = 0;
f.window.document.querySelector('[data-testid="compose-btn-send"]').addEventListener('click', () => { sends++; });
f.window.document.querySelector('[data-testid="compose-btn-send"]').click();
await tick();
assert.equal(sends, 0);
assert.equal(f.input.textContent, '需要翻译');
f.window.close();
// AI output is previewed first and cannot overwrite an edited draft.
for (const editWhileWaiting of [false, true]) {
  let finish;
  f = await fixture({ translate: () => new Promise(resolve => { finish = resolve; }) });
  f.window.document.querySelector('.wa-ai-toggle').click();
  f.window.document.querySelector('[data-action="reply"]').click();
  await tick();
  assert.equal(f.calls[0].type, 'aiAssist');
  assert.equal(f.calls[0].payload.messages[0].text, 'Hello');
  if (editWhileWaiting) { f.setText('new draft'); f.input.dispatchEvent(new f.window.InputEvent('input')); }
  finish({ ok: true, text: 'AI reply', providerName: 'Test AI' });
  await tick();
  assert.notEqual(f.input.textContent, 'AI reply');
  assert.match(f.window.document.querySelector('.wa-ai-status').textContent, /Test AI/);
  f.window.document.querySelector('.wa-ai-apply').click();
  await tick();
  assert.equal(f.input.textContent, editWhileWaiting ? 'new draft' : 'AI reply');
  f.window.close();
}
console.log('Chat tools regression tests passed.');
process.exit(0);
