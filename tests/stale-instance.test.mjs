import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async (name) => readFile(new URL(name, root), 'utf8');

// 覆盖升级后，旧进程会继续占着端口，页面连的仍是旧服务，新接口一律 404。
// 这两条契约保证：启动脚本会把版本不一致的旧实例换掉，页面也不会把「接口不存在」直接甩给用户。
test('the launcher replaces a running instance whose version differs from the one on disk', async () => {
  const script = await read('start.ps1');
  assert.match(script, /api\/app-info/);
  assert.match(script, /package\.json/);
  assert.match(script, /发现旧版本/, '启动脚本要告诉用户正在换版本');
  assert.match(script, /Stop-Process -Id \$studioStalePid/);
  const checkAt = script.indexOf('$studioIdentity.version -ne $studioDiskVersion');
  const startAt = script.indexOf('Start-Process -FilePath $studioNodePath');
  assert.ok(checkAt > 0, '要先比较版本号');
  assert.ok(startAt > checkAt, '换版本的判断必须排在启动新实例之前');
});

test('the launcher survives environments that set both HTTP_PROXY and http_proxy', async () => {
  const script = await read('start.ps1');
  assert.match(script, /'http_proxy','https_proxy'/);
});

test('the connect panel explains a stale backend instead of showing 接口不存在', async () => {
  const app = await read('public/app.js');
  assert.match(app, /STALE_APP_HINT/);
  assert.match(app, /关掉这个页面，重新双击/);
  const loads = app.match(/response\.status === 404/g) || [];
  assert.ok(loads.length >= 2, '读取状态和发起登录两条路径都要拦住 404');
});
