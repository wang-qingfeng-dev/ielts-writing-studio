import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { parseGatewayBanner, createWorkbuddyGateway, GatewayError, summarizeFailure, describeExit } from '../workbuddy-gateway.mjs';

const BANNER = `mods: loaded mod "subscription-gate" from .codebuddy-plugin (tier user, hooks: prompt.submit)
  CodeBuddy Code HTTP Server
  Endpoint    http://127.0.0.1:49777
  Web UI      http://127.0.0.1:49777/?password=J6Sr58WhC0dFQmWe8ZPMyoPDTdPmv18BG-sq1YXibVQ
  Password    J6Sr58WhC0dFQmWe8ZPMyoPDTdPmv18BG-sq1YXibVQ
  Config      C:\\Users\\student\\.codebuddy\\settings.json
  Press Ctrl+C to stop the server`;

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

// 一个能记录请求的假 fetch：够验证「带没带上 Bearer」和「有没有解析 data 外壳」。
function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url, ...options });
    const { status = 200, body } = handler(url, options) || {};
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body ?? {})),
    };
  };
  impl.calls = calls;
  return impl;
}

test('the gateway banner yields a usable port and password', () => {
  const parsed = parseGatewayBanner(BANNER);
  assert.equal(parsed.port, 49777);
  assert.equal(parsed.password, 'J6Sr58WhC0dFQmWe8ZPMyoPDTdPmv18BG-sq1YXibVQ');
  // 横幅还没打印完整时要继续等，不能猜。
  assert.equal(parseGatewayBanner('Endpoint    http://127.0.0.1:49777\n'), null);
  assert.equal(parseGatewayBanner(''), null);
});

test('the gateway starts itself, authenticates every call and unwraps data', async () => {
  const child = fakeChild();
  const fetchImpl = fakeFetch(() => ({ body: { data: { authenticated: true, account: { userId: 'u-1' } } } }));
  const gateway = createWorkbuddyGateway({
    findCli: async () => 'C:/fake/codebuddy',
    resolveLaunch: async () => ({ command: 'node', args: ['cli.js'] }),
    spawnImpl: () => { setImmediate(() => child.stdout.emit('data', BANNER)); return child; },
    fetchImpl,
    idleTimeout: 0,
    cwd: 'C:/fake',
  });

  const status = await gateway.accountStatus();
  assert.deepEqual(status, { authenticated: true, account: { userId: 'u-1', name: '' } });
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, 'http://127.0.0.1:49777/api/v1/auth/account/status');
  assert.equal(fetchImpl.calls[0].headers.Authorization, 'Bearer J6Sr58WhC0dFQmWe8ZPMyoPDTdPmv18BG-sq1YXibVQ');
  assert.equal(gateway.running, true);
  gateway.stop();
  assert.equal(child.killed, true);
});

test('login hands back the official authorization url', async () => {
  const child = fakeChild();
  const fetchImpl = fakeFetch(() => ({ body: { data: { success: true, authUrl: 'https://www.workbuddy.cn/login?state=abc' } } }));
  const gateway = createWorkbuddyGateway({
    findCli: async () => 'C:/fake/codebuddy',
    resolveLaunch: async () => ({ command: 'node', args: ['cli.js'] }),
    spawnImpl: () => { setImmediate(() => child.stdout.emit('data', BANNER)); return child; },
    fetchImpl,
    idleTimeout: 0,
  });

  const result = await gateway.login();
  assert.equal(result.authUrl, 'https://www.workbuddy.cn/login?state=abc');
  const call = fetchImpl.calls[0];
  assert.equal(call.method, 'POST');
  assert.equal(call.url, 'http://127.0.0.1:49777/api/v1/auth/account/login');
  assert.ok(call.headers['Content-Type'].startsWith('application/json'));
  // 登录请求比普通查询慢，超时要放宽，不能被 20 秒掐断。
  gateway.stop();
});

test('a missing installation is reported as missing instead of a generic failure', async () => {
  const gateway = createWorkbuddyGateway({
    findCli: async () => '',
    resolveLaunch: async () => ({ command: 'node', args: [] }),
    spawnImpl: () => { throw new Error('should not spawn'); },
    idleTimeout: 0,
  });
  await assert.rejects(gateway.accountStatus(), error => error instanceof GatewayError && error.code === 'missing');
});

test('a gateway that never prints its banner times out with a clear reason', async () => {
  const child = fakeChild();
  const gateway = createWorkbuddyGateway({
    findCli: async () => 'C:/fake/codebuddy',
    resolveLaunch: async () => ({ command: 'node', args: ['cli.js'] }),
    spawnImpl: () => child,
    fetchImpl: fakeFetch(() => ({ body: {} })),
    bootTimeout: 40,
    idleTimeout: 0,
  });
  await assert.rejects(gateway.accountStatus(), error => error instanceof GatewayError && error.code === 'timeout');
  assert.equal(child.killed, true);
});

test('a crashed gateway surfaces the last line it printed', async () => {
  const child = fakeChild();
  const gateway = createWorkbuddyGateway({
    findCli: async () => 'C:/fake/codebuddy',
    resolveLaunch: async () => ({ command: 'node', args: ['cli.js'] }),
    spawnImpl: () => {
      setImmediate(() => {
        child.stderr.emit('data', 'Error: listen EADDRINUSE\n');
        child.emit('exit', 1);
      });
      return child;
    },
    fetchImpl: fakeFetch(() => ({ body: {} })),
    idleTimeout: 0,
  });
  await assert.rejects(gateway.accountStatus(), error => error instanceof GatewayError && /退出码 1/u.test(error.message));
});

test('a 401 from the gateway is marked so the page can offer a login button', async () => {
  const child = fakeChild();
  const gateway = createWorkbuddyGateway({
    findCli: async () => 'C:/fake/codebuddy',
    resolveLaunch: async () => ({ command: 'node', args: ['cli.js'] }),
    spawnImpl: () => { setImmediate(() => child.stdout.emit('data', BANNER)); return child; },
    fetchImpl: fakeFetch(() => ({ status: 401, body: { error: { message: 'Authentication required' } } })),
    idleTimeout: 0,
  });
  await assert.rejects(gateway.accountStatus(), error => error instanceof GatewayError && error.code === 'unauthorized');
  gateway.stop();
});

test('a missing bundle is explained in plain words instead of a stack trace', async () => {
  const stderr = [
    "node:internal/modules/cjs/loader:1247",
    "Error: Cannot find module '../dist/codebuddy'",
    "Require stack:",
    "- D://Software//WorkBuddyAI//resources//app.asar.unpacked//cli//bin//codebuddy",
    "{ code: 'MODULE_NOT_FOUND' }",
  ].join('\n');
  assert.equal(summarizeFailure(stderr), "Error: Cannot find module '../dist/codebuddy'");
  assert.match(describeExit(1, summarizeFailure(stderr)), /命令行组件不完整/u);
  assert.doesNotMatch(describeExit(1, summarizeFailure(stderr)), /Require stack/u);
  assert.match(describeExit(2, 'boom'), /退出码 2/u);
});
