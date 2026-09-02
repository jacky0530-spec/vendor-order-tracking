(() => {
  'use strict';

  // 只有真人點擊「重新整理」才做整頁刷新。
  // 程式內部為同步員工畫面而觸發的 .click() 必須在 capture 階段直接攔截，
  // 否則事件還會繼續傳到 app.js 裡的 location.reload()，形成無限重載。
  const bindFullReload = () => {
    const button = document.getElementById('reloadBtn');
    if (!button || button.dataset.fullReloadBound === '1') return;
    button.dataset.fullReloadBound = '1';
    button.addEventListener('click', (event) => {
      if (!event.isTrusted) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
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
