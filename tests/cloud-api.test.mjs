import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createServer, testCloudConnection } from '../server.mjs';
import { createCloudSettingsStore, validateCloudSettings } from '../cloud-settings.mjs';
import { ProviderError, getProviderOverride, setProviderOverride, setCloudConfig } from '../provider.mjs';
import { DEMO_PROMPT, DEMO_ESSAY, DEMO_ANALYSIS } from '../public/demo.js';

const draft = { provider: 'deepseek', apiKey: 'synthetic-test-key' };
const essayInput = { prompt: DEMO_PROMPT, essay: DEMO_ESSAY, targetBand: 7 };
function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}
async function fixture(t, options = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jujin-cloud-api-'));
  const store = createCloudSettingsStore({ rootDir });
  if (options.saved) await store.save(options.saved, { tested: true });
  const probes = [];
  const localAI = {
    getStatus: async () => ({ busy: false, phase: 'idle' }),
    getProviderConfig: () => null,
    start: () => ({ busy: true, phase: 'checking' }),
    cancel: () => ({ busy: false, phase: 'cancelled' }),
    close: async () => {}
  };
  const server = createServer({
    cloudStore: store, localAI,
    status: async () => ({ available: true, provider: 'compatible', selected: getProviderOverride() }),
    analyze: async () => structuredClone(DEMO_ANALYSIS),
    probeCloud: async (candidate, { signal }) => { probes.push(candidate); assert.equal(signal.aborted, false); },
    ...options
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    setCloudConfig(null); setProviderOverride('auto');
    await fs.rm(rootDir, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${server.address().port}`, server, store, probes };
}
function request(base, endpoint = '/api/cloud-settings', body = draft, extra = {}) {
  return fetch(base + endpoint, {
    method: 'POST', ...extra,
    headers: { 'Content-Type': 'application/json', Origin: base, ...extra.headers },
    body: JSON.stringify(body)
  });
}

test('cloud API 仅返回公开设置，成功检测后才持久化并选择在线模式', async t => {
  const { base, store, probes } = await fixture(t);
  assert.equal((await fetch(base + '/api/cloud-settings').then(r => r.json())).configured, false);
  const response = await request(base);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.provider, 'deepseek');
  assert.equal(body.tested, true);
  assert.equal(body.keyConfigured, true);
  assert.equal(body.providerStatus.selected, 'openai-compatible');
  assert.equal(JSON.stringify(body).includes(draft.apiKey), false);
  assert.equal(Object.hasOwn(body, 'apiKey'), false);
  assert.equal(probes.length, 1);
  assert.deepEqual(probes[0], validateCloudSettings(draft));
  assert.equal((await store.load()).apiKey, draft.apiKey);
  const visible = await fetch(base + '/api/cloud-settings').then(r => r.text());
  assert.equal(visible.includes(draft.apiKey), false);
});

test('cloud API 拒绝错误输入、内容类型和跨站请求，不执行连接检测', async t => {
  const { base, probes } = await fixture(t);
  for (const body of [null, [], {}, { ...draft, model: 'not valid' }, { ...draft, provider: 'unknown' }, { provider: 'custom', baseUrl: 'http://remote.example/v1', model: 'model', apiKey: 'key' }]) {
    assert.equal((await request(base, undefined, body)).status, 400);
  }
  assert.equal((await request(base, undefined, draft, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await request(base, undefined, draft, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  assert.equal((await request(base, undefined, draft, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await fetch(base + '/api/cloud-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })).status, 400);
  assert.equal((await request(base, undefined, { ...draft, apiKey: 'x'.repeat(70000) })).status, 413);
  assert.equal(probes.length, 0);
  assert.equal((await request(base)).status, 200, 'invalid input must release the switching lock');
});

test('cloud API 检测失败不覆盖现有设置且不暴露私密错误详情', async t => {
  const { base, store } = await fixture(t, { saved: draft, probeCloud: async () => { throw new ProviderError(401, 'AI 接口认证失败。'); } });
  const response = await request(base, undefined, { provider: 'openrouter', apiKey: 'invalid-new-key' });
  assert.equal(response.status, 401);
  assert.equal((await store.load()).apiKey, draft.apiKey);
  const visible = await fetch(base + '/api/cloud-settings').then(r => r.json());
  assert.equal(visible.provider, 'deepseek');
  assert.equal(JSON.stringify(visible).includes('invalid-new-key'), false);
  assert.equal(getProviderOverride(), 'openai-compatible');

  const second = await fixture(t, { probeCloud: async () => { throw new Error('private-key-and-provider-stack'); } });
  const failed = await request(second.base);
  assert.equal(failed.status, 500);
  assert.equal((await failed.text()).includes('private-key-and-provider-stack'), false);
  assert.equal(await second.store.load(), null);
});

test('cloud API 检测成功后可替换服务商，留空密钥只复用相同地址', async t => {
  const { base, probes, store } = await fixture(t, { saved: draft });
  assert.equal((await request(base, undefined, { provider: 'deepseek', model: 'other-model', apiKey: '' })).status, 200);
  assert.equal(probes[0].apiKey, draft.apiKey);
  assert.equal((await request(base, undefined, { provider: 'openrouter', apiKey: '' })).status, 400);
  assert.equal((await request(base, undefined, { provider: 'openrouter', apiKey: 'new-provider-key' })).status, 200);
  assert.equal((await store.load()).provider, 'openrouter');
  assert.equal(probes.at(-1).apiKey, 'new-provider-key');
});

test('cloud API 清除配置取消在线选择，仅本次使用不把新密钥保存到磁盘', async t => {
  const { base, store } = await fixture(t, { saved: draft });
  const session = await request(base, undefined, { provider: 'openrouter', apiKey: 'session-only-key', remember: false });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).configured, true);
  assert.equal(await store.load(), null);
  const cleared = await request(base, undefined, {}, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  assert.equal((await cleared.json()).configured, false);
  assert.equal(getProviderOverride(), 'auto');
  assert.equal((await fetch(base + '/api/cloud-settings').then(r => r.json())).keyConfigured, false);
});

test('在线配置保留时切回本地，重启服务也必须保持用户的本地选择', async t => {
  const first = await fixture(t, { saved: draft });
  const switched = await request(first.base, '/api/provider', { provider: 'ollama' });
  assert.equal(switched.status, 200);
  assert.equal((await first.store.load()).selectedProvider, 'ollama');
  const visible = await fetch(first.base + '/api/cloud-settings').then(r => r.json());
  assert.equal(visible.selectedProvider, 'ollama');
  assert.equal(visible.keyConfigured, true);
  const restarted = await fixture(t, { cloudStore: first.store });
  const status = await fetch(restarted.base + '/api/status').then(r => r.json());
  assert.equal(status.selected, 'ollama');
  assert.equal(restarted.probes.length, 0, '恢复设置不应该自动发送联网请求');
});

test('切换模式持久化失败时保留原模式，不能在失败后悄悄切到在线', async t => {
  const config = { ...validateCloudSettings(draft), tested:true, selectedProvider:'ollama' };
  const cloudStore = { load:async()=>config, setSelectedProvider:async()=>{throw new Error('Synthetic disk failure');} };
  const {base} = await fixture(t, {cloudStore});
  assert.equal((await fetch(base+'/api/status').then(r=>r.json())).selected,'ollama');
  const response = await request(base, '/api/provider', {provider:'openai-compatible'});
  assert.equal(response.status,500);
  assert.equal(getProviderOverride(),'ollama');
  assert.equal(config.selectedProvider,'ollama');
  assert.equal((await request(base,'/api/provider',{provider:'unknown'})).status,400);
});

test('cloud API 在分析期间拒绝修改，分析完成后恢复', async t => {
  const entered = gate(), finish = gate();
  t.after(() => finish.release());
  const { base } = await fixture(t, { analyze: async () => { entered.release(); await finish.promise; return structuredClone(DEMO_ANALYSIS); } });
  const pending = request(base, '/api/analyze', essayInput);
  await entered.promise;
  assert.equal((await request(base)).status, 409);
  assert.equal((await request(base, undefined, {}, { method: 'DELETE' })).status, 409);
  finish.release();
  assert.equal((await pending).status, 200);
  assert.equal((await request(base)).status, 200);
});

test('cloud API 在连接检测期间禁止分析、切换、设置和本地下载', async t => {
  const entered = gate(), finish = gate();
  t.after(() => finish.release());
  const { base } = await fixture(t, { probeCloud: async () => { entered.release(); await finish.promise; } });
  const pending = request(base);
  await entered.promise;
  assert.equal((await request(base)).status, 409);
  assert.equal((await request(base, undefined, {}, { method: 'DELETE' })).status, 409);
  assert.equal((await request(base, '/api/analyze', essayInput)).status, 409);
  assert.equal((await request(base, '/api/provider', { provider: 'ollama' })).status, 409);
  assert.equal((await request(base, '/api/local-ai/start', {})).status, 409);
  finish.release();
  assert.equal((await pending).status, 200);
});

test('cloud API 在本地模型准备期间拒绝设置', async t => {
  const { base } = await fixture(t, { localAI: { getStatus: async () => ({ busy: true }), close: async () => {} } });
  assert.equal((await request(base)).status, 409);
});

test('cloud API 同时到达的设置请求也只能进行一次连接检测', { timeout: 5000 }, async t => {
  const checking = gate(), secondCheck = gate(), continueCheck = gate();
  let checks = 0, probes = 0;
  t.after(() => continueCheck.release());
  const { base } = await fixture(t, {
    localAI: {
      getStatus: async () => { checks += 1; checking.release(); if (checks === 2) secondCheck.release(); await continueCheck.promise; return { busy: false }; },
      close: async () => {}
    },
    probeCloud: async () => { probes += 1; }
  });
  const first = request(base);
  await checking.promise;
  const second = request(base, undefined, { provider: 'openrouter', apiKey: 'second-key' });
  // 第二个请求要么立即被锁拦住，要么也到达异步状态检查；不能让检查期间出现空窗。
  await Promise.race([second, secondCheck.promise]);
  continueCheck.release();
  const responses = await Promise.all([first, second]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(probes, 1);
});

test('本地准备的请求体尚未收完时，在线设置也不能穿过并发锁', { timeout: 5000 }, async t => {
  const { base, server, probes } = await fixture(t);
  // 先等待初始化，随后直接在真实 HTTP request 事件上同步，不依赖任意延时。
  await fetch(base + '/api/status');
  const entered = gate();
  server.on('request', req => { if (req.url === '/api/local-ai/start') entered.release(); });
  const partial = http.request(base + '/api/local-ai/start', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '2' } });
  const localResponse = new Promise((resolve, reject) => {
    partial.on('response', res => { res.resume(); resolve(res.statusCode); });
    partial.on('error', reject);
  });
  partial.write('{');
  await entered.promise;
  let cloudResponse;
  try { cloudResponse = await request(base); }
  finally { partial.end('}'); }
  assert.equal(await localResponse, 202);
  assert.equal(cloudResponse.status, 409);
  assert.equal(probes.length, 0);
});

test('真实连接检测只发送固定小型 JSON 测试，不发送用户作文', async t => {
  let sent;
  const stub = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    sent = { body: JSON.parse(Buffer.concat(chunks).toString()), authorization: req.headers.authorization };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
  });
  await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { stub.closeAllConnections(); stub.close(resolve); }));
  const baseUrl = `http://127.0.0.1:${stub.address().port}/v1`;
  const { base } = await fixture(t, { probeCloud: testCloudConnection });
  const response = await request(base, undefined, { provider: 'custom', baseUrl, model: 'test-model', apiKey: 'synthetic-probe-key' });
  assert.equal(response.status, 200);
  assert.equal(sent.authorization, 'Bearer synthetic-probe-key');
  assert.equal(sent.body.messages[1].content, 'Return exactly {"ok":true}.');
  assert.equal(JSON.stringify(sent.body).includes(DEMO_ESSAY), false);
  assert.equal(JSON.stringify(sent.body).includes(DEMO_PROMPT), false);
  assert.equal(JSON.stringify(sent.body).includes('synthetic-probe-key'), false);
  assert.equal(sent.body.max_tokens, 1024);
});
