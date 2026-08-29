(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const SB = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_PUBLISHABLE_KEY;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function getSession(){
    try { return JSON.parse(localStorage.getItem('vendor_order_session') || 'null'); }
    catch { return null; }
  }

  async function loadVendorMap(){
    const s = getSession();
    if (!s?.access_token) return new Map();
    const res = await fetch(`${SB}/rest/v1/order_tracking_overview?select=id,vendor_code,vendor_name`, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${s.access_token}`
      }
    });
    if (!res.ok) return new Map();
    const rows = await res.json().catch(() => []);
    return new Map((rows || []).map(x => [x.id, x]));
  }

  function vendorHtml(v){
    return `<div class="clarity-vendor vendor-column-authoritative">
      <div class="clarity-field">
        <span class="clarity-label">廠商編號</span>
        <span class="clarity-code vendor">${esc(v.vendor_code || '—')}</span>
      </div>
      <div class="clarity-field">
        <span class="clarity-label">廠商名稱</span>
        <span class="clarity-name">${esc(v.vendor_name || '—')}</span>
      </div>
    </div>`;
  }

  let running = false;
  let timer = null;

  async function repair(){
    if (running) return;
    const body = $('orderRows');
    const table = body?.closest('table');
    if (!body || !table) return;

    const heads = [...table.querySelectorAll('thead th')];
    const vendorIndex = heads.findIndex(th => th.textContent.trim() === '廠商編號／廠商名稱' || th.textContent.trim() === '廠商');
    if (vendorIndex < 0) return;

    const rows = [...body.querySelectorAll('tr')].filter(tr => tr.querySelector('[data-save-status]'));
    if (!rows.length) return;

    // During bulk-checkbox insertion the header and body can briefly have different column counts.
    // Never write while the table is in that transitional state.
    if (rows.some(tr => tr.children.length !== heads.length)) {
      schedule(80);
      return;
    }

    running = true;
    try {
      const map = await loadVendorMap();
      rows.forEach(tr => {
        const btn = tr.querySelector('[data-save-status]');
        const orderId = btn?.dataset.saveStatus;
        const vendor = map.get(orderId);
        const cell = tr.children[vendorIndex];
        if (!vendor || !cell) return;
        const sig = `${vendor.vendor_code || ''}|${vendor.vendor_name || ''}`;
        if (cell.dataset.vendorAuthoritative === sig) return;
        cell.innerHTML = vendorHtml(vendor);
        cell.dataset.vendorAuthoritative = sig;
        cell.dataset.clarityVendor = '1';
        cell.dataset.label = '廠商編號／廠商名稱';
      });
    } catch (e) {
      console.warn('vendor column repair failed', e?.message || e);
    } finally {
      running = false;
    }
  }

  function schedule(ms = 50){
    clearTimeout(timer);
    timer = setTimeout(repair, ms);
  }

  function install(){
    const body = $('orderRows');
    if (!body) return;
    new MutationObserver(() => schedule(60)).observe(body, { childList:true, subtree:true });
    const head = body.closest('table')?.querySelector('thead');
    if (head) new MutationObserver(() => schedule(80)).observe(head, { childList:true, subtree:true });

    ['reloadBtn','searchInput','vendorFilter','alertFilter','orderSortSelect'].forEach(id => {
      $(id)?.addEventListener('click', () => schedule(180));
      $(id)?.addEventListener('input', () => schedule(100));
      $(id)?.addEventListener('change', () => schedule(100));
    });
    $('loginBtn')?.addEventListener('click', () => { schedule(500); setTimeout(repair, 1200); });

    schedule(200);
    setTimeout(repair, 700);
    setTimeout(repair, 1500);
  }

  window.addEventListener('DOMContentLoaded', install);
})();
