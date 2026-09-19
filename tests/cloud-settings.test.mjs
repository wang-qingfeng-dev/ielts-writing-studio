import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLOUD_PRESETS, CloudSettingsError, cloudSettingsDirectory, createCloudSettingsStore, publicCloudSettings, validateCloudSettings } from '../cloud-settings.mjs';

const config = { provider: 'deepseek', apiKey: 'test-private-key' };
async function fixture(t) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jujin-cloud-settings-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  return { rootDir, store: createCloudSettingsStore({ rootDir }) };
}

test('预设填入官方地址与默认模型，硅基流动必须填写账号可用模型', () => {
  assert.deepEqual(validateCloudSettings(config), { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: config.apiKey });
  assert.equal(validateCloudSettings({ provider: 'openrouter', apiKey: 'test-key' }).model, 'openrouter/free');
  assert.throws(() => validateCloudSettings({ provider: 'siliconflow', apiKey: 'test-key' }), /模型名称/);
  assert.equal(CLOUD_PRESETS.length, 4);
});

test('云端必须 HTTPS，固定预设不能偷偷修改地址，本机兼容接口可免密钥', () => {
  for (const baseUrl of ['http://example.com/v1', 'https://user:password@example.com/v1', 'https://example.com/v1?key=secret', 'https://example.com/#secret', 'file:///tmp/model', 'http://127.0.0.1.evil.example/v1', 'http://192.168.1.10/v1']) {
    assert.throws(() => validateCloudSettings({ provider: 'custom', baseUrl, model: 'model', apiKey: 'test-key' }), CloudSettingsError);
  }
  assert.throws(() => validateCloudSettings({ ...config, baseUrl: 'https://example.com/v1' }), /预设服务商/);
  for (const baseUrl of ['http://localhost:1234/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:1234/v1']) {
    assert.equal(validateCloudSettings({ provider: 'custom', baseUrl, model: 'local' }).apiKey, '');
  }
  assert.throws(() => validateCloudSettings({ provider: 'custom', baseUrl: 'https://example.com/v1', model: 'cloud' }), /自己的 API 密钥/);
});

test('只为相同服务保留密钥；更改提供商或地址时绝不复用', () => {
  const current = validateCloudSettings(config);
  assert.equal(validateCloudSettings({ provider: 'deepseek', apiKey: '' }, { current }).apiKey, config.apiKey);
  assert.throws(() => validateCloudSettings({ provider: 'openrouter', apiKey: '' }, { current }), /自己的 API 密钥/);
  const custom = validateCloudSettings({ provider: 'custom', baseUrl: 'https://one.example/v1', model: 'a', apiKey: 'private' });
  assert.throws(() => validateCloudSettings({ provider: 'custom', baseUrl: 'https://two.example/v1', model: 'b' }, { current: custom }), /自己的 API 密钥/);
});

test('输入校验拒绝非对象、换行密钥和无效模型', () => {
  for (const input of [null, [], 'test', { ...config, apiKey: 'test\nInjected: yes' }, { ...config, model: 'model name' }, { ...config, apiKey: 'x'.repeat(4097) }]) {
    assert.throws(() => validateCloudSettings(input), CloudSettingsError);
  }
});

test('公开设置完全隐藏密钥；连接成功标记只能由调用方的选项确认', async t => {
  const { store } = await fixture(t);
  assert.equal((await store.getPublic()).configured, false);
  const saved = await store.save({ ...config, tested: true });
  assert.equal(saved.tested, false);
  const visible = publicCloudSettings(saved);
  assert.equal(visible.keyConfigured, true);
  assert.equal(visible.tested, false);
  assert.equal(visible.configured, true);
  assert.equal(JSON.stringify(visible).includes(config.apiKey), false);
  assert.equal(Object.hasOwn(visible, 'apiKey'), false);
  await store.save(config, { tested: true });
  assert.equal((await store.load()).tested, true);
});

