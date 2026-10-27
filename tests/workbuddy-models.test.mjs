import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import {
  DEFAULT_WORKBUDDY_MODEL,
  WORKBUDDY_MODELS,
  isKnownWorkbuddyModel,
  workbuddyModelLabel,
  normalizeWorkbuddyModel,
  workbuddyModelPayload,
  createWorkbuddyModelStore,
} from '../workbuddy-models.mjs';

test('the default model is still the balanced alias', () => {
  assert.equal(DEFAULT_WORKBUDDY_MODEL, 'balanced-model');
  assert.equal(workbuddyModelLabel('balanced-model'), '标准模型');
  assert.equal(workbuddyModelLabel('glm-5.3'), '智谱 GLM-5.3');
  // 不认识的模型原样显示，不能假装它有中文名。
  assert.equal(workbuddyModelLabel('some-new-model'), 'some-new-model');
});

test('every listed model has an id, a label and a group', () => {
  const ids = new Set();
  for (const item of WORKBUDDY_MODELS) {
    assert.ok(item.id && item.label, `模型缺少 id 或名称：${JSON.stringify(item)}`);
    assert.ok(['recommended', 'popular', 'more'].includes(item.group));
    assert.ok(!ids.has(item.id), `模型 ${item.id} 重复`);
    ids.add(item.id);
  }
  // 页面上最常用的三个别名必须在推荐组，用户第一眼就能选。
  for (const id of ['balanced-model', 'fast-model', 'deep-model']) {
    assert.ok(WORKBUDDY_MODELS.find(item => item.id === id && item.group === 'recommended'));
    assert.ok(isKnownWorkbuddyModel(id));
  }
});

test('model names are whitelisted before they reach the command line', () => {
  assert.equal(normalizeWorkbuddyModel('  glm-5.3  '), 'glm-5.3');
  assert.equal(normalizeWorkbuddyModel(''), DEFAULT_WORKBUDDY_MODEL);
  assert.equal(normalizeWorkbuddyModel('custom-local:gpt-6.1-sol'), 'custom-local:gpt-6.1-sol');
  assert.equal(normalizeWorkbuddyModel('rm -rf /'), '');
  assert.equal(normalizeWorkbuddyModel('glm 5.3'), '');
  assert.equal(normalizeWorkbuddyModel('a'.repeat(65)), '');
  assert.equal(normalizeWorkbuddyModel('-leading-dash'), '');
});

test('the payload the page receives carries the list and the current choice', () => {
  const payload = workbuddyModelPayload('glm-5.3');
  assert.equal(payload.model, 'glm-5.3');
  assert.equal(payload.label, '智谱 GLM-5.3');
  assert.equal(payload.known, true);
  assert.equal(payload.models.length, WORKBUDDY_MODELS.length);

  const fallback = workbuddyModelPayload('not-a-real-model');
  assert.equal(fallback.known, false);
  assert.equal(fallback.label, 'not-a-real-model');

  const empty = workbuddyModelPayload('');
  assert.equal(empty.model, DEFAULT_WORKBUDDY_MODEL);
});

test('the chosen model survives a restart', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wb-model-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createWorkbuddyModelStore({ rootDir: dir });

  assert.equal(await store.read(), DEFAULT_WORKBUDDY_MODEL, '第一次打开用默认模型');
  assert.equal(await store.write('deep-model'), 'deep-model');
  assert.equal(await store.read(), 'deep-model');
  assert.equal(await store.write('glm-5.3'), 'glm-5.3');
  assert.equal(await store.read(), 'glm-5.3');

  const saved = JSON.parse(await readFile(path.join(dir, 'workbuddy.json'), 'utf8'));
  assert.deepEqual(saved, { model: 'glm-5.3' });
  await assert.rejects(store.write('bad model'), /不合法/u, '非法模型名不能写进配置');
});

test('a broken settings file falls back to the default instead of crashing', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wb-model-broken-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'workbuddy.json'), '{ this is not json', 'utf8');
  const store = createWorkbuddyModelStore({ rootDir: dir });
  assert.equal(await store.read(), DEFAULT_WORKBUDDY_MODEL);

  await writeFile(path.join(dir, 'workbuddy.json'), JSON.stringify({ model: 'nope nope' }), 'utf8');
  assert.equal(await store.read(), DEFAULT_WORKBUDDY_MODEL);
});
