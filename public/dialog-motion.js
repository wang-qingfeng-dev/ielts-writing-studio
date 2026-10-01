// 统一处理从触发按钮展开、回到触发按钮收起的弹性弹窗动画。
function originFrom(dialog, trigger) {
  if (!trigger) return;
  const source = trigger.getBoundingClientRect();
  const target = dialog.getBoundingClientRect();
  dialog.style.setProperty('--dialog-origin-x', `${Math.max(0, source.left + source.width / 2 - target.left)}px`);
  dialog.style.setProperty('--dialog-origin-y', `${Math.max(0, source.top + source.height / 2 - target.top)}px`);
}

export function showAnchoredDialog(dialog, trigger) {
  if (!dialog || dialog.open) return;
  dialog.showModal();
  originFrom(dialog, trigger);
  dialog.classList.remove('is-closing');
  requestAnimationFrame(() => dialog.classList.add('is-visible'));
}

export function closeAnchoredDialog(dialog, afterClose) {
  if (!dialog?.open || dialog.classList.contains('is-closing')) return;
  dialog.classList.remove('is-visible');
  dialog.classList.add('is-closing');
  const finish = () => {
    dialog.classList.remove('is-closing');
    if (dialog.open) dialog.close();
    afterClose?.();
  };
  window.setTimeout(finish, 270);
}
