(() => {
  'use strict';

  const ROOT = '#vendorOrders';
  const ROW = '.item-pick-row';
  const CHECK = 'input[data-item-select]';

  function injectStyles() {
    if (document.getElementById('vendorClickReliabilityStyles')) return;
    const st = document.createElement('style');
    st.id = 'vendorClickReliabilityStyles';
    st.textContent = `
      #vendorOrders .item-pick-row{
        position:relative!important;
        min-height:66px!important;
        align-items:center!important;
        cursor:pointer!important;
        user-select:none!important;
        -webkit-user-select:none!important;
        touch-action:manipulation!important;
        -webkit-tap-highlight-color:transparent!important;
        transition:border-color .12s ease,background .12s ease,box-shadow .12s ease!important;
      }
      #vendorOrders .item-pick-row .item-pick-main{
        pointer-events:none!important;
      }
      #vendorOrders .item-pick-row input[data-item-select]{
        width:28px!important;
        height:28px!important;
        min-width:28px!important;
        min-height:28px!important;
        flex:0 0 28px!important;
        margin:0 2px 0 0!important;
        cursor:pointer!important;
        pointer-events:auto!important;
        position:relative!important;
        z-index:2!important;
        accent-color:#0f766e!important;
      }
      #vendorOrders .item-pick-row.vendor-selected{
        border-color:#0f766e!important;
        background:#ecfdf3!important;
        box-shadow:0 0 0 2px rgba(15,118,110,.12)!important;
      }
      #vendorOrders .item-pick-row:not(.is-shipped):hover{
        border-color:#5eead4!important;
        background:#f0fdfa!important;
      }
      #vendorOrders .item-pick-row.vendor-selected:hover{
        border-color:#0f766e!important;
        background:#ecfdf3!important;
      }
      #vendorOrders .item-pick-row.is-shipped{
        cursor:default!important;
        user-select:text!important;
      }
      body.vendor-has-selection #vendorOrders{
        padding-bottom:120px!important;
      }
      @media(max-width:760px){
        #vendorOrders .item-pick-row{min-height:72px!important;padding:13px 11px!important;gap:12px!important}
        #vendorOrders .item-pick-row input[data-item-select]{width:30px!important;height:30px!important;min-width:30px!important;min-height:30px!important;flex-basis:30px!important}
        body.vendor-has-selection #vendorOrders{padding-bottom:170px!important}
      }
    `;
    document.head.appendChild(st);
  }

  function syncRows() {
    const root = document.querySelector(ROOT);
    if (!root) return;
    let checked = 0;
    root.querySelectorAll(`${ROW} ${CHECK}`).forEach(cb => {
      const row = cb.closest(ROW);
      if (!row) return;
      const active = Boolean(cb.checked && !cb.disabled);
      row.classList.toggle('vendor-selected', active);
      row.setAttribute('aria-checked', active ? 'true' : 'false');
      if (!cb.disabled) {
        row.title = active ? '已選取；再點一次可取消' : '點一下整列即可選取';
      }
      if (active) checked += 1;
    });
    document.body.classList.toggle('vendor-has-selection', checked > 0);
  }

  function toggleRow(row) {
    if (!row || row.classList.contains('is-shipped')) return;
    const cb = row.querySelector(CHECK);
    if (!cb || cb.disabled) return;
    cb.checked = !cb.checked;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    syncRows();
  }

  function install() {
    injectStyles();
    syncRows();

    // Explicitly handle the whole row instead of depending on browser label activation.
    document.addEventListener('click', event => {
      const row = event.target.closest?.(`${ROOT} ${ROW}`);
      if (!row) return;
      const cb = row.querySelector(CHECK);
      if (!cb || cb.disabled || row.classList.contains('is-shipped')) return;

      // Clicking the native checkbox itself is already reliable; allow its native toggle.
      if (event.target === cb) {
        queueMicrotask(syncRows);
        return;
      }

      // Future interactive controls inside a row should keep their own behavior.
      if (event.target.closest?.('button,a,select,textarea,input')) return;

      event.preventDefault(); // Prevent the LABEL default action from toggling a second time.
      toggleRow(row);
    }, true);

    document.addEventListener('change', event => {
      if (event.target.matches?.(`${ROOT} ${CHECK}`)) syncRows();
    });

    // Cross-order module clears checkboxes programmatically without firing change.
    document.addEventListener('click', event => {
      if (event.target.closest?.('#crossShipClear,#crossShipSave,#vendorReloadBtn')) {
        setTimeout(syncRows, 0);
        setTimeout(syncRows, 450);
      }
    });

    const root = document.querySelector(ROOT);
    if (root && !root.dataset.vendorClickReliabilityObserved) {
      root.dataset.vendorClickReliabilityObserved = '1';
      let raf = 0;
      new MutationObserver(mutations => {
        if (!mutations.some(m => m.addedNodes?.length || m.removedNodes?.length)) return;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(syncRows);
      }).observe(root, { childList: true, subtree: true });
    }

    setTimeout(syncRows, 300);
    setTimeout(syncRows, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
