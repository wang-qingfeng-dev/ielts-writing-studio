/**
 * 小白模式的本地 AI 准备卡片。
 *
 * 这里仅负责展示服务端准备进度和调用安装接口；模型下载、解压和启动由后端完成。
 * 通过回调与主应用协作，避免重复维护作文状态或全局锁。
 */

const PHASE_LABELS = {
  idle: '尚未准备',
  checking: '正在检查电脑环境…',
  downloading: '正在下载模型…',
  extracting: '正在解压模型…',
  starting: '正在启动本地服务…',
  pulling: '正在准备模型…',
  verifying: '正在验证本地 AI…',
  ready: '本地 AI 已准备好',
  cancelled: '已取消准备',
  error: '准备失败',
  unsupported: '当前系统暂不支持',
};

const TERMINAL_PHASES = new Set(['ready', 'cancelled', 'error', 'unsupported', 'idle']);
const BUSY_PHASES = new Set(['checking', 'downloading', 'extracting', 'starting', 'pulling', 'verifying']);
const API_TIMEOUT = 12000;

function byId(id) { return document.getElementById(id); }

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let number = bytes;
  let index = 0;
  while (number >= 1024 && index < units.length - 1) { number /= 1024; index += 1; }
  const digits = index >= 2 ? 2 : index === 1 ? 1 : 0;
  return `${number.toFixed(digits)} ${units[index]}`;
}

function formatSizeGB(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? `${number.toFixed(number >= 10 ? 0 : 1)} GB` : '';
}

function normalizeStatus(payload = {}) {
  const phase = String(payload.phase || (payload.supported === false ? 'unsupported' : 'idle')).toLowerCase();
  return {
    supported: payload.supported !== false,
    busy: Boolean(payload.busy) || BUSY_PHASES.has(phase),
    phase: PHASE_LABELS[phase] ? phase : 'idle',
    message: typeof payload.message === 'string' ? payload.message : '',
    progress: Number.isFinite(Number(payload.progress)) ? Math.max(0, Math.min(100, Number(payload.progress))) : null,
    downloadedBytes: Number(payload.downloadedBytes) || 0,
    totalBytes: Number(payload.totalBytes) || 0,
    model: typeof payload.model === 'string' ? payload.model : '',
    modelSizeGB: Number(payload.modelSizeGB) || 0,
    memoryGB: Number(payload.memoryGB) || 0,
    requiredDiskGB: Number(payload.requiredDiskGB) || 0,
    error: typeof payload.error === 'string' ? payload.error : '',
  };
}

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, signal: options.signal || AbortSignal.timeout(API_TIMEOUT) });
  let body = {};
  try { body = await response.json(); } catch { /* 服务器可能只返回状态码 */ }
  if (!response.ok) {
    const error = new Error(body.error || body.message || `请求失败（${response.status}）`);
    error.status = response.status;
    error.payload = body;
    throw error;
  }
  return body;
}

/**
 * 初始化“一键准备本地 AI”卡片。
 * @param {{isAnalyzing?:()=>boolean,onStateChange?:(state:object)=>void,onReady?:()=>void}} options
 */
