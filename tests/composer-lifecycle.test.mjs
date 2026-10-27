import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Window } from 'happy-dom';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const tick = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));
let passed = 0, failed = 0;
async function scenario(name, run) {
  if (process.env.WA_TEST_TRACE) console.log(`START ${name}`);
  try { await run(); passed++; }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}
async function fixture({ translate, settings = {}, detect } = {}) {
  const window = new Window({ url: 'https://web.whatsapp.com' });
  window.document.write(`<div id="main"><header><span dir="auto">Customer</span></header>
    <div class="message-in" data-id="false_491234567890@c.us_A"><span class="selectable-text copyable-text">Hola cliente</span></div>
    <footer><div contenteditable="true" role="textbox"></div><button data-testid="compose-btn-send"><span data-icon="send"></span></button></footer></div>`);
  const calls = [], listeners = [];
  window.chrome = { storage: {
    sync: { async get() { return { settings: { enabled: true, autoReceive: false, autoDetectLanguage: false, sendLanguage: 'es', ...settings } }; } },
    local: { async get() { return {}; }, async set() {} }, onChanged: { addListener(fn) { listeners.push(fn); } }
  }, runtime: { async sendMessage(message) { calls.push(message); return translate ? translate(message) : { ok: true, text: 'Translated reply' }; } },
    i18n: { detectLanguage: detect || (async () => ({ languages: [] })) } };
  const input = window.document.querySelector('[role="textbox"]');
  const edit = text => { input.innerText = text; input.dispatchEvent(new window.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })); };
  window.document.execCommand = (command, _, value) => { if (command === 'insertText') input.textContent = value; return true; };
  window.eval(read('chat-tools.js')); window.eval(read('content.js')); await tick();
  const send = window.document.querySelector('[data-testid="compose-btn-send"]');
  let sends = 0; send.addEventListener('click', () => { sends++; });
  return { window, input, edit, calls, send, listeners, get sends() { return sends; } };
}
for (const text of ['Translated reply\u200b', '\u200eTranslated reply\u200f', 'Translated  reply', 'Translated\nreply']) {
  await scenario(`formatted preview sends without retranslating: ${JSON.stringify(text)}`, async () => {
    const f = await fixture();
    try {
      f.edit('需要翻译'); await f.window.translateComposer(true);
      f.edit(text); f.send.click(); await tick();
      assert.equal(f.calls.length, 1); assert.equal(f.sends, 1);
    } finally { f.window.close(); }
  });
}
await scenario('delayed paste/input commits one translated draft', async () => {
  const f = await fixture();
  try {
    f.input.addEventListener('paste', event => {
      event.preventDefault(); const text = event.clipboardData.getData('text/plain');
      setTimeout(() => f.edit(text), 30);
    });
    f.edit('原始草稿'); await f.window.translateComposer(true); await tick(60);
    f.send.click(); await tick();
    assert.equal(f.calls.length, 1); assert.equal(f.sends, 1);
  } finally { f.window.close(); }
});
await scenario('framework echo input during replacement does not invalidate translated preview', async () => {
  const f = await fixture();
  try {
    f.input.addEventListener('input', event => {
      if (event.data === 'Translated reply') queueMicrotask(() => {
        f.input.innerText = 'Translated reply';
        f.input.dispatchEvent(new f.window.InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
      });
    });
    f.edit('原始草稿'); await f.window.translateComposer(true);
    f.send.click(); await tick(); assert.equal(f.calls.length, 1); assert.equal(f.sends, 1);
  } finally { f.window.close(); }
});
await scenario('automatic language update cannot retarget an already translated preview', async () => {
  let language = 'es';
  const f = await fixture({ settings: { autoDetectLanguage: true }, detect: async () => ({ languages: [{ language, percentage: 99 }] }) });
  try {
    await f.window.updateDetectedLanguage(); f.edit('原始草稿'); await f.window.translateComposer(true);
    language = 'fr'; f.window.document.querySelector('.message-in span').textContent = 'Bonjour client';
    await f.window.updateDetectedLanguage(); f.send.click(); await tick();
    assert.equal(f.calls.length, 1); assert.equal(f.sends, 1);
  } finally { f.window.close(); }
});
await scenario('explicit language selection still retargets a preview', async () => {
  const f = await fixture();
  try {
    f.edit('原始草稿'); await f.window.translateComposer(true);
    const select = f.window.document.querySelector('.wa-language-select'); select.value = 'fr'; select.dispatchEvent(new f.window.Event('change'));
    f.send.click(); await tick(); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].payload.targetLanguage, 'fr');
    assert.equal(f.calls[1].payload.text, '原始草稿');
  } finally { f.window.close(); }
});
await scenario('a real edit during delayed paste is not overwritten', async () => {
  const f = await fixture();
  try {
    f.input.addEventListener('paste', event => { event.preventDefault(); });
    f.edit('原始草稿'); const pending = f.window.translateComposer(true);
    await tick(); f.edit('新的草稿'); await pending;
    assert.equal(f.input.textContent, '新的草稿'); assert.equal(f.sends, 0);
  } finally { f.window.close(); }
});
await scenario('errors remain readable and have a retry action', async () => {
  const f = await fixture({ translate: async () => ({ ok: false, error: 'HTTP 401：认证失败' }) });
  try {
    f.edit('原始草稿'); await f.window.translateComposer(true); await tick(1800);
    assert.equal(f.window.document.querySelector('.wa-language-prompt').classList.contains('wa-language-prompt-notice'), true);
    const status = f.window.document.querySelector('.wa-composer-status');
    assert.ok(status); assert.equal(status.getAttribute('role'), 'alert');
    assert.equal(status.querySelector('button').textContent, '重试翻译');
    assert.equal(f.input.textContent, '原始草稿'); assert.equal(f.sends, 0);
  } finally { f.window.close(); }
});
await scenario('invalid extension context becomes a refresh hint and stops repeated calls', async () => {
  const f = await fixture({ translate: async () => { throw new Error('Extension context invalidated.'); } });
  try {
    f.edit('原始草稿'); await f.window.translateComposer(true); f.send.click(); await tick();
    assert.equal(f.calls.length, 1); assert.equal(f.sends, 0);
    assert.match(f.window.document.querySelector('.wa-language-prompt').dataset.notice, /刷新.*WhatsApp/);
    assert.doesNotMatch(f.window.document.querySelector('.wa-language-prompt').dataset.notice, /invalidated/);
  } finally { f.window.close(); }
});
await scenario('English browser network errors have actionable Chinese messages', async () => {
  const f = await fixture();
  try {
    assert.match(f.window.formatTranslationError(new TypeError('Failed to fetch')), /网络|连接/);
    assert.match(f.window.formatTranslationError(new Error('Could not establish connection. Receiving end does not exist.')), /刷新/);
  } finally { f.window.close(); }
});
await scenario('reliable same-language detection sends without an API call', async () => {
  const f = await fixture({ detect: async () => ({ isReliable: true, languages: [{ language: 'es', percentage: 99 }] }) });
  try { f.edit('Hola, confirma el precio'); f.send.click(); await tick(); assert.equal(f.calls.length, 0); assert.equal(f.sends, 1); }
  finally { f.window.close(); }
});
await scenario('unreliable detection does not skip English to Spanish', async () => {
  const f = await fixture({ detect: async () => ({ isReliable: false, languages: [{ language: 'es', percentage: 99 }] }) });
  try { f.edit('Please confirm the price'); f.send.click(); await tick(); assert.equal(f.calls.length, 1); assert.equal(f.sends, 0); }
  finally { f.window.close(); }
});
await scenario('automatic language change during a request keeps its target and result', async () => {
  let language = 'es', finish;
  const f = await fixture({ settings: { autoDetectLanguage: true }, detect: async () => ({ languages: [{ language, percentage: 99 }] }), translate: () => new Promise(resolve => { finish = resolve; }) });
  try {
    await f.window.updateDetectedLanguage(); f.edit('原始草稿'); const pending = f.window.translateComposer(true); await tick();
    language = 'fr'; f.window.document.querySelector('.message-in span').textContent = 'Bonjour client'; await f.window.updateDetectedLanguage();
    finish({ ok: true, text: 'Translated reply' }); await pending; f.send.click(); await tick();
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].payload.targetLanguage, 'es'); assert.equal(f.sends, 1);
  } finally { f.window.close(); }
});
await scenario('label-only native send button translates once and then sends', async () => {
  const f = await fixture();
  try {
    f.send.removeAttribute('data-testid'); f.send.textContent = ''; f.send.setAttribute('aria-label', 'Send message');
    f.edit('原始草稿'); f.send.click(); await tick(); assert.equal(f.calls.length, 1); assert.equal(f.sends, 0);
    f.send.click(); await tick(); assert.equal(f.calls.length, 1); assert.equal(f.sends, 1);
  } finally { f.window.close(); }
});
await scenario('busy send gives feedback and never creates a duplicate request', async () => {
  let finish; const f = await fixture({ translate: () => new Promise(resolve => { finish = resolve; }) });
  try {
    f.edit('原始草稿'); f.send.click(); await tick(); f.send.click(); await tick();
    assert.equal(f.calls.length, 1); assert.equal(f.sends, 0); assert.match(f.window.document.querySelector('.wa-language-prompt').dataset.notice, /等待|稍候/);
    finish({ ok: true, text: 'Translated reply' }); await tick(); f.send.click(); await tick(); assert.equal(f.sends, 1);
  } finally { f.window.close(); }
});
await scenario('rebuilt message uses the retained translation; changing provider invalidates it', async () => {
  const f = await fixture({ settings: { autoReceive: true } });
  try {
    await tick(); assert.equal(f.calls.length, 1);
    let message = f.window.document.querySelector('.message-in');
    const clone = message.cloneNode(true); clone.querySelectorAll('.wa-bubble-translator-output').forEach(node => node.remove()); message.replaceWith(clone);
    f.window.scanPage(); await tick(); assert.equal(f.calls.length, 1); assert.ok(clone.querySelector('.wa-bubble-translator-output'));
    f.listeners[0]({ settings: { newValue: { provider: 'custom', providers: { custom: { model: 'changed' } } } } }, 'sync');
    f.window.scanPage(); await tick(); assert.equal(f.calls.length, 2);
  } finally { f.window.close(); }
});
for (const broken of ['Partial', '']) {
  await scenario(`failed write retains original and retries from it: ${JSON.stringify(broken)}`, async () => {
    const f = await fixture({ settings: { sendLanguage: 'en' } });
    try {
      const intercept = event => { event.preventDefault(); f.input.textContent = broken; };
      f.input.addEventListener('paste', intercept); f.edit('中文原稿'); await f.window.translateComposer(true);
      assert.equal(f.sends, 0); assert.equal(f.input.textContent, broken);
      assert.equal(f.window.document.querySelector('.wa-composer-original textarea').value, '中文原稿');
      f.input.removeEventListener('paste', intercept); await f.window.translateComposer(true);
      assert.equal(f.calls.length, 2); assert.equal(f.calls[1].payload.text, '中文原稿'); assert.equal(f.input.textContent, 'Translated reply');
    } finally { f.window.close(); }
  });
}
await scenario('reloading content disposes listeners and reattaches one toolbar', async () => {
  const f = await fixture();
  try {
    f.window.eval(read('content.js')); await tick(); f.edit('原始草稿'); f.send.click(); await tick();
    assert.equal(f.calls.length, 1); assert.equal(f.window.document.querySelectorAll('.wa-language-prompt').length, 1);
    f.send.click(); await tick(); assert.equal(f.sends, 1);
  } finally { f.window.close(); }
});
await scenario('partial framework commit with its own input event retains original and blocks send', async () => {
  const f = await fixture({ settings: { sendLanguage: 'en' } });
  try {
    f.window.document.execCommand = () => {
      f.input.textContent = 'Part'; f.input.dispatchEvent(new f.window.InputEvent('input', { bubbles: true, inputType: 'insertText', data: null })); return true;
    };
    f.edit('中文原稿'); await f.window.translateComposer(true);
    assert.equal(f.window.document.querySelector('.wa-composer-original textarea').value, '中文原稿'); assert.equal(f.sends, 0);
    f.send.click(); await tick(); assert.equal(f.sends, 0); assert.equal(f.calls[1].payload.text, '中文原稿');
  } finally { f.window.close(); }
});
await scenario('composer clone with copied dataset gets its own listeners', async () => {
  const f = await fixture();
  try {
    const clone = f.input.cloneNode(true); f.input.replaceWith(clone); f.window.enhanceComposer();
    clone.textContent = '中文草稿'; clone.dispatchEvent(new f.window.InputEvent('input', { bubbles: true }));
    clone.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await tick(); assert.equal(f.calls.length, 1);
  } finally { f.window.close(); }
});
await scenario('multiline and emoji DOM is preserved in translation source', async () => {
  const f = await fixture();
  try {
    f.input.innerHTML = '<div>第一行<img alt="🙂"></div><div>第二行<br>第三行</div>';
    f.input.dispatchEvent(new f.window.InputEvent('input', { bubbles: true })); await f.window.translateComposer(true);
    assert.equal(f.calls[0].payload.text, '第一行🙂\n第二行\n第三行');
  } finally { f.window.close(); }
});
const shippingAddress = 'No. 502-6, No. 40-2, Guanri Road, Fase II, Xiamen Software Park, China\n\n\nDestinatario: Liu\nNúmero de contacto: 13023880903';
for (const text of [shippingAddress, `${shippingAddress}\n\n${'Additional shipping instructions. '.repeat(180)}`, shippingAddress.replaceAll('\n', '\r\n')]) {
  await scenario(`Lexical multiline address can send after translation (${text.length} chars)`, async () => {
    const f = await fixture({ translate: async () => ({ ok: true, text }) });
    try {
      f.input.addEventListener('paste', event => {
        event.preventDefault();
        const paragraphs = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n').split('\n').map(line => {
          const paragraph = f.window.document.createElement('p');
          if (line) { const span = f.window.document.createElement('span'); span.dataset.lexicalText = 'true'; span.textContent = line; paragraph.append(span); }
          else paragraph.append(f.window.document.createElement('br'));
          return paragraph;
        });
        f.input.replaceChildren(...paragraphs);
        f.input.dispatchEvent(new f.window.InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: null }));
      });
      f.edit('请寄到以下地址'); await f.window.translateComposer(true);
      assert.equal(f.window.readComposerText(f.input), text.replace(/\r\n?/g, '\n').trim());
      assert.notEqual(f.window.document.querySelector('.wa-composer-status')?.getAttribute('role'), 'alert');
      const enter = new f.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      f.input.dispatchEvent(enter); assert.equal(enter.defaultPrevented, false);
      f.send.click(); await tick();
      assert.equal(f.calls.length, 1); assert.equal(f.sends, 1);
    } finally { f.window.close(); }
  });
}
for (const broken of ['Line one Line two', 'Line one\nLine two']) {
  await scenario(`lossy multiline write is detected: ${JSON.stringify(broken)}`, async () => {
    const f = await fixture({ translate: async () => ({ ok: true, text: 'Line one\n\nLine two' }) });
    try {
      f.input.addEventListener('paste', event => { event.preventDefault(); f.input.innerText = broken;
        f.input.dispatchEvent(new f.window.InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: null })); });
      f.edit('中文原稿'); await f.window.translateComposer(true);
      assert.equal(f.window.document.querySelector('.wa-composer-status').getAttribute('role'), 'alert');
      assert.equal(f.window.document.querySelector('.wa-composer-original textarea').value, '中文原稿'); assert.equal(f.sends, 0);
    } finally { f.window.close(); }
  });
}
await scenario('write failure offers a guarded one-click original restore', async () => {
  const f = await fixture();
  try {
    const fail = event => { event.preventDefault(); f.input.textContent = 'Partial'; };
    f.input.addEventListener('paste', fail); f.edit('中文原稿'); await f.window.translateComposer(true); f.input.removeEventListener('paste', fail);
    [...f.window.document.querySelectorAll('.wa-composer-status button')].find(button => button.textContent === '恢复原稿').click(); await tick();
    assert.equal(f.input.textContent, '中文原稿'); assert.equal(f.calls.length, 1); assert.equal(f.sends, 0);
    f.send.click(); await tick(); assert.equal(f.calls[1].payload.text, '中文原稿');
  } finally { f.window.close(); }
});
await scenario('manual language change during request gives feedback and ignores old result', async () => {
  let finish; const f = await fixture({ translate: () => new Promise(resolve => { finish = resolve; }) });
  try {
    f.edit('原始草稿'); const pending = f.window.translateComposer(true); await tick();
    const select = f.window.document.querySelector('.wa-language-select'); select.value = 'fr'; select.dispatchEvent(new f.window.Event('change'));
    assert.match(f.window.document.querySelector('.wa-language-prompt').dataset.notice, /语言.*改变/);
    finish({ ok: true, text: 'STALE' }); await pending; assert.equal(f.input.textContent, '原始草稿'); assert.equal(f.sends, 0);
  } finally { f.window.close(); }
});
await scenario('reliably detected Spanish is translated to English', async () => {
  const f = await fixture({ settings: { sendLanguage: 'en' }, detect: async () => ({ isReliable: true, languages: [{ language: 'es', percentage: 99 }] }) });
  try { f.edit('Hola, confirma el precio'); f.send.click(); await tick(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].payload.targetLanguage, 'en'); assert.equal(f.sends, 0); }
  finally { f.window.close(); }
});
await scenario('short uncertain English prose keeps the default without API work', async () => {
  const f = await fixture({ settings: { sendLanguage: 'en' } });
  try { f.edit('Hello customer'); f.send.click(); await tick(); assert.equal(f.calls.length, 0); assert.equal(f.sends, 1); }
  finally { f.window.close(); }
});
await scenario('settings changed during request gives feedback and ignores old result', async () => {
  let finish; const f = await fixture({ translate: () => new Promise(resolve => { finish = resolve; }) });
  try {
    f.edit('原始草稿'); const pending = f.window.translateComposer(true); await tick();
    f.listeners[0]({ settings: { newValue: { sendLanguage: 'fr' } } }, 'sync');
    assert.match(f.window.document.querySelector('.wa-language-prompt').dataset.notice, /设置.*改变/);
    finish({ ok: true, text: 'STALE' }); await pending; assert.equal(f.input.textContent, '原始草稿');
  } finally { f.window.close(); }
});
await scenario('failed AI draft write retains the original and cannot send truncated text', async () => {
  const f = await fixture({ settings: { sendLanguage: 'en' }, translate: async () => ({ ok: true, text: 'AI reply', providerName: 'Fixture' }) });
  try {
    f.edit('中文原稿'); f.window.document.querySelector('.wa-ai-toggle').click(); f.window.document.querySelector('[data-action="reply"]').click(); await tick();
    f.window.document.execCommand = () => { f.input.textContent = 'AI'; f.input.dispatchEvent(new f.window.InputEvent('input', { bubbles: true, inputType: 'insertText', data: null })); return true; };
    f.window.document.querySelector('.wa-ai-apply').click(); await tick(600);
    assert.equal(f.window.document.querySelector('.wa-composer-original textarea').value, '中文原稿'); assert.equal(f.sends, 0);
    f.send.click(); await tick(); assert.equal(f.sends, 0); assert.equal(f.calls[1].payload.text, '中文原稿');
  } finally { f.window.close(); }
});
await scenario('framework partial paste with empty event data retains original', async () => {
  const f = await fixture({ settings: { sendLanguage: 'en' } });
  try {
    f.input.addEventListener('paste', event => {
      event.preventDefault(); f.input.textContent = 'Part';
      f.input.dispatchEvent(new f.window.InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: '' }));
    });
    f.edit('中文原稿'); await f.window.translateComposer(true);
    assert.equal(f.window.document.querySelector('.wa-composer-original textarea').value, '中文原稿'); assert.equal(f.sends, 0);
  } finally { f.window.close(); }
});
console.log(`Composer lifecycle: ${passed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
