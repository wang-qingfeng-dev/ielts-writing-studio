import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createLocalAIManager, parsePullLine } from '../local-ai.mjs';

function response(data, status = 200) {
  const body = data instanceof Readable ? data : Readable.from([Buffer.from(typeof data === 'string' ? data : JSON.stringify(data))]);
  return { ok: status >= 200 && status < 300, status, body, json: async () => typeof data === 'string' ? JSON.parse(data) : data };
}

async function fixture(t, extra = {}) {
  const tempRoot = await fs.mkdtemp(path.join(tmpdir(), 'jujin-local-ai-'));
  const root = extra.rootDir || tempRoot;
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  if (root !== tempRoot) t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = { models: [], pulls: 0, chats: 0 };
  const fetch = async (url, init = {}) => {
    const target = new URL(url);
    if (target.pathname === '/api/tags') return response({ models: state.models.map(name => ({ name })) });
    if (target.pathname === '/api/pull') {
      state.pulls += 1;
      state.models.push('qwen2.5:3b');
      return response(Readable.from([
        Buffer.from('{"status":"downloading","total":100,"completed":40}\n'),
        Buffer.from('{"status":"success","total":100,"completed":100}\n')
      ]));
    }
    if (target.pathname === '/api/chat') {
      state.chats += 1;
      return response({ message: { content: '{"ok":true}' } });
    }
    throw new Error(`unexpected endpoint ${target.pathname}`);
  };
  const spawn = () => {
    const child = new EventEmitter();
    child.killed = false;
    child.kill = () => { child.killed = true; child.emit('exit', 0, null); };
    return child;
  };
  const archiveBytes = Buffer.from('fake-ollama-archive');
  const expectedSha256 = crypto.createHash('sha256').update(archiveBytes).digest('hex');
  const manager = createLocalAIManager({
    rootDir: root, platform: 'win32', arch: 'x64', memoryBytes: 16 * 1024 ** 3,
    model: 'qwen2.5:3b', fetch, spawn, expectedSha256,
    downloadArchive: async ({ destination, signal, onProgress }) => {
      if (signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' });
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, archiveBytes);
      onProgress(archiveBytes.length, archiveBytes.length);
    },
    extractArchive: async ({ destination }) => {
      await fs.mkdir(destination, { recursive: true });
      await fs.writeFile(path.join(destination, 'ollama.exe'), 'fake executable');
    },
    ...extra
  });
  return { manager, root, state, archiveBytes, expectedSha256 };
}

test('解析 Ollama NDJSON 下载进度并拒绝损坏行', () => {
  assert.deepEqual(parsePullLine('{"status":"downloading","total":200,"completed":50}'), { status: 'downloading', total: 200, completed: 50 });
  assert.equal(parsePullLine(''), null);
  assert.throws(() => parsePullLine('{bad-json}'), /格式无效/);
});

test('一键安装生命周期：下载、校验、启动、拉取模型和 smoke test', async t => {
  const f = await fixture(t);
  const first = f.manager.start();
  assert.equal(first.busy, true, 'start schedules work without waiting for it');
  let status;
  for (let i = 0; i < 100; i += 1) {
    status = await f.manager.getStatus();
    if (status.phase === 'ready' || status.phase === 'error') break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(status.phase, 'ready', status.message);
  assert.equal(f.state.pulls, 1);
  assert.equal(f.state.chats, 1);
  assert.deepEqual(f.manager.getProviderConfig(), { url: 'http://127.0.0.1:11435', model: 'qwen2.5:3b' });
  assert.equal((await f.manager.getStatus()).progress, 100);
  await f.manager.close();
});

test('start 幂等、cancel 可中断下载且不会清理 root 外的文件', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, {
    downloadArchive: async ({ signal }) => {
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'CANCELLED' })), { once: true });
        gate.then(resolve);
      });
    }
  });
  const outside = path.join(path.dirname(f.root), 'must-survive.txt');
  await fs.writeFile(outside, 'keep');
  assert.equal(f.manager.start().phase, 'checking');
  assert.equal(f.manager.start().busy, true);
  await new Promise(resolve => setTimeout(resolve, 10));
  const cancelled = f.manager.cancel();
  assert.equal(cancelled.phase, 'cancelled');
  release();
  for (let i = 0; i < 50 && (await f.manager.getStatus()).busy; i += 1) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await f.manager.getStatus()).phase, 'cancelled');
  assert.equal(await fs.readFile(outside, 'utf8'), 'keep');
  await f.manager.close();
  await fs.rm(outside, { force: true });
});

test('下载校验失败进入 error，且不暴露路径细节', async t => {
  const f = await fixture(t, { expectedSha256: '0'.repeat(64) });
  f.manager.start();
  let status;
  for (let i = 0; i < 100; i += 1) {
    status = await f.manager.getStatus();
    if (!status.busy) break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(status.phase, 'error');
  assert.match(status.message, /校验失败/);
  assert(!status.message.includes(f.root));
  await f.manager.close();
});

test('恢复已准备引擎不重新下载，并兼容中文隔离目录', async t => {
  const f = await fixture(t);
  f.manager.start();
  for (let i = 0; i < 100 && (await f.manager.getStatus()).busy; i += 1) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await f.manager.getStatus()).phase, 'ready');
  await f.manager.close();
  const secondRoot = path.join(path.dirname(f.root), '中文 本地AI');
  const second = await fixture(t, { rootDir: secondRoot });
  // 预先写入安装痕迹，restore 应直接启动并检查，而不会调用下载钩子。
  await fs.mkdir(path.join(second.root, 'ollama'), { recursive: true });
  await fs.writeFile(path.join(second.root, 'ollama', 'ollama.exe'), 'fake executable');
  second.state.models.push('qwen2.5:3b');
  second.manager.restore();
  for (let i = 0; i < 100 && (await second.manager.getStatus()).busy; i += 1) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await second.manager.getStatus()).phase, 'ready');
  assert.equal(second.state.pulls, 0, 'restore never downloads a missing model');
  await second.manager.close();
});

test('不支持的平台明确报告 unsupported', async () => {
  const manager = createLocalAIManager({ platform: 'linux', arch: 'x64', fetch: async () => { throw new Error('should not call'); } });
  manager.start();
  for (let i = 0; i < 50 && (await manager.getStatus()).busy; i += 1) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal((await manager.getStatus()).phase, 'unsupported');
  await manager.close();
});
