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
  const state = { models: [], pulls: 0, chats: 0, chatBodies: [], spawned: [], running: false };
  const fetch = async (url, init = {}) => {
    const target = new URL(url);
    if (!state.running) throw new Error('simulated connection refused');
    if (target.pathname === '/api/tags') return response({ models: state.models.map(name => ({ name })) });
    if (target.pathname === '/api/pull') {
      state.pulls += 1;
      state.models.push(JSON.parse(init.body).model);
      return response(Readable.from([
        Buffer.from('{"status":"downloading","total":100,"completed":40}\n'),
        Buffer.from('{"status":"success","total":100,"completed":100}\n')
      ]));
    }
    if (target.pathname === '/api/chat') {
      state.chats += 1;
      state.chatBodies.push(JSON.parse(init.body));
      return response({ message: { content: '{"ok":true}' } });
    }
    throw new Error(`unexpected endpoint ${target.pathname}`);
  };
  const spawn = () => {
    state.running = true;
    const child = new EventEmitter();
    child.killed = false;
    child.kill = () => { child.killed = true; child.emit('exit', 0, null); };
    child.once('exit', () => { state.running = false; });
    state.spawned.push(child);
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
  await fs.writeFile(path.join(second.root, 'state.json'), JSON.stringify({ version: 1, ready: true, model: 'qwen2.5:3b' }));
  second.state.models.push('qwen2.5:3b');
  second.manager.restore();
  for (let i = 0; i < 100 && (await second.manager.getStatus()).busy; i += 1) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await second.manager.getStatus()).phase, 'ready');
  assert.equal(second.state.pulls, 0, 'restore never downloads a missing model');
  await second.manager.close();
});

test('日常启动没有完整安装记录时保持idle，绝不自动下载或启动进程', async t => {
  let downloads = 0, spawns = 0, requests = 0;
  const f = await fixture(t, {
    downloadArchive: async () => { downloads += 1; },
    spawn: () => { spawns += 1; throw new Error('unexpected spawn'); },
    fetch: async () => { requests += 1; throw new Error('unexpected request'); }
  });
  assert.equal((await f.manager.restore()).phase, 'idle');
  assert.deepEqual(await fs.readdir(f.root), [], '首次恢复不创建安装或模型目录');
  await fs.writeFile(path.join(f.root, 'state.json'), JSON.stringify({ version: 1, ready: false, model: 'qwen2.5:3b' }));
  assert.equal((await f.manager.restore()).phase, 'idle');
  assert.deepEqual({ downloads, spawns, requests }, { downloads: 0, spawns: 0, requests: 0 });
  await f.manager.close();
});

test('恢复沿用已安装模型，磁盘剩余不足安装预算也能启动，重复恢复幂等', async t => {
  let diskChecks = 0, downloads = 0, spawns = 0;
  const f = await fixture(t, {
    model: 'qwen2.5:7b', memoryBytes: 32 * 1024 ** 3,
    diskFreeBytes: async () => { diskChecks += 1; return 1; },
    downloadArchive: async () => { downloads += 1; throw new Error('no download'); },
    spawn: (file, args, options) => {
      spawns += 1;
      f.state.running = true;
      assert.equal(file, path.join(f.root, 'ollama', 'ollama.exe'));
      assert.equal(options.env.OLLAMA_HOST, '127.0.0.1:11435');
      const child = new EventEmitter(); child.killed = false; child.kill = () => { child.killed = true; };
      return child;
    }
  });
  await fs.mkdir(path.join(f.root, 'ollama'));
  await fs.writeFile(path.join(f.root, 'ollama', 'ollama.exe'), 'fake executable');
  await fs.writeFile(path.join(f.root, 'state.json'), JSON.stringify({ version: 1, ready: true, model: 'qwen2.5:3b', executablePath: 'C:\\untrusted\\other.exe' }));
  f.state.models.push('qwen2.5:3b');
  const status = await f.manager.restore();
  assert.equal(status.phase, 'ready', status.message);
  assert.equal(status.model, 'qwen2.5:3b', '恢复安装过的模型，不按当前内存重新选型');
  assert.equal(f.manager.getProviderConfig().model, 'qwen2.5:3b');
  assert.deepEqual({ diskChecks, downloads, spawns, pulls: f.state.pulls }, { diskChecks: 0, downloads: 0, spawns: 1, pulls: 0 });
  await f.manager.restore();
  assert.equal(spawns, 1);
  assert.equal(f.state.chats, 1);
  await f.manager.close();
});

test('恢复发现可执行文件或模型缺失时停止，不修复下载、不提供可用配置', async t => {
  let downloads = 0;
  const f = await fixture(t, { downloadArchive: async () => { downloads += 1; throw new Error('no download'); } });
  await fs.writeFile(path.join(f.root, 'state.json'), JSON.stringify({ version: 1, ready: true, model: 'qwen2.5:3b' }));
  const missingEngine = await f.manager.restore();
  assert.equal(missingEngine.phase, 'error');
  assert.match(missingEngine.message, /安装不完整/);
  await fs.mkdir(path.join(f.root, 'ollama'));
  await fs.writeFile(path.join(f.root, 'ollama', 'ollama.exe'), 'fake executable');
  const missingModel = await f.manager.restore();
  assert.equal(missingModel.phase, 'error');
  assert.match(missingModel.message, /模型尚未准备好/);
  assert.equal(downloads, 0);
  assert.equal(f.state.pulls, 0);
  assert.equal(f.manager.getProviderConfig(), null);
  await f.manager.close();
});

