import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { analyzeWriting, parseWorkbuddyOutput, createServer, workbuddyEnv } from '../server.mjs';
import { createCloudSettingsStore } from '../cloud-settings.mjs';
import { setProviderOverride, getProviderOverride } from '../provider.mjs';
import { DEMO_PROMPT, DEMO_ESSAY, DEMO_ANALYSIS } from '../public/demo.js';

const FAKE_CLI = `import { readFileSync, appendFileSync } from 'node:fs';
const argv = process.argv.slice(2);
if (process.env.FAKE_WORKBUDDY_LOG) appendFileSync(process.env.FAKE_WORKBUDDY_LOG, JSON.stringify(argv) + '\\n');
if (process.env.FAKE_WORKBUDDY_MODE === 'auth') {
  process.stderr.write('Authentication required. Please use /login command to sign in to your account\\n');
  process.exit(0);
}
if (process.env.FAKE_WORKBUDDY_MODE === 'garbage') {
  process.stdout.write('not json at all\\n');
  process.exit(0);
}
const index = argv.indexOf('--json-schema');
const schema = index >= 0 ? JSON.parse(argv[index + 1]) : {};
const demo = JSON.parse(readFileSync(process.env.FAKE_WORKBUDDY_FIXTURE, 'utf8'));
const isCorrection = Boolean(schema.properties && schema.properties.corrected);
const payload = isCorrection
  ? { originalScore: demo.originalScore, corrected: demo.corrected, issues: demo.issues, priorities: demo.priorities, expressions: demo.expressions.filter(item => item.source === 'corrected') }
  : { model: demo.model, expressions: demo.expressions.filter(item => item.source === 'model') };
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: JSON.stringify(payload) }) + '\\n');
`;

async function fakeCli(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wb-cli-'));
  const cli = path.join(dir, 'fake-codebuddy.mjs');
  const fixture = path.join(dir, 'fixture.json');
  const log = path.join(dir, 'argv.log');
  await writeFile(cli, FAKE_CLI, 'utf8');
  await writeFile(fixture, JSON.stringify(DEMO_ANALYSIS), 'utf8');
  const previous = { path: process.env.IELTS_WORKBUDDY_PATH, fixture: process.env.FAKE_WORKBUDDY_FIXTURE, log: process.env.FAKE_WORKBUDDY_LOG, mode: process.env.FAKE_WORKBUDDY_MODE, provider: getProviderOverride() };
  process.env.IELTS_WORKBUDDY_PATH = cli;
  process.env.FAKE_WORKBUDDY_FIXTURE = fixture;
  process.env.FAKE_WORKBUDDY_LOG = log;
  delete process.env.FAKE_WORKBUDDY_MODE;
  setProviderOverride('workbuddy');
  t.after(async () => {
    for (const [key, value] of Object.entries({ IELTS_WORKBUDDY_PATH: previous.path, FAKE_WORKBUDDY_FIXTURE: previous.fixture, FAKE_WORKBUDDY_LOG: previous.log, FAKE_WORKBUDDY_MODE: previous.mode })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    setProviderOverride(previous.provider);
    await rm(dir, { recursive: true, force: true });
  });
  return { cli, log };
}

test('WorkBuddy output accepts the CLI envelope and a bare structured result', () => {
  assert.deepEqual(parseWorkbuddyOutput('{"type":"result","result":"{\\"ok\\":true}"}'), { ok: true });
  assert.deepEqual(parseWorkbuddyOutput('{"structured_output":{"ok":true}}'), { ok: true });
  assert.deepEqual(parseWorkbuddyOutput('log line\n{"type":"result","result":{"ok":true}}'), { ok: true });
  // 某些版本直接打印结构化结果，没有 result 包装。
  assert.deepEqual(parseWorkbuddyOutput('{\n  "model": { "text": "x" }\n}'), { model: { text: 'x' } });
});

test('WorkBuddy output turns an unauthenticated response into an actionable message', () => {
  assert.throws(
    () => parseWorkbuddyOutput('{"is_error":true,"result":"Authentication required. Please use /login command to sign in to your account"}'),
    // 现在统一指向页面上的「一键连接」，不再让用户去找文件或敲命令。
    error => error.status === 503 && /还没有登录/u.test(error.message) && /一键连接/u.test(error.message) && !/\/login/u.test(error.message)
  );
  assert.throws(() => parseWorkbuddyOutput('not json at all'), /not valid JSON|was not JSON/);
});

test('a WorkBuddy analysis runs the CLI with a JSON schema and no tools', async t => {
  const { log } = await fakeCli(t);
  const result = await analyzeWriting({ prompt: DEMO_PROMPT, essay: DEMO_ESSAY, targetBand: 7, taskType: 'task2' });
  assert.ok(result.issues.length > 0);
  assert.equal(result.corrected.text, DEMO_ANALYSIS.corrected.text);
  const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(calls.length, 2, '评分与范文各调用一次命令行');
  for (const argv of calls) {
    assert.ok(argv.includes('--json-schema'), '必须把 schema 交给 CLI 做结构化输出');
    assert.equal(argv[argv.indexOf('--tools') + 1], '', '必须禁用命令行工具的权限');
    assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'dontAsk');
    assert.equal(argv[argv.indexOf('--port') + 1], '0', '让系统分配端口，避免与桌面版冲突');
    assert.ok(argv.includes('-p') && argv.includes('--output-format'));
  }
});