test('原子保存可跨实例恢复，删除后消除密钥，不留下临时文件', async t => {
  const { store, rootDir } = await fixture(t);
  await store.save(config, { tested: true });
  const second = createCloudSettingsStore({ rootDir });
  assert.equal((await second.load()).apiKey, config.apiKey);
  await store.save({ provider: 'openrouter', apiKey: 'replacement-key' }, { tested: true });
  assert.equal((await second.load()).provider, 'openrouter');
  assert.deepEqual(await fs.readdir(rootDir), ['cloud-ai.json']);
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(path.join(rootDir, 'cloud-ai.json'))).mode & 0o777, 0o600);
    assert.equal((await fs.stat(rootDir)).mode & 0o777, 0o700);
  }
  await store.clear();
  assert.equal(await second.load(), null);
  assert.deepEqual(await fs.readdir(rootDir), []);
});

test('损坏配置报告固定错误，不泄漏文件内容，并允许重新保存', async t => {
  const { store, rootDir } = await fixture(t);
  await fs.writeFile(path.join(rootDir, 'cloud-ai.json'), '{sensitive-invalid-json');
  await assert.rejects(store.load(), error => error instanceof CloudSettingsError && !error.message.includes('sensitive'));
  await store.save(config);
  assert.equal((await store.load()).provider, 'deepseek');
});

test('并发保存按顺序完成，清除不会恢复之前排队的密钥', async t => {
  const { store } = await fixture(t);
  const saved = store.save(config);
  const cleared = store.clear();
  await Promise.all([saved, cleared]);
  assert.equal(await store.load(), null);
});

test('默认位置在操作系统用户配置目录，不在程序或源码目录', () => {
  const homeDir = path.join(os.tmpdir(), 'test-profile');
  const localDir = path.join(homeDir, 'local');
  assert.equal(cloudSettingsDirectory({ platform: 'win32', env: { LOCALAPPDATA: localDir }, homeDir }), path.join(localDir, 'JujinWritingStudio', 'settings'));
  assert.equal(cloudSettingsDirectory({ platform: 'linux', env: {}, homeDir }), path.join(homeDir, '.config', 'JujinWritingStudio', 'settings'));
});

test('保存最后选择的 AI 模式，重启后保留本地选择且不丢失在线设置', async t => {
  const { store, rootDir } = await fixture(t);
  assert.equal((await store.save(config, { tested: true })).selectedProvider, 'openai-compatible');
  await store.setSelectedProvider('ollama');
  const loaded = await createCloudSettingsStore({ rootDir }).load();
  assert.equal(loaded.selectedProvider, 'ollama');
  assert.equal(loaded.apiKey, config.apiKey);
  assert.equal(loaded.tested, true);
  assert.equal((await store.getPublic()).selectedProvider, 'ollama');
  await store.setSelectedProvider('codex');
  assert.equal((await store.load()).selectedProvider, 'codex');
  await store.save(config, { tested: true });
  assert.equal((await store.load()).selectedProvider, 'openai-compatible', '重新测试并保存在线设置后才选择在线模式');
  await assert.rejects(store.setSelectedProvider('unknown'), /不支持/);
  assert.equal((await store.load()).selectedProvider, 'openai-compatible');
});

test('旧配置默认保持在线模式；空配置设置偏好不会生成含密钥文件', async t => {
  const { store, rootDir } = await fixture(t);
  assert.equal(await store.setSelectedProvider('ollama'), null);
  assert.deepEqual(await fs.readdir(rootDir), []);
  await fs.writeFile(path.join(rootDir, 'cloud-ai.json'), JSON.stringify({ version: 1, ...validateCloudSettings(config), tested: true }));
  assert.equal((await store.load()).selectedProvider, 'openai-compatible');
  await store.setSelectedProvider('auto');
  assert.equal((await store.load()).selectedProvider, 'auto');
  await store.clear();
  assert.equal((await store.getPublic()).selectedProvider, 'auto');
  assert.deepEqual(await fs.readdir(rootDir), []);
});
