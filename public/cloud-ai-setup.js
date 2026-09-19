// 在线 AI 配置只在本机服务端保存；页面不把密钥写入浏览器存储。
export function initCloudAiSetup(options = {}) {
  const byId = id => document.getElementById(id);
  const dialog = byId('cloud-ai-dialog');
  if (!dialog) return { open: async () => {}, refresh: async () => null, updateControls: () => {} };
  const openButton = byId('cloud-ai-open');
  const form = byId('cloud-ai-form');
  const fields = byId('cloud-ai-fields');
  const providerInput = byId('cloud-provider');
  const keyInput = byId('cloud-api-key');
  const baseInput = byId('cloud-base-url');
  const modelInput = byId('cloud-model');
  const consentInput = byId('cloud-consent');
  const feedback = byId('cloud-ai-feedback');
  const saveButton = byId('cloud-ai-save');
  const clearButton = byId('cloud-ai-clear');
  let config = null;
  let busy = false;
  let loading = false;
  let requestController = null;
  let lastFocused = null;
  let sessionId = 0;

  function setFeedback(message = '', isError = false) {
    feedback.textContent = message;
    feedback.classList.toggle('hidden', !message);
    feedback.classList.toggle('is-error', isError);
    feedback.setAttribute('role', isError ? 'alert' : 'status');
  }
  function updateControls() {
    const appBusy = Boolean(options.isBusy?.());
    openButton.disabled = appBusy || busy;
    fields.disabled = appBusy || busy || loading;
    saveButton.disabled = appBusy || busy || loading || !config;
    clearButton.disabled = appBusy || busy || loading;
    saveButton.textContent = busy ? '正在连接测试…' : '连接并使用';
    clearButton.classList.toggle('hidden', !config?.configured && !config?.keyConfigured);
    if (config?.configured) {
      const label = config.providers?.find(item => item.id === config.provider)?.label || '自定义服务';
      byId('cloud-ai-summary').textContent = `已保存 ${label} · ${config.model}。在线批改不需要下载模型，使用你的服务商账户额度；可在设置中切换服务或删除连接。`;
      openButton.textContent = '管理在线 AI ↗';
    } else {
      byId('cloud-ai-summary').textContent = '不用下载模型。选择服务商，粘贴一次自己的 API 密钥，即可联网批改。免费额度与收费以服务商当前规则为准。';
      openButton.textContent = '设置在线 AI ↗';
    }
  }
  function setBusy(value) { busy = value; options.onBusyChange?.(value); updateControls(); }
  function sameSavedService() { return Boolean(config?.keyConfigured && config.provider === providerInput.value && config.baseUrl === baseInput.value.trim().replace(/\/+$/, '')); }
  function isLocalCustomService() {
    if (providerInput.value !== 'custom') return false;
    try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseInput.value.trim()).hostname); }
    catch { return false; }
  }
  function updateKeyHint() {
    keyInput.placeholder = sameSavedService() ? '已保存密钥；留空继续使用，输入可替换' : isLocalCustomService() ? '本机兼容服务可留空' : '粘贴服务商提供的 API Key';
    keyInput.required = !sameSavedService() && !isLocalCustomService();
  }
  function showProvider(useSaved = false) {
    const preset = config?.providers?.find(item => item.id === providerInput.value);
    const custom = providerInput.value === 'custom';
    baseInput.value = useSaved ? config.baseUrl || '' : preset?.baseUrl || '';
    modelInput.value = useSaved ? config.model || '' : preset?.model || '';
    baseInput.readOnly = !custom;
    byId('cloud-advanced').open = custom;
    byId('cloud-provider-pricing').textContent = preset?.pricingNote || '费用、额度与可用模型由你选择的服务商决定。软件不提供共享 API 密钥或无限免费额度。';
    const link = byId('cloud-provider-signup');
    let signupUrl = null;
    try { const url = new URL(preset?.signupUrl); if (url.protocol === 'https:') signupUrl = url.href; } catch { /* 自定义服务不提供注册链接。 */ }
    link.classList.toggle('hidden', !signupUrl);
    link.href = signupUrl || '#';
    keyInput.value = '';
    consentInput.checked = false;
    updateKeyHint();
  }
  function renderConfig(result) {
    config = result;
    const presets = Array.isArray(config.providers) ? config.providers : [];
    providerInput.replaceChildren();
    for (const preset of presets) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      providerInput.append(option);
    }
    if (!presets.some(item => item.id === 'custom')) {
      const option = document.createElement('option'); option.value = 'custom'; option.textContent = '其他兼容服务（自定义）'; providerInput.append(option);
    }
    providerInput.value = presets.some(item => item.id === config.provider) || config.provider === 'custom' ? config.provider : presets[0]?.id || 'custom';
    showProvider(Boolean(config.configured || config.keyConfigured));
    updateControls();
  }
  async function request(method = 'GET', data, signal) {
    const response = await fetch('/api/cloud-settings', {
      method, signal: signal || AbortSignal.timeout(12000),
      ...(data !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}),
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('无法读取服务响应，请确认应用已更新并重启。'); }
    if (!response.ok) throw new Error(result.error || result.message || `连接失败（${response.status}）。`);
    return result;
  }
  async function refresh() {
    const result = await request();
    // 后台刷新只更新摘要，避免覆盖正在输入的密钥和设置。
    config = result;
    updateControls();
    return result;
  }
  async function open() {
    if (options.isBusy?.() || busy) return;
    lastFocused = document.activeElement;
    const currentSession = ++sessionId;
    setFeedback('正在读取设置…');
    loading = true; updateControls();
    dialog.showModal();
    try {
      const result = await request();
      if (!dialog.open || currentSession !== sessionId) return;
      renderConfig(result); setFeedback();
    } catch (error) {
      if (dialog.open && currentSession === sessionId) setFeedback(error.message || '读取设置失败，请关闭后重试。', true);
    } finally { loading = false; updateControls(); }
  }
  function close() { if (dialog.open) dialog.close(); }
  openButton.addEventListener('click', open);
  byId('cloud-ai-close').addEventListener('click', close);
  byId('cloud-ai-cancel').addEventListener('click', close);
  dialog.addEventListener('close', () => {
    sessionId += 1;
    keyInput.value = '';
    consentInput.checked = false;
    requestController?.abort();
    if (lastFocused?.isConnected) lastFocused.focus();
  });
  providerInput.addEventListener('change', () => { showProvider(); setFeedback(); });
  baseInput.addEventListener('input', updateKeyHint);
  form.addEventListener('invalid', event => {
    if (keyInput.validity.valueMissing || event.target === keyInput) setFeedback('请先从服务商网站获取 API 密钥，再粘贴到这里。', true);
    else if (event.target === consentInput) setFeedback('请先确认作文发送与账户额度说明，再连接服务。', true);
    else {
      byId('cloud-advanced').open = true;
      setFeedback('请检查模型名称和 API 地址是否填写完整、格式是否正确。', true);
    }
  }, true);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || loading || options.isBusy?.() || !form.reportValidity()) return;
    const data = { provider: providerInput.value, baseUrl: baseInput.value.trim(), model: modelInput.value.trim(), remember: true };
    if (keyInput.value.trim()) data.apiKey = keyInput.value.trim();
    requestController = new AbortController();
    const timeout = setTimeout(() => requestController?.abort('timeout'), 90000);
    setBusy(true); setFeedback('正在发送简短测试请求，不会发送你的作文。验证成功后保存并切换在线 AI…');
    try {
      const result = await request('POST', data, requestController.signal);
      config = result;
      keyInput.value = '';
      await options.onConnected?.(result);
      close();
    } catch (error) {
      if (dialog.open) setFeedback(requestController?.signal.aborted ? '连接测试等待超时，请检查网络、服务商账户额度和模型名称后重试。' : error.message, true);
      // 用户关闭或网络超时时，服务端可能已经保存，重新读取最终状态。
      if (requestController?.signal.aborted) {
        try { await refresh(); await options.onRefresh?.(); } catch { /* 下次打开设置时可以重新读取。 */ }
      }
    } finally {
      clearTimeout(timeout); requestController = null; setBusy(false);
    }
  });
  clearButton.addEventListener('click', async () => {
    if (busy || loading || options.isBusy?.()) return;
    setBusy(true); setFeedback('正在删除本机保存的连接…');
    try {
      const result = await request('DELETE', {});
      renderConfig(result); await options.onCleared?.();
      setFeedback('已删除本机保存的在线 AI 连接。作文和练习记录没有改变。');
    } catch (error) { setFeedback(error.message, true); }
    finally { setBusy(false); }
  });
  refresh().catch(() => { /* 启动时不打断写作；打开设置时显示具体错误。 */ });
  updateControls();
  return { open, refresh, updateControls, getConfig: () => config };
}
