import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { promises as fs, createWriteStream } from 'node:fs';
import { spawn as nodeSpawn, execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

// 一键本地 AI 管理器。只负责受控的 Ollama Windows x64 安装与生命周期，
// 不接受来自网页的 URL、路径、命令或模型名称。
const execFile = promisify(nodeExecFile);
const OLLAMA_VERSION = '0.34.2';
const OLLAMA_URL = `https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/ollama-windows-amd64.zip`;
const OLLAMA_SHA256 = '8f3fd071a2a2f9497b562f43502c77c2b701a99d1ee5dfda28da8c786373063b';
const OLLAMA_PORT = 11435;
const OLLAMA_HOST = `127.0.0.1:${OLLAMA_PORT}`;
const MODELS = Object.freeze({
  'qwen3.5:4b': Object.freeze({ modelSizeGB: 3.4, requiredDiskGB: 12, requiredMemoryGB: 12 }),
  'qwen2.5:7b': Object.freeze({ modelSizeGB: 4.7, requiredDiskGB: 8, requiredMemoryGB: 14 }),
  'qwen2.5:3b': Object.freeze({ modelSizeGB: 2.0, requiredDiskGB: 5, requiredMemoryGB: 8 })
});
const DEFAULT_MODEL = 'qwen3.5:4b';
const DOWNLOAD_SIZE = 1460928014;
const PHASES = new Set(['idle', 'checking', 'downloading', 'extracting', 'starting', 'pulling', 'verifying', 'ready', 'cancelled', 'error', 'unsupported']);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function asError(error, fallback = '本地 AI 操作失败。') {
  if (error?.name === 'AbortError') return new Error('本地 AI 操作已取消。');
  return error instanceof Error ? error : new Error(error?.message || fallback);
}
function safeModel(value) { return Object.hasOwn(MODELS, value) ? value : null; }
function q(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function combineSignals(first, second) {
  if (!first) return second;
  if (!second) return first;
  if (AbortSignal.any) return AbortSignal.any([first, second]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  first.addEventListener('abort', abort, { once: true });
  second.addEventListener('abort', abort, { once: true });
  return controller.signal;
}
async function* timedBody(body, timeoutMs, signal) {
  const iterator = body?.[Symbol.asyncIterator]?.();
  if (!iterator) throw new Error('本地 AI 下载没有返回可读取的数据流。');
  while (true) {
    throwIfSignal(signal);
    let timer;
    try {
      const next = iterator.next();
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('本地 AI 数据流响应超时。')), timeoutMs); });
      const item = await Promise.race([next, timeout]);
      if (item.done) return;
      yield item.value;
    } finally { clearTimeout(timer); }
  }
}
function throwIfSignal(signal) { if (signal?.aborted) throw Object.assign(new Error('本地 AI 操作已取消。'), { code: 'CANCELLED' }); }
function parseJsonContent(content) {
  const text = typeof content === 'string' ? content.trim() : '';
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(cleaned); } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('本地 AI 返回的 JSON 无法解析。');
  }
}