export function initLocalAiSetup(options = {}) {
  const card = byId('local-ai-setup');
  if (!card) return { refresh: async () => null };

  const startButton = byId('local-ai-setup-start');
  const cancelButton = byId('local-ai-setup-cancel');
  const readyButton = byId('local-ai-setup-ready');
  const retryButton = byId('local-ai-setup-retry');
  const messageNode = byId('local-ai-setup-message');
  const phaseNode = byId('local-ai-setup-phase');
  const percentNode = byId('local-ai-setup-percent');
  const progressBar = byId('local-ai-setup-progress-bar');
  const bytesNode = byId('local-ai-setup-bytes');
  const modelNode = byId('local-ai-setup-model');
  const errorNode = byId('local-ai-setup-error');
  let current = normalizeStatus();
  let pollTimer = null;
  let fetching = false;
  let preparing = false;
  let cancelRequested = false;
  let autoStarted = false;

  function emit() { options.onStateChange?.({...current}); }
  function updateButtons() {
    const appBusy = Boolean(options.isAnalyzing?.());
    const localBusy = preparing || current.busy;
    startButton.disabled = appBusy || localBusy || !current.supported;
    retryButton.disabled = appBusy || localBusy;
    readyButton.disabled = appBusy;
    cancelButton.disabled = appBusy || cancelRequested;
    startButton.classList.toggle('hidden', localBusy || current.phase === 'ready');
    retryButton.classList.toggle('hidden', localBusy || !['error', 'cancelled'].includes(current.phase));
    cancelButton.classList.toggle('hidden', !localBusy);
    readyButton.classList.toggle('hidden', current.phase !== 'ready');
  }
  function render(next) {
    current = normalizeStatus(next);
    const visible = current.supported || current.phase === 'unsupported' || current.error;
    card.classList.toggle('hidden', !visible);
    card.classList.toggle('is-busy', current.busy || preparing);
    card.classList.toggle('is-ready', current.phase === 'ready');
    card.classList.toggle('has-error', current.phase === 'error' || Boolean(current.error));
    phaseNode.textContent = PHASE_LABELS[current.phase] || current.phase;
    const progress = current.progress;
    percentNode.textContent = progress === null ? '—' : `${Math.round(progress)}%`;
    progressBar.style.width = `${progress === null ? 0 : progress}%`;
    progressBar.parentElement.classList.toggle('is-indeterminate', current.busy && progress === null);
    const downloaded = formatBytes(current.downloadedBytes);
    const total = formatBytes(current.totalBytes);
    bytesNode.textContent = downloaded ? `已下载 ${downloaded}${total ? ` / ${total}` : ''}` : '';
    const modelSize = formatSizeGB(current.modelSizeGB);
    const memory = formatSizeGB(current.memoryGB);
    const disk = formatSizeGB(current.requiredDiskGB);
    const requirements = [modelSize && `模型约 ${modelSize}`, memory && `建议内存 ${memory}`, disk && `需要磁盘 ${disk}`].filter(Boolean);
    modelNode.textContent = [current.model && `模型：${current.model}`, ...requirements].join(' · ');
    const defaultMessage = current.phase === 'unsupported'
      ? '当前系统暂不支持自动准备本地 AI。你仍可使用高级设置中的兼容 API。'
      : current.phase === 'ready'
        ? '准备完成。之后可以离线使用本地 AI；模型效果取决于你的电脑配置。'
        : '点击后会自动检查并准备本机 AI。首次需要联网下载几个 GB，完成后可以离线使用。';
    messageNode.textContent = current.message || defaultMessage;
    const error = current.error || (current.phase === 'error' ? current.message : '');
    errorNode.textContent = error ? `没有完成准备：${error}` : '';
    errorNode.classList.toggle('hidden', !error);
    updateButtons();
    emit();
  }
  async function readStatus() {
    if (fetching) return current;
    fetching = true;
    try { render(await request('/api/local-ai/status')); }
    catch (error) {
      render({ ...current, supported: true, phase: 'error', error: error.message || '无法读取本地 AI 状态，请重试。', message: '暂时无法连接本地 AI 准备服务。' });
    } finally { fetching = false; }
    return current;
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      const status = await readStatus();
      if (!status.busy && (!preparing || cancelRequested || TERMINAL_PHASES.has(status.phase))) {
        if (cancelRequested || status.phase === 'cancelled' || status.phase === 'error' || status.phase === 'unsupported') {
          preparing = false; cancelRequested = false; updateButtons();
        }
        if (status.phase === 'ready') {
          preparing = false; cancelRequested = false; updateButtons();
          options.onReady?.();
        }
        if (!preparing) stopPolling();
      }
    }, 2000);
  }
  async function start() {
    if (preparing || current.busy || options.isAnalyzing?.() || !current.supported) return;
    preparing = true; cancelRequested = false; render({...current, phase:'checking', busy:true, message:'正在检查电脑环境…', error:''}); startPolling();
    try {
      render(await request('/api/local-ai/start', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'}));
      startPolling();
    } catch (error) {
      const payload = error.payload || {};
      render({...current, phase:'error', busy:false, error: error.status === 409 ? '正在进行其他 AI 操作，请稍候再试。' : (payload.error || error.message), message:'本地 AI 准备没有启动。'});
      preparing = false; cancelRequested = false; stopPolling();
    }
  }
  async function cancel() {
    if ((!preparing && !current.busy) || cancelRequested) return;
    cancelRequested = true;
    render({...current, busy:true, message:'正在取消准备，请稍候…'});
    try { render(await request('/api/local-ai/cancel', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'})); }
    catch (error) { render({...current, busy:true, message:'取消请求未完成，正在等待服务端状态…', error:error.message}); }
    startPolling();
  }
  function ready() {
    card.classList.add('hidden');
    options.onReady?.();
    document.getElementById('prompt-input')?.focus();
  }
  card.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.action === 'prepare-local-ai' || button.dataset.action === 'retry-local-ai') start();
    if (button.dataset.action === 'cancel-local-ai') cancel();
    if (button.dataset.action === 'start-writing') ready();
  });

  render(current);
  const refresh = async () => {
    const status = await readStatus();
    if (status.busy) { preparing = true; startPolling(); }
    // 已经准备过的用户再次打开应用时，也恢复本地 Ollama 选择；这不会触发下载。
    if (status.phase === 'ready') options.onReady?.();
    const setupRequested = new URLSearchParams(location.search).get('setup') === '1';
    if (setupRequested && !autoStarted && status.supported && ['idle', 'cancelled', 'error'].includes(status.phase)) {
      autoStarted = true;
      await start();
    }
    return current;
  };
  refresh();
  return { refresh, start, cancel, getState: () => ({...current}) };
}
