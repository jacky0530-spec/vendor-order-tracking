(() => {
  'use strict';

  // 重要：reloadBtn 在這支腳本執行時已經存在，所以立即綁定。
  // 不等待 DOMContentLoaded，避免 accounts.js 的員工初始化先觸發
  // reloadBtn.click() 而落入 app.js 的 location.reload() 迴圈。
  const bindFullReload = () => {
    const button = document.getElementById('reloadBtn');
    if (!button || button.dataset.fullReloadBound === '1') return false;
    button.dataset.fullReloadBound = '1';
    button.addEventListener('click', (event) => {
      // 程式自動 .click()：完全攔截，不重新載入。
      if (!event.isTrusted) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
      // 真人點擊：保留整頁刷新行為。
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.location.reload();
    }, true);
    return true;
  };

  // HTML 位於腳本之前，通常可立即成功；若特殊情況不存在才備援。
  if (!bindFullReload()) {
    document.addEventListener('DOMContentLoaded', bindFullReload, { once:true });
  }
})();