/** 解析 Ollama /api/pull 的一行 NDJSON，隐藏客户端无需调用。 */
export function parsePullLine(line) {
  const text = Buffer.isBuffer(line) ? line.toString('utf8') : String(line);
  if (!text.trim()) return null;
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('本地 AI 下载进度格式无效。'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('本地 AI 下载进度格式无效。');
  const total = Number(data.total);
  const completed = Number(data.completed);
  return {
    status: typeof data.status === 'string' ? data.status : '',
    total: Number.isFinite(total) && total >= 0 ? total : null,
    completed: Number.isFinite(completed) && completed >= 0 ? completed : null
  };
}

function createDefaultDeps(options, env) {
  return {
    fs: options.fs || fs,
    fetch: options.fetch || globalThis.fetch,
    spawn: options.spawn || nodeSpawn,
    execFile: options.execFile || execFile,
    createWriteStream: options.createWriteStream || createWriteStream,
    totalMemory: options.totalMemory || (() => os.totalmem()),
    now: options.now || (() => Date.now()),
    env
  };
}

export function createLocalAIManager(options = {}) {
  const env = options.env || process.env;
  const deps = createDefaultDeps(options, env);
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const defaultRoot = platform === 'win32'
    ? path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'JujinWritingStudio', 'local-ai')
    : path.join(os.tmpdir(), 'JujinWritingStudio', 'local-ai');
  const root = path.resolve(options.rootDir || env.IELTS_LOCAL_AI_DIR || defaultRoot);
  const downloadsDir = path.join(root, 'downloads');
  const installDir = path.join(root, 'ollama');
  const modelsDir = path.join(root, 'models');
  const tempDir = path.join(root, 'tmp');
  const archivePath = path.join(downloadsDir, `ollama-v${OLLAMA_VERSION}-windows-amd64.zip`);
  const statePath = path.join(root, 'state.json');
  const expectedSha256 = String(options.expectedSha256 || OLLAMA_SHA256).toLowerCase();
  const memoryBytes = Number(options.memoryBytes || deps.totalMemory());
  // 默认只推荐已验证的 4B 模型；低内存用户使用在线服务，不悄悄降级为未验证的小模型。
  let selectedModel = safeModel(options.model) || DEFAULT_MODEL;
  let profile = MODELS[selectedModel];
  const requestTimeoutMs = Math.max(3000, Number(options.requestTimeoutMs || 15000));
  const downloadTimeoutMs = Math.max(10000, Number(options.downloadTimeoutMs || 30 * 60 * 1000));
  const status = {
    supported: platform === 'win32' && arch === 'x64' && Boolean(deps.fetch),
    busy: false, phase: 'idle', message: '尚未安装本地 AI。', progress: null,
    downloadedBytes: 0, totalBytes: DOWNLOAD_SIZE, model: selectedModel,
    modelSizeGB: profile.modelSizeGB, memoryGB: Math.round((memoryBytes / 1024 ** 3) * 10) / 10,
    requiredDiskGB: profile.requiredDiskGB, requiredMemoryGB: profile.requiredMemoryGB,
    recommendedModel: DEFAULT_MODEL, updateAvailable: false
  };
  let operation = null;
  let ownedProcess = null;
  let executablePath = null;
  let disposed = false;

  function snapshot() { return clone(status); }
  function setStatus(values) {
    Object.assign(status, values);
    if (!PHASES.has(status.phase)) status.phase = 'error';
    if (status.progress !== null) status.progress = Math.max(0, Math.min(100, Math.round(status.progress)));
    return snapshot();
  }
  function throwIfCancelled(signal) { if (signal?.aborted) throw Object.assign(new Error('本地 AI 操作已取消。'), { code: 'CANCELLED' }); }
  async function ensureDirs() {
    await Promise.all([downloadsDir, installDir, modelsDir, tempDir].map(dir => deps.fs.mkdir(dir, { recursive: true })));
  }
  async function pathExists(file) { try { await deps.fs.access(file); return true; } catch { return false; } }
  async function diskCheck() {
    let free = null;
    if (typeof options.diskFreeBytes === 'function') {
      free = Number(await options.diskFreeBytes(root));
    } else if (typeof deps.fs.statfs === 'function') {
      const info = await deps.fs.statfs(root);
      free = Number(info.bavail ?? info.bfree) * Number(info.bsize);
    } else if (platform === 'win32') {
      // Windows Node 没有稳定的 statfs；用系统自带 PowerShell 查询根盘剩余空间。
      const drive = path.parse(root).root || 'C:\\';
      const script = `$d=Get-CimInstance Win32_LogicalDisk -Filter ${q(`DeviceID='${drive.replace(/\\+$/, '').replaceAll("'", "''")}'`)}; if($d){[Console]::Write($d.FreeSpace)}`;
      try { const result = await deps.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 5000 }); free = Number(String(result.stdout || '').trim()); } catch {}
    }
    // 无法查询时继续安装，让 Ollama 自己报告磁盘错误；可测试注入 diskFreeBytes 做硬性检查。
    return !Number.isFinite(free) || free >= profile.requiredDiskGB * 1024 ** 3;
  }
  async function sha256(file) {
    const hash = crypto.createHash('sha256');
    const stream = (await import('node:fs')).createReadStream(file);
    for await (const chunk of stream) hash.update(chunk);
    return hash.digest('hex');
  }
  async function locateExecutable(dir) {
    if (await pathExists(path.join(dir, 'ollama.exe'))) return path.join(dir, 'ollama.exe');
    async function walk(current, depth) {
      if (depth > 3) return null;
      let entries;
      try { entries = await deps.fs.readdir(current, { withFileTypes: true }); } catch { return null; }
      for (const entry of entries) {
        if (entry.name.toLowerCase() === 'ollama.exe' && entry.isFile()) return path.join(current, entry.name);
      }
      for (const entry of entries) {
        if (entry.isDirectory()) { const found = await walk(path.join(current, entry.name), depth + 1); if (found) return found; }
      }
      return null;
    }
    return walk(dir, 0);
  }
  async function request(url, init = {}, signal, timeout = requestTimeoutMs) {
    throwIfCancelled(signal);
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeout);
    try {
      const response = await deps.fetch(url, { ...init, signal: combineSignals(signal, timeoutController.signal) });
      return response;
    } catch (error) {
      if (signal?.aborted) throw Object.assign(new Error('本地 AI 操作已取消。'), { code: 'CANCELLED' });
      if (timeoutController.signal.aborted) throw new Error('本地 AI 服务响应超时。');
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function downloadArchive(signal) {
    await deps.fs.mkdir(downloadsDir, { recursive: true });
    if (typeof options.downloadArchive === 'function') {
      await options.downloadArchive({ url: OLLAMA_URL, destination: archivePath, expectedBytes: DOWNLOAD_SIZE, signal, onProgress: (completed, total) => {
        status.downloadedBytes = completed; status.totalBytes = total || status.totalBytes; status.progress = total ? completed / total * 100 : null;
      } });
      return;
    }
    let existing = 0;
    try { existing = (await deps.fs.stat(archivePath)).size; } catch {}
    let response = await request(OLLAMA_URL, { headers: existing ? { Range: `bytes=${existing}-` } : {} }, signal, downloadTimeoutMs);
    if (!response.ok && response.status !== 206) throw new Error(`Ollama 下载失败（HTTP ${response.status}）。`);
    if (existing && response.status === 200) { existing = 0; await deps.fs.rm(archivePath, { force: true }); }
    const totalHeader = Number(response.headers?.get?.('content-length')) || 0;
    const total = response.status === 206 ? existing + totalHeader : totalHeader || DOWNLOAD_SIZE;
    status.downloadedBytes = existing; status.totalBytes = total;
    if (!response.body) throw new Error('Ollama 下载没有返回数据流。');
    const output = deps.createWriteStream(archivePath, { flags: existing ? 'a' : 'w' });
    try {
      for await (const chunk of timedBody(response.body, downloadTimeoutMs, signal)) {
        throwIfCancelled(signal);
        await new Promise((resolve, reject) => { output.write(chunk, error => error ? reject(error) : resolve()); });
        status.downloadedBytes += chunk.length || chunk.byteLength || 0;
        status.progress = total ? status.downloadedBytes / total * 100 : null;
      }
      await new Promise((resolve, reject) => output.end(error => error ? reject(error) : resolve()));
    } catch (error) { output.destroy(); throw error; }
  }
  async function extractArchive(signal) {
    throwIfCancelled(signal);
    if (typeof options.extractArchive === 'function') { await options.extractArchive({ archive: archivePath, destination: installDir, signal }); return; }
    await deps.fs.rm(installDir, { recursive: true, force: true });
    await deps.fs.mkdir(installDir, { recursive: true });
    // PowerShell 是 Windows 自带的 ZIP 解压工具；路径通过单引号转义，不拼接用户输入命令。
    await deps.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -LiteralPath ${q(archivePath)} -DestinationPath ${q(installDir)} -Force`], { windowsHide: true, timeout: downloadTimeoutMs, signal });
  }
  function spawnServer() {
    if (ownedProcess && !ownedProcess.killed && ownedProcess.exitCode == null) return;
    if (!executablePath) throw new Error('Ollama 可执行文件不存在。');
    const child = deps.spawn(executablePath, ['serve'], { cwd: installDir, env: { ...env, OLLAMA_HOST, OLLAMA_MODELS: modelsDir }, stdio: 'ignore', windowsHide: true, detached: false });
    ownedProcess = child;
    child.once?.('error', () => {
      if (ownedProcess !== child) return;
      ownedProcess = null;
      if (!disposed && operation && !operation.signal.aborted) setStatus({ phase: 'error', busy: false, error: 'Ollama 启动失败。', message: 'Ollama 启动失败，请重试。' });
    });
    child.once?.('exit', (code, signal) => {
      if (ownedProcess !== child) return;
      ownedProcess = null;
      // 就绪后崩溃也必须撤销 ready，否则再次选择本地模式永远无法恢复进程。
      if (!disposed && operation && !operation.signal.aborted) setStatus({ phase: 'error', busy: false, error: `进程退出（${code ?? signal ?? 'unknown'}）。`, message: 'Ollama 进程意外退出，请重试。' });
    });
  }
  async function serverAvailable(signal) {
    try {
      const response = await request(`http://${OLLAMA_HOST}/api/tags`, {}, signal, 2500);
      if (!response.ok) return false;
      return Array.isArray((await response.json())?.models);
    } catch { throwIfCancelled(signal); return false; }
  }
  async function waitForServer(signal) {
    const deadline = Date.now() + Number(options.startTimeoutMs || 45000);
    while (Date.now() < deadline) {
      throwIfCancelled(signal);
      if (await serverAvailable(signal)) return;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    throw new Error('Ollama 启动超时，请重试。');
  }
  async function modelAvailable(signal) {
    const response = await request(`http://${OLLAMA_HOST}/api/tags`, {}, signal, 5000);
    if (!response.ok) return false;
    const data = await response.json();
    return Array.isArray(data?.models) && data.models.some(item => item?.name === selectedModel || item?.name === `${selectedModel}:latest`);
  }
  async function pullModel(signal) {
    const response = await request(`http://${OLLAMA_HOST}/api/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: selectedModel, stream: true }) }, signal, downloadTimeoutMs);
    if (!response.ok || !response.body) throw new Error(`模型下载失败（HTTP ${response.status}）。`);
    let buffer = '';
    for await (const chunk of timedBody(response.body, downloadTimeoutMs, signal)) {
      throwIfCancelled(signal);
      buffer += Buffer.from(chunk).toString('utf8');
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const event = parsePullLine(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
        if (!event) continue;
        if (event.total) { status.totalBytes = event.total; status.downloadedBytes = event.completed || 0; status.progress = status.downloadedBytes / event.total * 100; }
        status.message = event.status || '正在下载模型…';
      }
    }
    if (buffer.trim()) parsePullLine(buffer);
  }
  async function smokeTest(signal) {
    const body = { model: selectedModel, stream: false, format: 'json', options: { temperature: 0, num_predict:128 }, messages: [{ role: 'system', content: '只返回 JSON。' }, { role: 'user', content: '请返回 {"ok":true}。' }] };
    if (/^qwen3(?:[.:]|$)/i.test(selectedModel)) body.think = false;
    const response = await request(`http://${OLLAMA_HOST}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, signal, 60000);
    if (!response.ok) throw new Error(`本地 AI 检查失败（HTTP ${response.status}）。`);
    const data = await response.json();
    const content = data?.message?.content || data?.choices?.[0]?.message?.content;
    const parsed = parseJsonContent(content);
    if (parsed?.ok !== true) throw new Error('模型未通过连接检查，请重试。');
  }
  async function saveState() {
    await deps.fs.mkdir(root, { recursive: true });
    // 先原子保存完整安装记录，再对外报告 ready；避免恢复时读到半写入文件。
    const temporary = `${statePath}.${crypto.randomUUID()}.tmp`;
    try {
      await deps.fs.writeFile(temporary, JSON.stringify({ version: 1, model: selectedModel, executablePath, phase:'ready', ready:true }, null, 2), 'utf8');
      await deps.fs.rename(temporary, statePath);
    } finally { await deps.fs.rm(temporary, { force:true }).catch(() => {}); }
  }
  async function run(signal, restoreOnly = false) {
    try {
      if (!status.supported) { setStatus({ phase: 'unsupported', busy: false, message: '本地 AI 自动安装目前只支持 Windows 64 位。' }); return; }
      if (memoryBytes < profile.requiredMemoryGB * 1024 ** 3) { setStatus({ phase: 'unsupported', busy: false, message: `运行 ${selectedModel} 至少需要 ${profile.requiredMemoryGB} GiB 内存，建议使用 16 GB 以上且有独立显卡的电脑。当前请使用在线 AI。` }); return; }
      setStatus({ phase: 'checking', busy: true, error: undefined, message: '正在检查电脑环境…', progress: null });
      await ensureDirs();
      // 日常恢复复用已下载文件，不应再次要求预留整套模型的安装空间。
      if (!restoreOnly && !(await diskCheck())) throw new Error(`可用磁盘空间不足，需要至少 ${profile.requiredDiskGB} GB。`);
      executablePath = await locateExecutable(installDir);
      if (!executablePath) {
        if (restoreOnly) throw new Error('已保存的本地 AI 安装不完整，请重新安装。');
        setStatus({ phase: 'downloading', message: '正在下载 Ollama（可断点续传）…', progress: 0, downloadedBytes: 0, totalBytes: DOWNLOAD_SIZE });
        await downloadArchive(signal);
        throwIfCancelled(signal);
        const actual = await sha256(archivePath);
        if (actual !== expectedSha256) { await deps.fs.rm(archivePath, { force: true }); throw new Error('Ollama 下载校验失败，文件可能已损坏。'); }
        setStatus({ phase: 'extracting', message: '正在解压本地 AI…', progress: null });
        await extractArchive(signal);
        executablePath = await locateExecutable(installDir);
        if (!executablePath) throw new Error('Ollama 压缩包中没有找到可执行文件。');
      }
      setStatus({ phase: 'starting', message: '正在启动本地 AI…', progress: null });
      // 旧窗口可能已启动专用端口的 Ollama。复用有效服务，不再创建端口冲突进程，
      // 也不把其他窗口启动的进程当成自己拥有的进程，因此 close 不会终止它。
      if (!(await serverAvailable(signal))) {
        spawnServer();
        await waitForServer(signal);
      }
      if (!(await modelAvailable(signal))) {
        if (restoreOnly) throw new Error('本地 AI 模型尚未准备好，请点击安装完成首次下载。');
        setStatus({ phase: 'pulling', message: `正在准备 ${selectedModel} 模型…`, progress: 0, downloadedBytes: 0, totalBytes: null });
        await pullModel(signal);
      }
      setStatus({ phase: 'verifying', message: '正在进行本地 AI 检查…', progress: null });
      if (!(await modelAvailable(signal))) throw new Error('模型下载后仍不可用。');
      await smokeTest(signal);
      await saveState();
      throwIfCancelled(signal);
      setStatus({ phase: 'ready', busy: false, progress: 100, message: `本地 AI 已准备好（${selectedModel}）。`, error: undefined, updateAvailable: selectedModel !== DEFAULT_MODEL });
    } catch (error) {
      if (signal?.aborted || error?.code === 'CANCELLED') setStatus({ phase: 'cancelled', busy: false, message: '本地 AI 安装已取消。', error: undefined });
      else setStatus({ phase: 'error', busy: false, message: asError(error).message, error: asError(error).message });
    }
  }
  function start() {
    if (disposed) return snapshot();
    if (status.busy) return snapshot();
    // 只有用户主动点准备/更新时才下载推荐模型；自动 restore 继续使用原模型。
    selectedModel = safeModel(options.model) || DEFAULT_MODEL;
    profile = MODELS[selectedModel];
    setStatus({ model: selectedModel, modelSizeGB: profile.modelSizeGB, requiredDiskGB: profile.requiredDiskGB, requiredMemoryGB: profile.requiredMemoryGB, updateAvailable: false });
    operation = { controller: new AbortController() };
    operation.signal = operation.controller.signal;
    void run(operation.signal, false);
    return snapshot();
  }
  function cancel() {
    if (operation && status.busy) {
      operation.controller.abort();
      // 立即反馈取消，后台任务随后会安全收尾，不让界面停留在 busy。
      setStatus({ phase: 'cancelled', busy: false, message: '本地 AI 安装已取消。', error: undefined });
    }
    else if (status.phase !== 'ready') setStatus({ phase: 'cancelled', busy: false, message: '本地 AI 安装已取消。' });
    return snapshot();
  }
  async function restore() {
    if (disposed || status.busy || status.phase === 'ready' || !status.supported) return snapshot();
    operation = { controller: new AbortController() };
    operation.signal = operation.controller.signal;
    const signal = operation.signal;
    setStatus({ phase: 'checking', busy: true, error: undefined, message: '正在查找已准备的本地 AI…', progress: null });
    try {
      let saved;
      try { saved = JSON.parse(await deps.fs.readFile(statePath, 'utf8')); }
      catch (error) {
        if (error.code === 'ENOENT') {
          // 首次启动只展示选择，不创建下载目录、不联网、不启动其他程序。
          setStatus({ phase: 'idle', busy: false, message: '尚未安装本地 AI。' });
          return snapshot();
        }
        throw new Error('已保存的本地 AI 状态无法读取，请点击准备本地 AI 重新检查。');
      }
      throwIfCancelled(signal);
      if (!saved || saved.version !== 1 || saved.ready !== true) {
        setStatus({ phase: 'idle', busy: false, message: '本地 AI 尚未完成准备，请点击准备本地 AI 继续。' });
        return snapshot();
      }
      const installedModel = safeModel(saved.model);
      if (!installedModel) throw new Error('已保存的本地模型不受支持，请点击准备本地 AI 重新检查。');
      // 只信任程序自己的固定安装目录，不执行状态文件里记录的任意路径。
      executablePath = await locateExecutable(installDir);
      if (!executablePath) throw new Error('已保存的本地 AI 安装不完整，请点击准备本地 AI 修复。');
      throwIfCancelled(signal);
      selectedModel = installedModel;
      profile = MODELS[selectedModel];
      setStatus({ model: selectedModel, modelSizeGB: profile.modelSizeGB, requiredDiskGB: profile.requiredDiskGB, requiredMemoryGB: profile.requiredMemoryGB, updateAvailable: selectedModel !== DEFAULT_MODEL });
      await run(signal, true);
    } catch (error) {
      if (signal.aborted || error?.code === 'CANCELLED') setStatus({ phase: 'cancelled', busy: false, message: '本地 AI 恢复已取消。', error: undefined });
      else setStatus({ phase: 'error', busy: false, message: asError(error).message, error: asError(error).message });
    }
    return snapshot();
  }
  function getStatus() { return Promise.resolve(snapshot()); }
  function getProviderConfig() { return status.phase === 'ready' ? { url: `http://${OLLAMA_HOST}`, model: selectedModel } : null; }
  async function close() {
    disposed = true;
    if (operation) operation.controller.abort();
    if (ownedProcess && !ownedProcess.killed) {
      try { ownedProcess.kill(); } catch {}
    }
    ownedProcess = null;
    return snapshot();
  }
  return Object.freeze({ getStatus, start, cancel, restore, getProviderConfig, close });
}

export const LOCAL_AI_CONSTANTS = Object.freeze({ OLLAMA_VERSION, OLLAMA_URL, OLLAMA_SHA256, OLLAMA_HOST, DOWNLOAD_SIZE, MODELS });
