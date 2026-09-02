(() => {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const SB = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_PUBLISHABLE_KEY;
  let cache = null;
  let loading = null;

  function session() {
    try { return JSON.parse(localStorage.getItem('vendor_order_session') || 'null'); }
    catch { return null; }
  }

  async function rest(path) {
    const s = session();
    if (!s?.access_token) return [];
    const res = await fetch(`${SB}/rest/v1/${path}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${s.access_token}` }
    });
    if (!res.ok) return [];
    return res.json().catch(() => []);
  }

  function fmt(v) {
    if (v == null || v === '') return '—';
    const n = Number(v);
    return Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : String(n).replace(/0+$/,'').replace(/\.$/,'')) : String(v);
  }

  function injectStyle() {
    if (document.getElementById('psAdminTrackStyle')) return;
    const st = document.createElement('style');
    st.id = 'psAdminTrackStyle';
    st.textContent = `
      .ps-track-progress{display:inline-flex;align-items:center;margin:4px 0 0 8px;padding:3px 7px;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap}
      .ps-track-progress.partial{background:#fff4e5;color:#b54708}
      .ps-track-progress.shipped{background:#dcfae6;color:#067647}
    `;
    document.head.appendChild(st);
  }

  async function load(force = false) {
    if (force) { cache = null; loading = null; }
    if (cache) return cache;
    if (loading) return loading;
    loading = rest('order_item_shipping_overview?select=order_no,product_code,quantity,ordered_quantity,quantity_unit,shipped_quantity,remaining_quantity,shipping_state,shipment_count,sort_order&order=order_no.asc,sort_order.asc')
      .then(rows => cache = rows || [])
      .finally(() => loading = null);
    return loading;
  }

  function apply(rows) {
    const byOrder = new Map();
    for (const r of rows) {
      if (!byOrder.has(r.order_no)) byOrder.set(r.order_no, []);
      byOrder.get(r.order_no).push(r);
    }
    document.querySelectorAll('#orderRows > tr').forEach(tr => {
      const orderNo = tr.querySelector('td:nth-child(2) > b')?.textContent?.trim();
      if (!orderNo) return;
      const items = byOrder.get(orderNo) || [];
      const lines = [...tr.querySelectorAll('td:nth-child(3) .product-line')];
      lines.forEach((line, i) => {
        const x = items[i];
        const old = line.querySelector('.ps-track-progress');
        if (!x || !['partial','shipped'].includes(x.shipping_state)) {
          old?.remove();
          return;
        }
        const unit = x.quantity_unit || '';
        const ordered = x.ordered_quantity ?? x.quantity;
        const shipped = x.shipped_quantity ?? 0;
        const remain = x.remaining_quantity;
        const text = x.shipping_state === 'partial'
          ? `部分出貨 已出 ${fmt(shipped)}/${fmt(ordered)}${unit}・剩 ${fmt(remain)}${unit}`
          : `已全數出貨 ${fmt(shipped)}/${fmt(ordered)}${unit}`;
        if (old && old.dataset.sig === text) return;
        if (old) old.remove();
        const chip = document.createElement('span');
        chip.className = `ps-track-progress ${x.shipping_state}`;
        chip.dataset.sig = text;
        chip.textContent = text;
        line.appendChild(chip);
      });
    });
  }

  async function decorate(force = false) {
    if (!document.getElementById('orderRows')) return;
    const rows = await load(force).catch(() => []);
    apply(rows);
  }

  function install() {
    injectStyle();
    const body = document.getElementById('orderRows');
    if (!body) return;
    let timer;
    const obs = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => decorate(false), 60);
    });
    obs.observe(body, { childList: true });
    document.getElementById('reloadBtn')?.addEventListener('click', () => {
      cache = null;
      setTimeout(() => decorate(true), 350);
    });
    setTimeout(() => decorate(true), 700);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();