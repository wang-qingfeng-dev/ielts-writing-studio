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
  assert.match(script, /发现还在跑的旧实例/, '启动脚本要告诉用户正在换实例');
  assert.match(script, /Stop-Process -Id \$studioStalePid/);
  const checkAt = script.indexOf('$studioIdentity.version -ne $studioDiskVersion');
  const startAt = script.indexOf('Start-Process -FilePath $studioNodePath');
  assert.ok(checkAt > 0, '要先比较版本号');
  assert.ok(startAt > checkAt, '换版本的判断必须排在启动新实例之前');
});

// 版本号不变但代码改了（修 bug 的常态）时，旧进程会一直活着，
// 页面连的还是内存里的旧代码——用户看到的就是“修了跟没修一样”。
test('the launcher also replaces an instance whose code fingerprint differs', async () => {
  const script = await read('start.ps1');
  assert.match(script, /build-id\.mjs/, '启动脚本要读代码指纹');
  assert.match(script, /\$studioIdentity\.build/, '要和运行中实例的指纹比');
  assert.match(script, /程序文件已更新/);
  const checkAt = script.indexOf('$studioIdentity.build');
  const startAt = script.indexOf('Start-Process -FilePath $studioNodePath');
  assert.ok(checkAt > 0 && startAt > checkAt, '指纹判断必须在启动新实例之前');
});

test('the build fingerprint is short, stable and exposed by the running server', async () => {
  const { buildId } = await import('../build-id.mjs');
  const first = buildId();
  assert.match(first, /^[0-9a-f]{12}$/u);
  assert.equal(buildId(), first, '同一份代码要给出同一个指纹');
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
