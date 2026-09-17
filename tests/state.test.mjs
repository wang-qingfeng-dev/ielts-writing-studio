import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { DEMO_PROMPT, DEMO_ESSAY, DEMO_ANALYSIS } from '../public/demo.js';
import { countWords } from '../public/utils.js';

// 在简化的 DOM/网络边界中执行正式状态转换。
// 这里直接读取 app.js，避免重复实现持久化逻辑。
const appSource = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const testedFunctions = ['saveDraft', 'saveHistory', 'analyze', 'freshExercise', 'clearResult', 'updateProviderControls', 'checkConnection', 'switchProvider'];
const functionsSource = testedFunctions.map(name => {
  const match = appSource.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `Could not find the actual ${name} function in app.js`);
  return match[0];
}).join('\n\n');

function harness(overrides = {}) {
  const saved = new Map();
  const messages = [];
  const nodes = new Map();
  let now = 10000;
  let nextId = 0;
  let pending;
  const context = {
    state: {
      id: 'original-practice', prompt: DEMO_PROMPT, essay: DEMO_ESSAY,
      targetBand: 7, mode: 'real', analysis: structuredClone(DEMO_ANALYSIS),
      originalView: 'review', modelOpen: true, busy: false,
      createdAt: 1000, analyzedAt: 2000, ...overrides
    },
    history: [],
    analysisBackup: null,
    controller: null,
    saveTimer: undefined,
    progressTimer: undefined,
    providerSwitching: false,
    providerInfo: { provider: 'ollama', selected: 'auto' },
    connection: { available: false, checked: false },
    connectionRequest: 0,
    practiceAnswers: new Map(),
    KEYS: { draft: 'draft', history: 'history' },
    DEMO_PROMPT, DEMO_ESSAY, DEMO_ANALYSIS,
    countWords, structuredClone, AbortController, AbortSignal,
    Date: { now: () => now },
    crypto: { randomUUID: () => `new-practice-${++nextId}` },
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 2,
    clearInterval: () => {},
    $: selector => {
      if (!nodes.has(selector)) nodes.set(selector, {
        classList: { add() {}, remove() {} }, focus() {}, textContent: '', disabled: false, value: ''
      });
      return nodes.get(selector);
    },
    $$: () => [],
    write: (key, value) => { saved.set(key, structuredClone(value)); return true; },
    updateCounters() {}, renderAnalysis() {}, renderOriginal() {}, renderAll() {}, setMobileTab() {},
    showError: message => messages.push(message),
    toast: message => messages.push(message),
    fetch: (url, options) => new Promise((resolve, reject) => {
      pending = { resolve, reject, options, url };
      options.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    })
  };
  vm.createContext(context);
  vm.runInContext(functionsSource, context, { filename: 'app-state-transitions.js' });
  return {
    context, saved, messages,
    setNow(value) { now = value; },
    pending() { assert.ok(pending, 'Expected an active analysis request'); return pending; },
    run(source) { return vm.runInContext(source, context); }
  };
}

test('cancelling a retry restores the prior analysis and retains it when starting another exercise', async () => {
  const h = harness();
  const completed = h.context.state.analysis;
  const run = h.run('analyze()');
  assert.equal(h.context.state.analysis, null);
  assert.equal(h.context.state.busy, true);
  h.context.controller.abort('user');
  await run;
  assert.equal(h.context.state.analysis, completed);
  assert.equal(h.context.state.analyzedAt, 2000);
  assert.equal(h.context.state.originalView, 'review');
  assert.equal(h.context.state.modelOpen, true);
  assert.equal(h.context.state.busy, false);
  h.run('freshExercise()');
  assert.equal(h.context.history.length, 1);
  assert.equal(h.context.history[0].id, 'original-practice');
  assert.equal(h.context.history[0].analysis, completed);
  assert.equal(h.context.history[0].date, 2000);
});

test('service failure restores a completed result instead of overwriting it with an empty draft', async () => {
  const h = harness();
  const completed = h.context.state.analysis;
  const run = h.run('analyze()');
  h.pending().resolve({ ok: false, status: 503, json: async () => ({ error: 'Service unavailable' }) });
  await run;
  assert.equal(h.context.state.analysis, completed);
  assert.deepEqual(h.saved.get('draft').analysis, completed);
  h.run('saveHistory()');
  assert.equal(h.context.history[0].analysis, completed);
  assert.ok(h.messages.includes('Service unavailable'));
});

test('saving during a pending retry preserves the completed result for browser reload', async () => {
  const h = harness();
  const completed = h.context.state.analysis;
  const run = h.run('analyze()');
  h.run('saveDraft()');
  const draft = h.saved.get('draft');
  assert.deepEqual(draft.analysis, completed);
  assert.equal(draft.id, 'original-practice');
  assert.equal(draft.mode, 'real');
  assert.equal(draft.analyzedAt, 2000);
  h.context.controller.abort('user');
  await run;
});

test('a cancelled request from the demo preserves demo identity and never records sample scores as real', async () => {
  const h = harness({ id: 'sample', mode: 'demo', analyzedAt: null });
  const run = h.run('analyze()');
  assert.equal(h.context.state.mode, 'real');
  assert.equal(h.context.history.length, 0);
  h.run('saveDraft()');
  assert.equal(h.saved.get('draft').mode, 'demo');
  assert.equal(h.saved.get('draft').id, 'sample');
  h.context.controller.abort('user');
  await run;
  assert.equal(h.context.state.mode, 'demo');
  assert.equal(h.context.state.id, 'sample');
  h.run('saveHistory(); freshExercise()');
  assert.equal(h.context.history.length, 0);
});

