import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createServer } from '../server.mjs';
import { createCloudSettingsStore } from '../cloud-settings.mjs';
import { createWorkbuddyModelStore, DEFAULT_WORKBUDDY_MODEL } from '../workbuddy-models.mjs';

// 这些用例只验证页面依赖的三个接口，不碰真实的 WorkBuddy，也不写真实设置目录。
async function withServer(t, { gateway, models } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-api-'));
  const wbModels = models || createWorkbuddyModelStore({ rootDir: root });
  const server = createServer({
    cloudStore: createCloudSettingsStore({ rootDir: root }),
    workbuddyModels: wbModels,
    workbuddy: gateway,
    localAI: { getStatus: async () => ({ busy: false, phase: 'idle' }), restore: async () => ({}), close: async () => ({}), start: () => ({}), cancel: () => ({}), getProviderConfig: () => null },
    status: async () => ({ available: false, engine: 'WorkBuddy CLI', message: '还没有登录' }),
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
    await rm(root, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${server.address().port}`, root, wbModels };
}

const post = (base, pathname, body) => fetch(`${base}${pathname}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

test('GET /api/workbuddy returns the model list the page renders', async t => {
  const previous = process.env.IELTS_WORKBUDDY_PATH;
  // 指向一个假路径，避免在测试机上真的去扫安装目录。
  process.env.IELTS_WORKBUDDY_PATH = path.join(os.tmpdir(), 'fake-codebuddy');
  t.after(() => {
    if (previous === undefined) delete process.env.IELTS_WORKBUDDY_PATH;
    else process.env.IELTS_WORKBUDDY_PATH = previous;
  });
  const { base } = await withServer(t);
  const response = await fetch(`${base}/api/workbuddy`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.model, DEFAULT_WORKBUDDY_MODEL);
  assert.equal(body.label, '标准模型');
  assert.equal(body.installed, true);
  assert.ok(Array.isArray(body.models) && body.models.length >= 10);
  assert.ok(body.models.some(item => item.id === 'glm-5.3' && item.label === '智谱 GLM-5.3'));
});

test('POST /api/workbuddy/model saves the choice and reports the new label', async t => {
  const { base, root } = await withServer(t);
  const response = await post(base, '/api/workbuddy/model', { model: 'deep-model' });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.model, 'deep-model');
  assert.equal(body.label, '深度模型');

  const saved = JSON.parse(await readFile(path.join(root, 'workbuddy.json'), 'utf8'));
  assert.deepEqual(saved, { model: 'deep-model' });
});

test('POST /api/workbuddy/model rejects anything that is not a model id', async t => {
  const { base } = await withServer(t);
  for (const model of ['rm -rf /', 'glm 5.3', '../../etc/passwd', '']) {
    const response = await post(base, '/api/workbuddy/model', { model });
    // 空值等价于「回到默认」，其余都必须被拒绝。
    if (model === '') assert.equal(response.status, 200);
    else assert.equal(response.status, 400, `${model} 应该被拒绝`);
  }
});

test('POST /api/workbuddy/login hands the browser a real authorization link', async t => {
  const gateway = {
    login: async () => ({ authUrl: 'https://www.workbuddy.cn/login?platform=workbuddy&state=test-123' }),
    accountStatus: async () => ({ authenticated: false, account: null }),
    stop() {},
  };
  const { base } = await withServer(t, { gateway });
  const response = await post(base, '/api/workbuddy/login', {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(body.authUrl, /^https:\/\/www\.workbuddy\.cn\/login\?/u);
});

test('POST /api/workbuddy/login explains a missing installation instead of a vague error', async t => {
  const gateway = {
    login: async () => { const error = new Error('这台电脑上没有找到 WorkBuddy。'); error.code = 'missing'; throw error; },
    accountStatus: async () => ({ authenticated: false, account: null }),
    stop() {},
  };
  const { base } = await withServer(t, { gateway });
  const response = await post(base, '/api/workbuddy/login', {});
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /没有找到 WorkBuddy/u);
});

test('the login endpoint refuses a non-JSON body', async t => {
  const { base } = await withServer(t, { gateway: { login: async () => ({ authUrl: 'https://x' }), accountStatus: async () => ({}), stop() {} } });
  const response = await fetch(`${base}/api/workbuddy/login`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
  assert.equal(response.status, 415);
});
