// WorkBuddy 命令行带一个本地网关模式：`codebuddy --serve --port 0`。
// 这个模式不需要终端窗口，启动后会打印端口与随机密码，并提供账号登录接口。
// 应用用它把「找文件 / 双击 / 手打 /login」这三步全部省掉：
// 点一次按钮 → 拿到官方登录链接 → 浏览器授权 → 状态自动变绿。
import { spawn } from 'node:child_process';

const DEFAULT_BOOT_TIMEOUT = 45000;
// 连上以后不立刻退出：登录、切换模型、接着分析都会复用同一个进程。
const DEFAULT_IDLE_TIMEOUT = 10 * 60 * 1000;

export class GatewayError extends Error {
  constructor(message, { code = 'gateway', detail = '' } = {}) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.detail = detail;
  }
}

// 从网关启动横幅里取出端口与密码，例如：
//   Endpoint    http://127.0.0.1:49777
//   Password    J6Sr58WhC0dFQmWe8ZPMyoPDTdPmv18BG-sq1YXibVQ
export function parseGatewayBanner(text) {
  const source = String(text || '');
  const port = source.match(/Endpoint\s+https?:\/\/[^\s:]+:(\d+)/u);
  const password = source.match(/Password\s+([A-Za-z0-9_-]{8,})/u);
  if (!port || !password) return null;
  return { port: Number(port[1]), password: password[1] };
}

// 把网关返回的 JSON 拆成一层：接口统一包在 { data: ... } 里。
function unwrap(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload) return payload.data;
  return payload;
}

// 网关开过网页版之后会启用一层「来源校验」：没带自家请求头一律 403，
// 返回体是 {"error":"Missing required header: x-codebuddy-request"}。
// 官方前端一直带着这个头，所以只在真实用户机器上（打开过网页登录）才会炸。
// 这里始终带上；万一将来换成别的头名，再从 403 的报错里把名字读出来补一次。
const SECURITY_HEADER = 'x-codebuddy-request';

export function missingHeaderName(text) {
  const match = /Missing required header:\s*([A-Za-z0-9_-]+)/u.exec(String(text || ''));
  return match ? match[1] : '';
}

export function describeBlocked(status, payload, text) {
  const message = payload?.error?.message || payload?.message || (typeof payload?.error === 'string' ? payload.error : '');
  const header = missingHeaderName(text);
  if (header) return `WorkBuddy 的本地接口要求额外的校验头（${header}），这次没能通过。请把软件更新到最新版；急用的话先切到免费在线 AI。`;
  if (status === 403) return 'WorkBuddy 拒绝了这次连接（可能账号权限或版本不匹配）。可以重试一次，或先改用免费在线 AI。';
  return message || `网关返回 ${status}`;
}

// 子进程失败时 stderr 往往是一整段 Node 堆栈；挑一句有用的，别把安装路径和栈甩给用户。
export function summarizeFailure(text) {
  const lines = String(text || '')
    .replace(/\u001b\[[0-9;]*m/gu, '')
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean);
  const informative = lines.find(line => /MODULE_NOT_FOUND|Cannot find module|ERR_[A-Z_]+|Error:/u.test(line))
    || lines[lines.length - 1]
    || '';
  return informative.slice(0, 200);
}

// 常见失败翻成人话：用户看得到「怎么办」，而不是一串报错。
export function describeExit(code, detail) {
  if (/MODULE_NOT_FOUND|Cannot find module|ERR_MODULE_NOT_FOUND/u.test(detail)) {
    return 'WorkBuddy 的命令行组件不完整（安装目录里少了启动产物）。重装一次 WorkBuddy 桌面版就能修好，也可以先改用免费在线 AI。';
  }
  if (/EACCES|EPERM/u.test(detail)) {
    return '没有权限启动 WorkBuddy 命令行。请把 WorkBuddy 装在默认目录，或以同一账号运行。';
  }
  return `WorkBuddy 没能启动（退出码 ${code}）。${detail ? `原因：${detail}` : ''}`;
}

