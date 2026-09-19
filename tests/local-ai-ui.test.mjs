import test from 'node:test';
import assert from 'node:assert/strict';
import { initLocalAiSetup } from '../public/local-ai-setup.js';

// 隔离浏览器和请求边界，直接运行本地准备组件，避免测试触发真实模型下载。
async function withSetupUi({ search = '', failStart = false } = {}, check) {
  const names = ['document', 'location', 'fetch', 'setInterval', 'clearInterval'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const nodes = new Map();
  const requests = [];
  const timers = new Set();
  let focused = null;
  function node(id) {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, {
        classList: { add(value) { classes.add(value); }, toggle(value, enabled) { enabled ? classes.add(value) : classes.delete(value); }, contains: value => classes.has(value) },
        parentElement: { classList: { toggle() {} } }, style: {}, dataset: {},
        addEventListener() {}, focus() { focused = id; }, scrollIntoView() {},
      });
    }
    return nodes.get(id);
  }
  try {
    globalThis.document = { getElementById: node };
    globalThis.location = { search };
    globalThis.setInterval = callback => { timers.add(callback); return callback; };
    globalThis.clearInterval = timer => timers.delete(timer);
    globalThis.fetch = async (url, options = {}) => {
      requests.push({ url, method: options.method || 'GET' });
      if (failStart && options.method === 'POST') return { ok: false, status: 503, json: async () => ({ error: 'Synthetic offline' }) };
      return { ok: true, json: async () => ({ phase: 'idle', supported: true, busy: false }) };
    };
    const ui = initLocalAiSetup();
    await new Promise(resolve => setImmediate(resolve));
    await check({ ui, node, requests, timers, focused: () => focused });
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('first-run setup offers a choice without starting a model download', async () => {
  await withSetupUi({ search: '?setup=1' }, async ({ node, requests, focused }) => {
    assert.deepEqual(requests, [{ url: '/api/local-ai/status', method: 'GET' }]);
    assert.equal(focused(), 'cloud-ai-open');
    assert.equal(node('local-ai-setup-start').disabled, false);
  });
});

test('failed preparation request exposes an enabled retry and clears stale busy controls', async () => {
  await withSetupUi({ failStart: true }, async ({ ui, node, timers }) => {
    await ui.start();
    assert.equal(ui.getState().phase, 'error');
    assert.equal(node('local-ai-setup-retry').classList.contains('hidden'), false);
    assert.equal(node('local-ai-setup-retry').disabled, false);
    assert.equal(node('local-ai-setup-cancel').classList.contains('hidden'), true);
    assert.equal(node('local-ai-setup').classList.contains('is-busy'), false);
    assert.equal(timers.size, 0);
  });
});
