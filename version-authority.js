(() => {
  'use strict';

  const VERSION = 'V2.26';
  try { window.APP_VERSION = VERSION; } catch {}

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

  applyVersion();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyVersion, { once: true });
  }
  // Finite corrections only. Do not observe the entire DOM forever.
  setTimeout(applyVersion, 300);
  setTimeout(applyVersion, 1200);
  setTimeout(applyVersion, 2600);
})();