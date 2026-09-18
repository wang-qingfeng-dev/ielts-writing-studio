import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createServer, buildCorrectionPrompt, buildModelPrompt } from '../server.mjs';
import { validateRequest, validateAnalysis, validateCorrection, validateModel } from '../analysis-schema.mjs';

const input = { prompt: 'Should cities provide free buses to all residents?', essay: 'There are several reason to improve buses. It make travel easier for residents.', targetBand: 7 };
const score = () => ({ low: 5.5, high: 6.5, criteria: ['TR', 'CC', 'LR', 'GRA'].map(key => ({ key, band: 6, evidence: '论点明确但展开不足。', action: '补充一个具体例子。' })) });
function fixture() {
  return {
    originalScore: score(), corrected: { text: 'There are several reasons to improve buses. It makes travel easier for residents.', score: score() },
    model: { text: 'Public transport can reduce traffic. Cities should invest in reliable buses.', score: score(), notes: [{ quote: 'reduce traffic', label: '结果表达', explanation: '解释措施的具体效果。' }] },
    issues: [{ id: 'g1', category: 'grammar', original: 'several reason', replacement: 'several reasons', explanation: 'several 后接复数名词。', priority: 'essential', practice: { question: 'Correct: There are several option.', answer: 'There are several options.' } }],
    expressions: [{ id: 'e1', text: 'improve buses', meaning: '改善公交服务', example: 'The council plans to improve buses.', source: 'corrected', usage: '描述提升公共服务。' }, { id: 'e2', text: 'reduce traffic', meaning: '缓解交通流量', example: 'Cycling can reduce traffic.', source: 'model', usage: '谈论交通政策效果。' }],
    priorities: [1, 2, 3].map(index => ({ title: `行动 ${index}`, description: '每段补充一条具体解释。' }))
  };
}
let folder;
before(async () => { folder = await mkdtemp(path.join(os.tmpdir(), 'ielts-tests-')); await mkdir(path.join(folder, 'public')); await writeFile(path.join(folder, 'public', 'index.html'), '<!doctype html><p>IELTS</p>'); await writeFile(path.join(folder, 'secret.txt'), 'private'); });
after(async () => { await rm(folder, { recursive: true, force: true }); });
async function withServer(t, options = {}) {
  const server = createServer({ publicDir: path.join(folder, 'public'), analyze: async () => fixture(), status: async () => ({ available: true, engine: 'test', message: 'ready' }), ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
function post(base, body = input, headers = {}) { return fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: JSON.stringify(body) }); }

test('validates and trims requests while preserving essay internals', () => {
  assert.deepEqual(validateRequest({ ...input, prompt: ' ' + input.prompt + ' ', essay: '\n' + input.essay + '\n' }), input);
  for (const bad of [null, [], {}, { ...input, prompt: 'short' }, { ...input, essay: 'short' }, { ...input, essay: 'x'.repeat(16001) }, { ...input, targetBand: 7.2 }, { ...input, targetBand: '7' }]) assert.throws(() => validateRequest(bad));
});
test('separates independent model context from student writing', () => {
  const secretEssay = 'UNIQUE STUDENT EXAMPLE NEVER FOR MODEL';
  assert(buildCorrectionPrompt({ ...input, essay: secretEssay }).includes(secretEssay));
  const modelPrompt = buildModelPrompt({ ...input, essay: secretEssay });
  assert(!modelPrompt.includes(secretEssay)); assert(modelPrompt.includes(input.prompt));
  assert(!modelPrompt.includes('studentEssay'));
});
test('validates complete analysis and exact annotation sources', () => {
  validateAnalysis(fixture(), input.essay);
  for (const mutation of [
    data => { data.issues[0].original = 'a fabricated mistake'; },
    data => { data.issues[0].replacement = 'a fabricated correction'; },
    data => { data.model.notes[0].quote = 'a fabricated model quote'; },
    data => { data.expressions[0].text = 'not in the text'; },
    data => { data.expressions[0].source = 'unknown'; },
    data => { data.expressions[1].id = data.expressions[0].id; }
  ]) { const data = fixture(); mutation(data); assert.throws(() => validateAnalysis(data, input.essay)); }
});
test('rejects ambiguous repeated annotation fragments in each source', () => {
  assert.throws(() => validateAnalysis(fixture(), input.essay + ' There are several reason to change.'), /Original issue must be unique/);
  const replacement = fixture(); replacement.corrected.text += ' There are several reasons for this.';
  assert.throws(() => validateAnalysis(replacement, input.essay), /Replacement must be unique/);
  const note = fixture(); note.model.text += ' Good buses reduce traffic.';
  assert.throws(() => validateAnalysis(note, input.essay), /Model note must be unique/);
  const correctedExpression = fixture(); correctedExpression.corrected.text += ' We should improve buses.';
  assert.throws(() => validateAnalysis(correctedExpression, input.essay), /Expression must be unique/);
  const modelExpression = fixture(); modelExpression.model.notes = []; modelExpression.model.text += ' Good buses reduce traffic.';
  assert.throws(() => validateAnalysis(modelExpression, input.essay), /Expression must be unique/);
});
test('accepts repeated error words when surrounding context uniquely identifies the correction', () => {
  const original = 'There are several reason to improve buses. I can list several reason to build parks.';
  const data = fixture();
  data.corrected.text = 'There are several reasons to improve buses. I can list several reasons to build parks.';
  data.issues = [
    { ...data.issues[0], original: 'several reason to improve buses', replacement: 'several reasons to improve buses' },
    { ...data.issues[0], id: 'g2', original: 'several reason to build parks', replacement: 'several reasons to build parks' }
  ];
  validateAnalysis(data, original);
});
test('rejects invalid or incomplete band estimates', () => {
  for (const mutation of [
    data => { data.originalScore.criteria[0].band = 6.3; },
    data => { data.originalScore.criteria[0].key = 'LR'; },
    data => { data.corrected.score.low = 8; data.corrected.score.high = 6; },
    data => { data.model.score.criteria.pop(); },
    data => { data.model.score.criteria[0].band = 10; },
    data => { data.model.score.criteria[0].evidence = ''; },
    data => { data.priorities.pop(); }
  ]) { const data = fixture(); mutation(data); assert.throws(() => validateAnalysis(data, input.essay)); }
});
test('bounds issue and expression counts', () => {
  const data = fixture(); data.issues = Array.from({ length: 13 }, (_, index) => ({ ...data.issues[0], id: String(index) }));
  assert.throws(() => validateAnalysis(data, input.essay));
  const model = fixture(); model.expressions = Array.from({ length: 5 }, (_, index) => ({ ...model.expressions[1], id: String(index) }));
  assert.throws(() => validateModel(model));
  const correction = fixture(); correction.expressions = Array.from({ length: 5 }, (_, index) => ({ ...correction.expressions[0], id: String(index) }));
  assert.throws(() => validateCorrection(correction, input.essay));
});
test('serves app and reports engine status with security headers', async t => {
  const base = await withServer(t);
  const page = await fetch(base); assert.equal(page.status, 200); assert((await page.text()).includes('IELTS'));
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff'); assert(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  const status = await fetch(`${base}/api/status`).then(response => response.json()); assert.equal(status.available, true);
  const head = await fetch(base, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
});
test('posts valid analysis and reports request validation errors', async t => {
  const base = await withServer(t); const response = await post(base);
  assert.equal(response.status, 200); validateAnalysis(await response.json(), input.essay);
  assert.equal((await post(base, { ...input, targetBand: 11 })).status, 400);
  assert.equal((await fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' })).status, 400);
  assert.equal((await post(base, input, { 'Content-Type': 'text/plain' })).status, 415);
});
test('rejects cross-origin and DNS rebinding requests', async t => {
  const base = await withServer(t);
  assert.equal((await post(base, input, { Origin: 'https://malicious.example' })).status, 403);
  const badHostStatus = await new Promise((resolve, reject) => { const request = http.get(`${base}/api/status`, { headers: { Host: 'malicious.example' } }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); });
  assert.equal(badHostStatus, 403);
  assert.equal((await post(base, input, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
});
test('rejects directory traversal and source-file access', async t => {
  const base = await withServer(t);
  for (const requested of ['/%2e%2e%2fsecret.txt', '/%2e%2e%5csecret.txt', '/%00', '/server.mjs', '/analysis-schema.mjs']) {
    const response = await fetch(base + requested); assert([400, 403, 404].includes(response.status)); assert(!(await response.text()).includes('private'));
  }
});
test('limits raw body size before model invocation', async t => {
  let called = false;
  const base = await withServer(t, { analyze: async () => { called = true; return fixture(); } });
  const response = await post(base, { ...input, essay: 'x'.repeat(70000) }); assert.equal(response.status, 413); assert.equal(called, false);
  assert.equal((await post(base)).status, 200, 'server must release busy flag after rejected request');
});
test('serializes requests and releases busy state after completion', async t => {
  let release, entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const base = await withServer(t, { analyze: async () => { entered(); await gate; return fixture(); } });
  const first = post(base); await enteredPromise;
  assert.equal((await post(base)).status, 409);
  release(); assert.equal((await first).status, 200); assert.equal((await post(base)).status, 200);
});
test('client cancellation reaches analysis engine', async t => {
  let entered, cancelled;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const cancelledPromise = new Promise(resolve => { cancelled = resolve; });
  const base = await withServer(t, { analyze: async (_input, { signal }) => { entered(); await new Promise(resolve => signal.addEventListener('abort', () => { cancelled(); resolve(); }, { once: true })); throw new Error('cancelled'); } });
  const controller = new AbortController();
  const request = fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: controller.signal }).catch(() => null);
  await enteredPromise; controller.abort(); await request;
  await Promise.race([cancelledPromise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('cancellation not forwarded')), 2000); timer.unref(); })]);
});
test('never returns a sample fallback or internal error details', async t => {
  const base = await withServer(t, { analyze: async () => { throw new Error('secret-provider-data'); } });
  const response = await post(base); assert.equal(response.status, 500);
  const body = await response.json(); assert.equal(typeof body.error, 'string'); assert(!JSON.stringify(body).includes('secret-provider-data')); assert(!body.originalScore);
});
test('classifies invalid model annotations as an upstream failure', async t => {
  const invalid = fixture(); invalid.issues[0].replacement = 'missing correction';
  const base = await withServer(t, { analyze: async () => invalid });
  const response = await post(base); assert.equal(response.status, 502);
  assert.equal(typeof (await response.json()).error, 'string');
});
test('switches the selected provider through the local-only endpoint', async t => {
  const base = await withServer(t, { status: async () => ({ available:false, provider:'ollama', selected:'ollama', engine:'Ollama', message:'pull a model' }) });
  const response = await fetch(`${base}/api/provider`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({provider:'ollama'}) });
  assert.equal(response.status,200);
  assert.equal((await response.json()).provider,'ollama');
  const invalid = await fetch(`${base}/api/provider`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({provider:'invalid'}) });
  assert.equal(invalid.status,400);
});

test('local AI setup endpoints expose only the injected manager lifecycle', async t => {
  const calls = [];
  const localAI = {
    getStatus: async () => ({ supported: true, busy: false, phase: 'idle', message: 'ready' }),
    start: () => { calls.push('start'); return { supported: true, busy: true, phase: 'checking' }; },
    cancel: () => { calls.push('cancel'); return { supported: true, busy: false, phase: 'cancelled' }; },
    getProviderConfig: () => null,
    close: async () => {},
  };
  const base = await withServer(t, { localAI });
  const info = await fetch(`${base}/api/app-info`);
  assert.equal((await info.json()).app, 'ielts-writing-studio');
  const start = await fetch(`${base}/api/local-ai/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(start.status, 202);
  assert.deepEqual(calls, ['start']);
  const cancel = await fetch(`${base}/api/local-ai/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(cancel.status, 200);
  assert.deepEqual(calls, ['start', 'cancel']);
  assert.equal((await fetch(`${base}/api/local-ai/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[]' })).status, 400);
});
