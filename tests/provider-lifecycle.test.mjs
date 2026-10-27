import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Window } from 'happy-dom';
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 25));
let passed = 0;
async function fixture({ request, save } = {}) {
  const window = new Window({ url: 'https://web.whatsapp.com', settings: { disableJavaScriptFileLoading: true } });
  window.document.write(read('popup.html')); window.document.close(); window.structuredClone = structuredClone;
  const calls = [], saves = [];
  window.chrome = { storage: { sync: {
    async get() { return { settings: { provider: 'deepseek', providers: { deepseek: { model: 'deepseek-chat', apiKey: 'fixture-key' } } } }; },
    async set(value) { saves.push(value.settings); if (save) await save(value); }
  } }, runtime: { async sendMessage(message) { calls.push(message); return request ? request(message) : { ok: true }; } } };
  window.eval(read('popup.js')); window.document.dispatchEvent(new window.Event('DOMContentLoaded')); await tick();
  window.openEngineSettings();
  return { window, calls, saves, card: () => window.document.querySelector('[data-provider="deepseek"]') };
}
async function scenario(name, run) {
  try { await run(); passed++; } catch (error) { console.error(name); throw error; }
}
await scenario('cancelled model lookup cannot change a reopened configuration', async () => {
  let finish; const f = await fixture({ request: () => new Promise(resolve => { finish = resolve; }) });
  try {
    const pending = f.window.fetchModels('deepseek', f.card()); await tick(); f.window.closeEngineSettings(); f.window.openEngineSettings();
    finish({ ok: true, models: [{ id: 'stale-model' }] }); await pending;
    assert.equal(f.card().querySelector('.model-select option[value="stale-model"]'), null);
    assert.equal(f.card().querySelector('[data-key="model"]').value, 'deepseek-chat');
  } finally { f.window.close(); }
});
await scenario('editing config invalidates a test, allows a new request, and ignores the old result', async () => {
  const resolvers = []; const f = await fixture({ request: () => new Promise(resolve => { resolvers.push(resolve); }) });
  try {
    const pending = f.window.testProvider('deepseek', f.card()); await tick();
    assert.equal(f.card().querySelector('.test-provider').disabled, true);
    const model = f.card().querySelector('[data-key="model"]'); model.value = 'updated'; model.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    assert.equal(f.card().querySelector('.test-provider').disabled, false);
    const newer = f.window.testProvider('deepseek', f.card()); await tick();
    resolvers[0]({ ok: true, text: 'stale success', config: { model: 'stale' } }); await pending;
    assert.equal(f.card().querySelector('[data-key="model"]').value, 'updated'); assert.equal(f.card().querySelector('.test-provider').disabled, true);
    resolvers[1]({ ok: true, text: 'new success' }); await newer;
    assert.match(f.card().querySelector('.provider-status').textContent, /new success/); assert.equal(f.calls.length, 2);
  } finally { f.window.close(); }
});
await scenario('duplicate test clicks and rerender keep a single pending request', async () => {
  let finish; const f = await fixture({ request: () => new Promise(resolve => { finish = resolve; }) });
  try {
    const pending = f.window.testProvider('deepseek', f.card()); await tick(); await f.window.testProvider('deepseek', f.card());
    f.window.renderProviders(); assert.equal(f.calls.length, 1); assert.equal(f.card().querySelector('.test-provider').disabled, true);
    finish({ ok: true, text: 'OK' }); await pending; assert.equal(f.card().querySelector('.test-provider').disabled, false);
  } finally { f.window.close(); }
});
await scenario('successful catalogue uses only actual models; fallback is labelled', async () => {
  let fallback = false; const f = await fixture({ request: async () => ({ ok: true, models: [{ id: 'actual-model' }], fallback }) });
  try {
    await f.window.fetchModels('deepseek', f.card());
    assert.deepEqual([...f.card().querySelectorAll('.model-select option')].map(node => node.value), ['', 'actual-model']);
    assert.equal(f.card().querySelector('[data-key="model"]').value, 'deepseek-chat');
    fallback = true; await f.window.fetchModels('deepseek', f.card()); assert.match(f.card().querySelector('.provider-status').textContent, /候选.*确认/);
  } finally { f.window.close(); }
});
await scenario('failed storage save is reported without closing settings', async () => {
  const f = await fixture({ save: async () => { throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded'); } });
  try {
    assert.equal(await f.window.saveSettings(true), false);
    assert.match(f.window.document.querySelector('#saveStatus').textContent, /保存失败/);
    assert.equal(f.window.document.querySelector('#engineModal').hidden, false);
  } finally { f.window.close(); }
});
await scenario('concurrent saves preserve order and capture their own values', async () => {
  const resolvers = []; const f = await fixture({ save: () => new Promise(resolve => { resolvers.push(resolve); }) });
  try {
    f.window.updateProviderConfig('deepseek', 'model', 'first'); const first = f.window.saveSettings(false); await tick();
    f.window.updateProviderConfig('deepseek', 'model', 'second'); const second = f.window.saveSettings(false); await tick();
    assert.equal(f.saves.length, 1); resolvers[0](); await first; await tick(); assert.equal(f.saves.length, 2);
    assert.equal(f.saves[0].providers.deepseek.model, 'first'); assert.equal(f.saves[1].providers.deepseek.model, 'second');
    assert.equal(f.saves[1].providers.deepseek.models, undefined); resolvers[1](); await second;
  } finally { f.window.close(); }
});
await scenario('saving a modal cannot be cancelled into a contradictory configuration', async () => {
  let finish; const f = await fixture({ save: () => new Promise(resolve => { finish = resolve; }) });
  try {
    f.window.updateProviderConfig('deepseek', 'model', 'saved-model'); f.window.document.querySelector('#saveEngineSettings').click(); await tick();
    assert.equal(f.window.document.querySelector('#cancelEngineSettings').disabled, true); f.window.closeEngineSettings();
    assert.equal(f.window.document.querySelector('#engineModal').hidden, false);
    finish(); await tick(); assert.equal(f.window.document.querySelector('#engineModal').hidden, true);
    f.window.openEngineSettings(); assert.equal(f.card().querySelector('[data-key="model"]').value, 'saved-model');
  } finally { f.window.close(); }
});
console.log(`Provider lifecycle: ${passed} passed.`);
process.exit(0);
