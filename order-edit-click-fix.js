(() => {
  'use strict';

  // V2.26 stability guard
  // Several legacy observers watch childList and then write the same textContent
  // again. Setting identical textContent still creates a DOM mutation, which can
  // recursively wake the same observer and eventually freeze the page.
  const VERSION = 'V2.26';

  // Keep one authoritative version without a global MutationObserver loop.
  try {
    Object.defineProperty(window, 'APP_VERSION', {
      configurable: false,
      enumerable: true,
      get: () => VERSION,
      set: () => {}
    });
  } catch {
    window.APP_VERSION = VERSION;
  }

  // Make identical textContent assignments a no-op. This is semantically safe
  // and prevents MutationObserver -> textContent -> MutationObserver recursion.
  try {
    const d = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
    if (d?.get && d?.set && !window.__VENDOR_TEXT_STABILITY_GUARD__) {
      window.__VENDOR_TEXT_STABILITY_GUARD__ = true;
      Object.defineProperty(Node.prototype, 'textContent', {
        configurable: d.configurable,
        enumerable: d.enumerable,
        get: d.get,
        set(value) {
          let next = value == null ? '' : String(value);
          if (this?.nodeType === 1) {
            const el = /** @type {Element} */ (this);
            if (el.classList?.contains('system-version-chip') && /^系統版本\s+V/i.test(next)) {
              next = `系統版本 ${VERSION}`;
            } else if (el.tagName === 'FOOTER' && /^Vendor Order Tracking\s+V/i.test(next)) {
              next = `Vendor Order Tracking ${VERSION}`;
            }
          }
          if (d.get.call(this) === next) return;
          d.set.call(this, next);
        }
      });
    }
  } catch (e) {
    console.warn('text stability guard unavailable', e);
  }

  function applyVersion() {
    document.querySelectorAll('.system-version-chip').forEach(el => {
      const text = `系統版本 ${VERSION}`;
      if (el.textContent !== text) el.textContent = text;
    });
    const footer = document.querySelector('footer');
    const text = `Vendor Order Tracking ${VERSION}`;
    if (footer && footer.textContent !== text) footer.textContent = text;
  }

  // Only compact-layout CSS remains here. No click interception, no interval,
  // no MutationObserver, and no pseudo-element version text.
  const st = document.createElement('style');
  st.id = 'stableCompactAdminStyles';
  st.textContent = `
    .topbar{position:sticky!important;top:0!important;z-index:10000!important}
    #adminView{padding-top:4px!important}
    #adminView .tabs{gap:6px!important;margin:2px 0 8px!important}
    #adminView .tabs .tab{padding:8px 14px!important;min-height:36px!important;font-size:14px!important}
    #tab-tracking .metrics{gap:10px!important;margin:0 0 10px!important}
    #tab-tracking .metric.card{padding:10px 15px!important;min-height:68px!important;border-radius:12px!important}
    #tab-tracking .metric span{font-size:11px!important;line-height:1.1!important}
    #tab-tracking .metric strong{font-size:27px!important;line-height:1!important;margin-top:4px!important}
    #tab-tracking .section-card{padding:12px 14px!important;border-radius:14px!important}
    #tab-tracking .section-head{margin-bottom:7px!important;gap:8px!important}
    #tab-tracking .section-head h2{font-size:18px!important;line-height:1.15!important;margin:0 0 2px!important}
    #tab-tracking .section-head .muted{font-size:10px!important;line-height:1.2!important;margin:0!important}
    #tab-tracking .section-head .btn{padding:7px 12px!important;min-height:34px!important}
    #tab-tracking .filters{gap:7px!important;margin:0 0 7px!important}
    #tab-tracking .filters input,#tab-tracking .filters select{min-height:36px!important;height:36px!important;padding-top:6px!important;padding-bottom:6px!important;font-size:13px!important}
    #tab-tracking .table-wrap{max-height:calc(100vh - 355px)!important;min-height:360px!important;overflow:auto!important;overscroll-behavior:contain!important}
    #tab-tracking .table-wrap thead th{position:sticky!important;top:0!important;z-index:30!important;background:#f8fafc!important;box-shadow:0 1px 0 #e4e7ec!important}
    #orderRows button[data-employee-edit]{pointer-events:auto!important;cursor:pointer!important;touch-action:manipulation!important}
    @media(max-height:800px){#tab-tracking .table-wrap{max-height:calc(100vh - 320px)!important;min-height:300px!important}}
    @media(max-width:800px){
      #tab-tracking .metrics{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:6px!important}
      #tab-tracking .metric.card{min-height:58px!important;padding:8px 10px!important}
      #tab-tracking .metric strong{font-size:23px!important}
      #tab-tracking .table-wrap{max-height:calc(100vh - 385px)!important;min-height:300px!important}
    }
  `;
  document.getElementById(st.id)?.remove();
  document.head.appendChild(st);

  applyVersion();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyVersion, { once: true });
  }
  setTimeout(applyVersion, 300);
  setTimeout(applyVersion, 1200);
})();