test('a WorkBuddy analysis explains the one-time login instead of failing silently', async t => {
  await fakeCli(t);
  process.env.FAKE_WORKBUDDY_MODE = 'auth';
  await assert.rejects(
    analyzeWriting({ prompt: DEMO_PROMPT, essay: DEMO_ESSAY, targetBand: 7 }),
    error => error.status === 503 && /还没有登录/u.test(error.message) && /一键连接/u.test(error.message)
  );
});

test('a missing WorkBuddy installation points at the environment variable', async t => {
  const previous = { path: process.env.IELTS_WORKBUDDY_PATH, provider: getProviderOverride() };
  process.env.IELTS_WORKBUDDY_PATH = path.join(os.tmpdir(), 'definitely-not-installed', 'codebuddy');
  setProviderOverride('workbuddy');
  t.after(() => {
    if (previous.path === undefined) delete process.env.IELTS_WORKBUDDY_PATH; else process.env.IELTS_WORKBUDDY_PATH = previous.path;
    setProviderOverride(previous.provider);
  });
  await assert.rejects(
    analyzeWriting({ prompt: DEMO_PROMPT, essay: DEMO_ESSAY, targetBand: 7 }),
    error => error.status === 503 && /IELTS_WORKBUDDY_PATH/u.test(error.message)
  );
});

test('GET /api/provider?refresh=1 asks for a fresh probe instead of the cached status', async t => {
  const seen = [];
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-refresh-'));
  const server = createServer({
    status: async options => { seen.push(options); return { available: false, engine: 'WorkBuddy CLI', message: '还没有登录' }; },
    cloudStore: createCloudSettingsStore({ rootDir: root }),
    localAI: { getStatus: async () => ({ busy: false, phase: 'idle' }), restore: async () => ({}), close: async () => ({}), start: () => ({}), cancel: () => ({}), getProviderConfig: () => null },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  await fetch(`${base}/api/provider?refresh=1`);
  await fetch(`${base}/api/provider`);
  assert.deepEqual(seen[0], { wait: true, refresh: true }, '点“重新检查”必须丢掉缓存并等待真实结果');
  assert.deepEqual(seen[1], { wait: false }, '普通轮询仍然不等探测结果');
});

test('the gateway spawn environment forces the lite bundle and strips proxy variables', () => {
  const previous = { proxy: process.env.HTTPS_PROXY, lite: process.env.CODEBUDDY_FORCE_LITE_WB_BUNDLE };
  process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';
  process.env.https_proxy = 'http://127.0.0.1:7890';
  delete process.env.CODEBUDDY_FORCE_LITE_WB_BUNDLE;
  try {
    const env = workbuddyEnv();
    // 安装包只带 codebuddy-lite-wb.mjs；不带这个变量，--serve 会报 MODULE_NOT_FOUND。
    assert.equal(env.CODEBUDDY_FORCE_LITE_WB_BUNDLE, '1');
    assert.equal(env.HTTPS_PROXY, undefined, '代理变量会让命令行启动阶段报 setProxy 错误');
    assert.equal(env.https_proxy, undefined, '小写副本也要一起清掉');
    assert.equal(env.NO_PROXY, '*');
  } finally {
    if (previous.proxy === undefined) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY = previous.proxy;
    if (previous.lite === undefined) delete process.env.CODEBUDDY_FORCE_LITE_WB_BUNDLE; else process.env.CODEBUDDY_FORCE_LITE_WB_BUNDLE = previous.lite;
  }
});
