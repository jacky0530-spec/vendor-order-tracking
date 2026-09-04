(() => {
  'use strict';

  function stripBuyer(card) {
    if (!card) return;

    // Header: 訂購日 YYYY-MM-DD　訂貨人 XXX -> 訂購日 YYYY-MM-DD
    const headMeta = card.querySelector('.vendor-order-head .muted');
    if (headMeta && /訂貨人/.test(headMeta.textContent || '')) {
      const text = (headMeta.textContent || '').replace(/[\s　]+訂貨人[\s　]+.*$/, '').trim();
      if (headMeta.textContent !== text) headMeta.textContent = text;
    }

    // Footer: 訂貨人：<b>XXX</b>　收貨人：... -> 收貨人：...
    const meta = card.querySelector('.vendor-meta');
    if (meta && /訂貨人/.test(meta.textContent || '')) {
      const html = meta.innerHTML.replace(/^\s*訂貨人：\s*<b>.*?<\/b>\s*[　\s]*/, '');
      if (meta.innerHTML !== html) meta.innerHTML = html;
    }
  }

  function scan() {
    const root = document.getElementById('vendorOrders');
    if (!root) return;
    root.querySelectorAll('.vendor-order').forEach(stripBuyer);
  }

  function install() {
    const root = document.getElementById('vendorOrders');
    if (!root) return;
    scan();

    if (!root.dataset.hideBuyerObserved) {
      root.dataset.hideBuyerObserved = '1';
      let timer = 0;
      new MutationObserver(mutations => {
        if (!mutations.some(m => m.addedNodes?.length || m.removedNodes?.length)) return;
        clearTimeout(timer);
        timer = setTimeout(scan, 40);
      }).observe(root, { childList: true, subtree: true });
    }

    document.getElementById('vendorReloadBtn')?.addEventListener('click', () => {
      setTimeout(scan, 250);
      setTimeout(scan, 700);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
