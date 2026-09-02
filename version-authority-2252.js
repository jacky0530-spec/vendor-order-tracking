(() => {
  'use strict';

  const VERSION = 'V2.25';
  window.APP_VERSION = VERSION;

  function applyVersion() {
    document.querySelectorAll('.system-version-chip').forEach(el => {
      const want = `系統版本 ${VERSION}`;
      if (el.textContent !== want) el.textContent = want;
    });
    const footer = document.querySelector('footer');
    if (footer) {
      const want = `Vendor Order Tracking ${VERSION}`;
      if (footer.textContent !== want) footer.textContent = want;
    }
  }

  let correcting = false;
  function scheduleApply() {
    if (correcting) return;
    correcting = true;
    queueMicrotask(() => {
      correcting = false;
      applyVersion();
    });
  }

  applyVersion();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyVersion, { once: true });
  }

  const root = document.documentElement;
  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.type === 'characterData' || m.type === 'childList') {
        scheduleApply();
        break;
      }
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true });
})();
