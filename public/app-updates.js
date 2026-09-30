// 更新只在用户点击时检查；不自动下载，也不打断正在进行的批改。
export function initAppUpdates({isBusy, saveDraft}) {
  const dialog = document.querySelector('#update-dialog');
  const message = document.querySelector('#update-message');
  const install = document.querySelector('#update-install');
  const close = document.querySelector('#update-close');
  let active = false;
  async function request(url, method='GET') {
    const response = await fetch(url, {method, ...(method==='POST' ? {headers:{'Content-Type':'application/json'},body:'{}'} : {})});
    const result = await response.json(); if (!response.ok) throw new Error(result.error || '更新请求失败'); return result;
  }
  document.querySelector('#update-check').addEventListener('click', async () => {
    dialog.showModal(); if (active) return;
    install.hidden = true; message.textContent = '正在检查 GitHub 最新版本…';
    try {
      const info = await request('/api/updates');
      message.textContent = info.available ? `当前 v${info.version}，发现新版 v${info.latestVersion}。${info.canInstall ? '点击下方按钮后会下载、验证安装包并重启程序，草稿和历史保留。' : '此版本请从发行页下载对应系统的新包；Windows 安装版支持应用内更新。'}` : `当前 v${info.version}，已是最新正式版本。`;
      install.hidden = !info.available || !info.canInstall;
    } catch(error) { message.textContent = error.message; }
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (active) event.preventDefault(); });
  install.addEventListener('click', async () => {
    if (active) return;
    if (isBusy()) { message.textContent = '请先完成批改或 AI 准备，再安装更新。'; return; }
    saveDraft(); active = true; install.disabled = true; close.disabled = true;
    message.textContent = '正在下载并验证安装包，请稍候。网络较慢时可能需要几分钟…';
    try {
      const result = await request('/api/updates/install','POST');
      message.textContent = `安装 v${result.version} 中，程序将自动重启。请保留本页面，完成后自动刷新。`;
      const started = Date.now();
      const timer = setInterval(async () => {
        try { const info = await request('/api/app-info'); if (info.version === result.version) { clearInterval(timer); location.reload(); return; } } catch { /* 重启时暂时不可连接。 */ }
        if (Date.now() - started > 180000) { clearInterval(timer); active=false; close.disabled=false; message.textContent='更新仍未连接。请尝试桌面快捷方式；如安装失败，可从发行页重新下载安装。'; }
      }, 2500);
    } catch(error) { active=false; install.disabled=false; close.disabled=false; message.textContent=error.message; }
  });
}
