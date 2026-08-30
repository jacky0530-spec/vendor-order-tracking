(() => {
  'use strict';

  // Keep the admin tracking "重新整理" action identical to a browser refresh.
  // Use capture phase so the legacy loadAdmin() click handler does not redraw the
  // base table before the item-shipping / cross-order patches are reapplied.
  const bindFullReload = () => {
    const button = document.getElementById('reloadBtn');
    if (!button || button.dataset.fullReloadBound === '1') return;
    button.dataset.fullReloadBound = '1';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.reload();
    }, true);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindFullReload, { once: true });
  } else {
    bindFullReload();
  }
})();
