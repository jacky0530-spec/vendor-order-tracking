(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const SB = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_PUBLISHABLE_KEY;
  const $ = id => document.getElementById(id);
  let roleCache = null;
  let dataCache = null;
  let loading = null;
  let timer = 0;

  function session() {
    try { return JSON.parse(localStorage.getItem('vendor_order_session') || 'null'); }
    catch { return null; }
  }

  async function api(path) {
    const s = session();
    if (!s?.access_token) throw new Error('登入已過期');
    const r = await fetch(`${SB}/rest/v1/${path}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${s.access_token}` }
    });
    const t = await r.text();
    if (!r.ok) throw new Error(t || `HTTP ${r.status}`);
    return t ? JSON.parse(t) : null;
  }

  async function ownRole() {
    if (roleCache) return roleCache;
    const uid = session()?.user?.id;
    if (!uid) return '';
    const rows = await api(`user_profiles?select=role,active&user_id=eq.${encodeURIComponent(uid)}`);
    const p = rows?.[0];
    roleCache = p?.active === false ? '' : (p?.role || '');
    return roleCache;
  }

  async function shippingRows(force = false) {
    if (force) { dataCache = null; loading = null; }
    if (dataCache) return dataCache;
    if (loading) return loading;
    loading = api('order_item_shipping_overview?select=*&order=order_no.asc,sort_order.asc')
      .then(rows => dataCache = rows || [])
      .finally(() => loading = null);
    return loading;
  }

  const fmt = v => {
    if (v == null || v === '') return '—';
    const n = Number(v);
    return Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : String(n).replace(/0+$/, '').replace(/\.$/, '')) : String(v);
  };

  function addStyles() {
    if ($('adminShippingProgress229Style')) return;
    const st = document.createElement('style');
    st.id = 'adminShippingProgress229Style';
    st.textContent = `
      .v229-item-progress{margin-top:6px;padding:6px 9px;border-radius:8px;font-size:12px;font-weight:800;line-height:1.45}
      .v229-item-progress.partial{background:#fff4e5;color:#b54708;border:1px solid #fedf89}
      .v229-item-progress.shipped{background:#ecfdf3;color:#067647;border:1px solid #abefc6}
      .v229-item-progress.pending{background:#f2f4f7;color:#475467;border:1px solid #e4e7ec}
      .v229-order-progress{margin-top:7px;padding-top:7px;border-top:1px dashed #d0d5dd;font-size:12px;font-weight:750;color:#344054;line-height:1.5}
      .v229-order-progress .partial{color:#b54708}.v229-order-progress .done{color:#067647}
    `;
    document.head.appendChild(st);
  }

  function itemText(x) {
    const unit = x.quantity_unit || '';
    const ordered = x.ordered_quantity ?? x.quantity;
    const shipped = Number(x.shipped_quantity || 0);
    const remain = x.remaining_quantity == null ? null : Number(x.remaining_quantity);
    if (x.shipping_state === 'partial') {
      return `部分出貨｜已出 ${fmt(shipped)} / ${fmt(ordered)}${unit}｜剩 ${fmt(remain)}${unit}｜${Number(x.shipment_count || 0)} 次回報`;
    }
    if (x.shipping_state === 'shipped') {
      return `已全數出貨｜已出 ${fmt(shipped)} / ${fmt(ordered)}${unit}｜${Number(x.shipment_count || 0)} 次回報`;
    }
    return `尚未出貨｜訂購 ${fmt(ordered)}${unit}`;
  }

  function setIfChanged(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  async function render(force = false) {
    const root = $('orderRows');
    if (!root) return;
    const role = await ownRole().catch(() => '');
    if (!['admin', 'employee'].includes(role)) return;

    const all = await shippingRows(force).catch(() => []);
    const byOrder = new Map();
    for (const x of all) {
      if (!byOrder.has(x.order_no)) byOrder.set(x.order_no, []);
      byOrder.get(x.order_no).push(x);
    }

    const table = root.closest('table');
    const heads = [...(table?.querySelectorAll('thead th') || [])];
    const replyIndex = heads.findIndex(th => th.textContent.trim() === '廠商回覆');

    for (const tr of root.querySelectorAll(':scope > tr')) {
      const orderNo = tr.children?.[1]?.querySelector('b')?.textContent?.trim();
      if (!orderNo) continue;
      const list = byOrder.get(orderNo) || [];
      if (!list.length) continue;

      let targets = [...tr.querySelectorAll('.admin-item-row')];
      if (!targets.length) targets = [...tr.querySelectorAll('.product-line')];
      if (!targets.length) continue;

      list.forEach((x, i) => {
        const target = targets[i];
        if (!target) return;
        const sig = `${x.shipping_state}|${x.shipped_quantity}|${x.remaining_quantity}|${x.shipment_count}|${x.ordered_quantity}`;
        if (target.dataset.v229ProgressSig === sig) return;
        target.dataset.v229ProgressSig = sig;

        const oldPending = target.querySelector('.admin-item-pending');
        if (oldPending && oldPending.style.display !== 'none') oldPending.style.display = 'none';
        const oldShipping = target.querySelector('.admin-item-shipping');
        if (oldShipping) {
          const shouldHide = x.shipping_state !== 'shipped';
          const wanted = shouldHide ? 'none' : '';
          if (oldShipping.style.display !== wanted) oldShipping.style.display = wanted;
        }

        let box = target.querySelector('.v229-item-progress');
        if (!box) {
          box = document.createElement('div');
          box.className = 'v229-item-progress';
          target.appendChild(box);
        }
        box.className = `v229-item-progress ${x.shipping_state || 'pending'}`;
        setIfChanged(box, itemText(x));
      });

      if (replyIndex >= 0) {
        const reply = tr.children[replyIndex];
        if (reply) {
          const complete = list.filter(x => x.shipping_state === 'shipped').length;
          const partial = list.filter(x => x.shipping_state === 'partial').length;
          const pending = list.filter(x => x.shipping_state === 'pending').length;
          const oldSummary = reply.querySelector('.item-shipping-order-summary');
          if (oldSummary && oldSummary.style.display !== 'none') oldSummary.style.display = 'none';

          let sum = reply.querySelector('.v229-order-progress');
          if (!sum) {
            sum = document.createElement('div');
            sum.className = 'v229-order-progress';
            reply.appendChild(sum);
          }
          const text = `逐商品出貨：完成 ${complete}/${list.length} 項${partial ? `｜部分 ${partial} 項` : ''}${pending ? `｜未出 ${pending} 項` : ''}`;
          setIfChanged(sum, text);
          sum.innerHTML = sum.textContent
            .replace(`完成 ${complete}/${list.length} 項`, `<span class="done">完成 ${complete}/${list.length} 項</span>`)
            .replace(partial ? `部分 ${partial} 項` : '__none__', partial ? `<span class="partial">部分 ${partial} 項</span>` : '');
        }
      }
    }
  }

  function schedule(force = false, delay = 450) {
    clearTimeout(timer);
    timer = setTimeout(() => render(force), delay);
  }

  function install() {
    addStyles();
    const root = $('orderRows');
    if (root && !root.dataset.v229ProgressObserver) {
      root.dataset.v229ProgressObserver = '1';
      new MutationObserver(mutations => {
        if (!mutations.some(m => m.target === root && (m.addedNodes.length || m.removedNodes.length))) return;
        schedule(false, 500);
      }).observe(root, { childList: true });
    }
    document.addEventListener('click', e => {
      if (e.target.closest?.('#reloadBtn,[data-save-status],[data-v228-save-edit]')) {
        dataCache = null;
        schedule(true, 650);
      }
    });
    schedule(true, 700);
    setTimeout(() => render(false), 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