test('a successful request from the demo records only the returned real result', async () => {
  const h = harness({ id: 'sample', mode: 'demo', analyzedAt: null });
  const liveResult = structuredClone(DEMO_ANALYSIS);
  liveResult.originalScore.low = 6;
  const run = h.run('analyze()');
  h.setNow(12000);
  h.pending().resolve({ ok: true, json: async () => liveResult });
  await run;
  assert.equal(h.context.history.length, 1);
  assert.equal(h.context.history[0].mode, 'real');
  assert.notEqual(h.context.history[0].id, 'sample');
  assert.equal(h.context.history[0].analysis, liveResult);
  assert.equal(h.context.history[0].analyzedAt, 12000);
  assert.equal(h.context.state.analysis, liveResult);
  assert.equal(h.context.analysisBackup, null);
});

test('viewing and saving an old exercise preserves completion dates and chronological order', () => {
  const h = harness();
  h.run('saveHistory()');
  const older = h.context.history[0];
  Object.assign(h.context.state, { id: 'newer-practice', createdAt: 4000, analyzedAt: 5000 });
  h.run('saveHistory()');
  Object.assign(h.context.state, structuredClone(older));
  h.setNow(99000);
  h.run('saveHistory()');
  assert.deepEqual(Array.from(h.context.history, item => [item.id, item.date]), [
    ['newer-practice', 5000], ['original-practice', 2000]
  ]);
});

test('an empty analysis cannot overwrite an existing completed history record', () => {
  const h = harness();
  const completed = h.context.state.analysis;
  h.run('saveHistory()');
  h.context.state.analysis = null;
  h.run('saveHistory()');
  assert.equal(h.context.history.length, 1);
  assert.equal(h.context.history[0].analysis, completed);
});

test('editing a completed essay forks the draft while retaining the original analysis and text', () => {
  const h = harness();
  h.run('clearResult()');
  h.context.state.essay = 'A revised opening paragraph.';
  h.run('saveDraft(); saveHistory()');
  const original = h.context.history.find(item => item.id === 'original-practice');
  const revision = h.context.history.find(item => item.id === h.context.state.id);
  assert.equal(original.essay, DEMO_ESSAY);
  assert.ok(original.analysis);
  assert.notEqual(revision.id, original.id);
  assert.equal(revision.essay, 'A revised opening paragraph.');
  assert.equal(revision.analysis, null);
  assert.equal(revision.analyzedAt, null);
});

test('a prompt-only practice remains in history when starting a new exercise', () => {
  const h = harness({ essay: '', analysis: null, analyzedAt: null });
  h.run('freshExercise()');
  assert.equal(h.context.history.length, 1);
  assert.equal(h.context.history[0].prompt, DEMO_PROMPT);
  assert.equal(h.context.history[0].essay, '');
});

test('changing provider blocks analysis and preserves the completed draft', async () => {
  const h = harness();
  const previousAnalysis = h.context.state.analysis;
  const change = h.run('switchProvider("openai-compatible")');
  assert.equal(h.context.providerSwitching, true);
  assert.equal(h.context.$('#provider-select').disabled, true);
  assert.equal(JSON.parse(h.pending().options.body).provider, 'openai-compatible');
  assert.ok(h.pending().options.signal instanceof AbortSignal);
  const switchingRequest = h.pending();
  await h.run('analyze()');
  assert.equal(h.pending(), switchingRequest);
  h.pending().resolve({ ok: true, json: async () => ({ provider: 'compatible', selected: 'openai-compatible', available: true, engine: 'Configured API' }) });
  await change;
  assert.equal(h.context.providerSwitching, false);
  assert.equal(h.context.$('#provider-select').disabled, false);
  assert.equal(h.context.$('#provider-select').value, 'openai-compatible');
  assert.equal(h.context.connection.available, true);
  assert.equal(h.context.state.analysis, previousAnalysis);
});

test('an old connection response cannot overwrite a later provider change', async () => {
  const h = harness();
  const statusRequest = h.run('checkConnection()');
  const oldStatus = h.pending();
  const change = h.run('switchProvider("codex")');
  h.pending().resolve({ ok: true, json: async () => ({ provider: 'codex', selected: 'codex', available: true }) });
  await change;
  oldStatus.resolve({ ok: true, json: async () => ({ provider: 'ollama', selected: 'auto', available: false }) });
  await statusRequest;
  assert.equal(h.context.$('#provider-select').value, 'codex');
  assert.equal(h.context.connection.provider, 'codex');
});

test('interrupted provider changes recheck server selection before unlocking controls', async () => {
  const h = harness();
  const change = h.run('switchProvider("codex")');
  h.pending().reject(Object.assign(new Error('Timed out'), { name: 'TimeoutError' }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.pending().url, '/api/status');
  assert.equal(h.context.$('#provider-select').disabled, true);
  h.pending().resolve({ ok: true, json: async () => ({ provider: 'codex', selected: 'codex', available: false }) });
  await change;
  assert.equal(h.context.$('#provider-select').value, 'codex');
  assert.equal(h.context.$('#provider-select').disabled, false);
  assert.equal(h.context.providerSwitching, false);
});