test('不支持的平台明确报告 unsupported', async () => {
  const manager = createLocalAIManager({ platform: 'linux', arch: 'x64', fetch: async () => { throw new Error('should not call'); } });
  manager.start();
  for (let i = 0; i < 50 && (await manager.getStatus()).busy; i += 1) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal((await manager.getStatus()).phase, 'unsupported');
  await manager.close();
});

test('已就绪进程崩溃后清除ready，恢复会重启而不重新下载', async t => {
  const f = await fixture(t);
  f.manager.start();
  for (let i = 0; i < 100 && (await f.manager.getStatus()).busy; i += 1) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await f.manager.getStatus()).phase, 'ready');
  const child = f.state.spawned[0];
  child.exitCode = 1; child.emit('exit', 1, null);
  assert.equal((await f.manager.getStatus()).phase, 'error');
  assert.equal(f.manager.getProviderConfig(), null);
  const restored = await f.manager.restore();
  assert.equal(restored.phase, 'ready');
  assert.equal(f.state.spawned.length, 2);
  assert.equal(f.state.pulls, 1, '崩溃恢复不能重复下载已经存在的模型');
  await f.manager.close();
});

test('新安装只推荐验证过的4B，低于12GiB内存不下载', async t => {
  for (const memoryGB of [4, 8, 11.9]) {
    let downloads = 0;
    const f = await fixture(t, { model: undefined, memoryBytes: memoryGB * 1024 ** 3, downloadArchive: async () => { downloads += 1; } });
    const current = f.manager.start();
    assert.equal(current.phase, 'unsupported');
    assert.equal(current.model, 'qwen3.5:4b');
    assert.equal(current.recommendedModel, 'qwen3.5:4b');
    assert.equal(current.requiredMemoryGB, 12);
    assert.match(current.message, /在线 AI/);
    assert.equal(downloads, 0);
    assert.equal(f.state.pulls, 0);
    assert.equal(f.state.spawned.length, 0);
    assert.deepEqual(await fs.readdir(f.root), []);
    await f.manager.close();
  }
});

test('已有旧模型仅提示更新，主动开始才下载4B且不删除旧模型', async t => {
  const f = await fixture(t, { model: undefined, memoryBytes: 16 * 1024 ** 3 });
  await fs.mkdir(path.join(f.root, 'ollama'));
  await fs.writeFile(path.join(f.root, 'ollama', 'ollama.exe'), 'fake executable');
  await fs.writeFile(path.join(f.root, 'state.json'), JSON.stringify({ version: 1, ready: true, model: 'qwen2.5:7b' }));
  f.state.models.push('qwen2.5:7b');
  const old = await f.manager.restore();
  assert.equal(old.phase, 'ready');
  assert.equal(old.model, 'qwen2.5:7b');
  assert.equal(old.updateAvailable, true);
  assert.equal(old.recommendedModel, 'qwen3.5:4b');
  assert.equal(f.state.pulls, 0);
  f.manager.start();
  for (let i = 0; i < 100 && (await f.manager.getStatus()).busy; i += 1) await new Promise(resolve => setTimeout(resolve, 5));
  const updated = await f.manager.getStatus();
  assert.equal(updated.phase, 'ready', updated.message);
  assert.equal(updated.model, 'qwen3.5:4b');
  assert.equal(updated.updateAvailable, false);
  assert.equal(updated.requiredDiskGB, 12);
  assert.equal(f.state.pulls, 1);
  assert.deepEqual(f.state.models, ['qwen2.5:7b', 'qwen3.5:4b']);
  assert.equal(f.state.chatBodies.at(-1).think, false);
  assert.equal(f.manager.getProviderConfig().model, 'qwen3.5:4b');
  assert.equal(JSON.parse(await fs.readFile(path.join(f.root, 'state.json'), 'utf8')).model, 'qwen3.5:4b');
  await f.manager.close();
});

test('专用端口已有有效服务时复用，既不重复启动也不在关闭时终止已有服务', async t => {
  const f = await fixture(t, { model: undefined });
  await fs.mkdir(path.join(f.root, 'ollama'));
  await fs.writeFile(path.join(f.root, 'ollama', 'ollama.exe'), 'fake executable');
  await fs.writeFile(path.join(f.root, 'state.json'), JSON.stringify({ version: 1, ready: true, model: 'qwen3.5:4b' }));
  f.state.running = true;
  f.state.models.push('qwen3.5:4b');
  const result = await f.manager.restore();
  assert.equal(result.phase, 'ready', result.message);
  assert.equal(f.state.spawned.length, 0, '已有模型服务不应再次spawn');
  assert.equal(f.state.pulls, 0);
  assert.equal(f.state.chats, 1);
  await f.manager.close();
  assert.equal(f.state.running, true, 'close不应终止另一个窗口拥有的服务');
});