export function createWorkbuddyGateway(options = {}) {
  const {
    findCli,
    resolveLaunch,
    buildEnv = () => ({ ...process.env }),
    spawnImpl = spawn,
    fetchImpl = (...args) => fetch(...args),
    bootTimeout = DEFAULT_BOOT_TIMEOUT,
    idleTimeout = DEFAULT_IDLE_TIMEOUT,
    cwd = process.cwd(),
  } = options;

  let session = null;
  let starting = null;
  let idleTimer = null;
  let lastBanner = '';

  function clearIdle() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function touch() {
    clearIdle();
    if (idleTimeout > 0) {
      idleTimer = setTimeout(stop, idleTimeout);
      idleTimer.unref?.();
    }
  }

  function stop() {
    clearIdle();
    const active = session;
    session = null;
    if (!active) return;
    try { active.child.kill(); } catch { /* 进程可能已经退出。 */ }
  }

  function start() {
    return new Promise((resolve, reject) => {
      Promise.resolve(findCli())
        .then(async file => {
          if (!file) {
            throw new GatewayError('这台电脑上没有找到 WorkBuddy。请先安装 WorkBuddy 桌面版，或者改用在线 AI。', { code: 'missing' });
          }
          const launch = await resolveLaunch(file);
          const child = spawnImpl(launch.command, [...launch.args, '--serve', '--port', '0'], {
            cwd,
            env: buildEnv(),
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
          });
          lastBanner = '';
          let settled = false;
          // 启动超时的定时器不要 unref：它一旦被解除引用，事件循环空闲时 Promise 会永远挂着。
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { child.kill(); } catch { /* 忽略。 */ }
            reject(new GatewayError('WorkBuddy 启动超时了，请稍后重试。', { code: 'timeout' }));
          }, bootTimeout);

          const finish = () => {
            settled = true;
            clearTimeout(timer);
          };

          const onData = chunk => {
            lastBanner += chunk.toString();
            if (settled) return;
            const banner = parseGatewayBanner(lastBanner);
            if (!banner) return;
            finish();
            session = { child, port: banner.port, password: banner.password, file };
            child.once('exit', () => {
              if (session?.child === child) {
                clearIdle();
                session = null;
              }
            });
            touch();
            resolve(session);
          };

          child.stdout.on('data', onData);
          child.stderr.on('data', onData);
          child.once('error', error => {
            if (settled) return;
            finish();
            reject(new GatewayError(`无法启动 WorkBuddy：${error.message}`, { code: 'spawn' }));
          });
          child.once('exit', code => {
            if (settled) return;
            finish();
            const detail = summarizeFailure(lastBanner);
            reject(new GatewayError(describeExit(code, detail), { code: 'exit', detail }));
          });
        })
        .catch(reject);
    });
  }

  async function ensure() {
    if (session) {
      touch();
      return session;
    }
    if (!starting) {
      starting = start().finally(() => { starting = null; });
    }
    return starting;
  }

  async function request(pathname, { method = 'GET', body, timeout = 20000 } = {}) {
    const active = await ensure();
    const base = {
      Authorization: `Bearer ${active.password}`,
      [SECURITY_HEADER]: '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    };
    let headers = base;
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      timer.unref?.();
      try {
        const response = await fetchImpl(`http://127.0.0.1:${active.port}${pathname}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        const text = await response.text();
        let payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
        touch();
        if (!response.ok) {
          // 只对「缺少校验头」重试一次：把报错里点名的头补上再试，比自己猜头名靠谱。
          const missing = response.status === 403 ? missingHeaderName(text) : '';
          if (missing && attempt < 2 && headers[missing] !== '1') {
            headers = { ...headers, [missing]: '1' };
            continue;
          }
          const reason = describeBlocked(response.status, payload, text);
          throw new GatewayError(reason, { code: response.status === 401 ? 'unauthorized' : response.status === 403 ? 'blocked' : 'http', detail: reason });
        }
        return payload;
      } catch (error) {
        if (error instanceof GatewayError) throw error;
        if (error?.name === 'AbortError') throw new GatewayError('WorkBuddy 响应超时，请重试。', { code: 'timeout' });
        throw new GatewayError(`没能连上 WorkBuddy：${error.message}`, { code: 'network' });
      } finally {
        clearTimeout(timer);
      }
    }
  }

  // 账号状态：authenticated 为真表示这台电脑已经登录过，可以直接用。
  async function accountStatus() {
    const payload = unwrap(await request('/api/v1/auth/account/status'));
    const account = payload?.account || null;
    return {
      authenticated: Boolean(payload?.authenticated),
      account: account ? { userId: account.userId || '', name: account.name || account.nickname || account.email || '' } : null,
    };
  }

  // 关键的一步：让 CLI 自己发起登录，并把官方授权链接交回来。
  async function login() {
    const payload = unwrap(await request('/api/v1/auth/account/login', { method: 'POST', body: {}, timeout: 60000 }));
    const authUrl = payload?.authUrl || '';
    if (!authUrl) {
      throw new GatewayError(payload?.loginError ? `WorkBuddy 登录没能开始（${payload.loginError}），请重试。` : 'WorkBuddy 没有返回登录链接，请重试。', { code: 'no-url' });
    }
    return { authUrl, auth: Boolean(payload?.success) };
  }

  async function info() {
    return unwrap(await request('/api/v1/info', { timeout: 8000 }));
  }

  return {
    ensure,
    request,
    accountStatus,
    login,
    info,
    stop,
    get running() { return Boolean(session); },
    get port() { return session?.port || 0; },
  };
}
