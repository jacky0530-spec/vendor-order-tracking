(() => {
  'use strict';

  // 真人點擊「重新整理」才做整頁刷新。
  // 程式內部為同步員工畫面而觸發的 .click() 不應重新載入，
  // 否則 loadAdmin() 剛取得資料就會被頁面刷新中斷，造成統計 0、訂單空白。
  const bindFullReload = () => {
    const button = document.getElementById('reloadBtn');
    if (!button || button.dataset.fullReloadBound === '1') return;
    button.dataset.fullReloadBound = '1';
    button.addEventListener('click', (event) => {
      if (!event.isTrusted) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.reload();
    }, true);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindFullReload, { once:true });
  } else {
    bindFullReload();
  }
})();
