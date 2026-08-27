(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const SB = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_PUBLISHABLE_KEY;
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function getSession() {
    try { return JSON.parse(localStorage.getItem('vendor_order_session') || 'null'); }
    catch { return null; }
  }

  function decodeJwt(token = '') {
    try {
      const p = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      const pad = p.length % 4 ? '='.repeat(4 - p.length % 4) : '';
      return JSON.parse(decodeURIComponent(escape(atob(p + pad))));
    } catch { return {}; }
  }

  function role() {
    const s = getSession();
    return decodeJwt(s?.access_token || '').app_metadata?.role || '';
  }

  async function rest(path, options = {}) {
    const s = getSession();
    if (!s?.access_token) throw new Error('登入已過期，請重新登入');
    const res = await fetch(`${SB}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${s.access_token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { const d = JSON.parse(text); msg = d.message || d.hint || d.details || text; } catch {}
      throw new Error(msg || `HTTP ${res.status}`);
    }
    return text ? JSON.parse(text) : null;
  }

  function today() {
    return new Date().toLocaleDateString('en-CA', { timeZone:'Asia/Taipei' });
  }

  async function getBoxMap() {
    const rows = await rest('order_tracking_overview?select=id,shipping_box_count');
    return new Map((rows || []).map(x => [x.id, x.shipping_box_count]));
  }

  let vendorEnhanceRunning = false;
  async function enhanceVendorOrders() {
    if (vendorEnhanceRunning || role() !== 'vendor') return;
    const buttons = [...document.querySelectorAll('#vendorOrders [data-vendor-save]')];
    if (!buttons.length) return;
    vendorEnhanceRunning = true;
    try {
      const map = await getBoxMap();
      for (const btn of buttons) {
        const orderId = btn.dataset.vendorSave;
        const card = btn.closest('.order-card');
        const grid = card?.querySelector('.form-grid.two');
        if (!orderId || !grid || card.querySelector(`[data-box-field="${orderId}"]`)) continue;
        const label = document.createElement('label');
        label.dataset.boxField = orderId;
        label.className = 'shipping-box-field';
        const val = map.get(orderId);
        label.innerHTML = `出貨箱數<input id="v-boxes-${esc(orderId)}" type="number" inputmode="numeric" min="0" step="1" value="${val == null ? '' : Number(val)}" placeholder="例如 3">`;
        grid.appendChild(label);
      }
    } catch (e) {
      console.warn('shipping box field load failed', e.message);
    } finally {
      vendorEnhanceRunning = false;
    }
  }

  async function saveVendorWithBoxes(btn) {
    const orderId = btn.dataset.vendorSave;
    const vendorId = btn.dataset.vendorId;
    const s = getSession();
    if (!orderId || !vendorId || !s?.user?.id) return;

    const boxInput = $(`v-boxes-${orderId}`);
    const rawBoxes = boxInput?.value?.trim() ?? '';
    let boxes = null;
    if (rawBoxes !== '') {
      boxes = Number(rawBoxes);
      if (!Number.isInteger(boxes) || boxes < 0) {
        alert('出貨箱數請輸入 0 以上的整數。');
        boxInput?.focus();
        return;
      }
    }

    let vendorStatus = $(`v-status-${orderId}`)?.value || 'confirmed';
    let actual = $(`v-actual-${orderId}`)?.value || null;
    if (vendorStatus === 'shipped' && !actual) actual = today();

    const payload = {
      order_id: orderId,
      vendor_id: vendorId,
      promised_ship_date: $(`v-promised-${orderId}`)?.value || null,
      actual_ship_date: actual,
      shipping_box_count: boxes,
      carrier: $(`v-carrier-${orderId}`)?.value?.trim() || null,
      tracking_no: $(`v-track-${orderId}`)?.value?.trim() || null,
      vendor_status: vendorStatus,
      note: $(`v-note-${orderId}`)?.value?.trim() || null,
      created_by: s.user.id
    };

    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '儲存中…';
    try {
      await rest('vendor_updates?on_conflict=order_id,vendor_id', {
        method:'POST',
        headers:{ Prefer:'resolution=merge-duplicates,return=representation' },
        body:JSON.stringify(payload)
      });
      alert('出貨資訊已儲存。');
      $('vendorReloadBtn')?.click();
    } catch (e) {
      alert(`儲存失敗：${e.message}`);
      btn.disabled = false;
      btn.textContent = old || '儲存出貨回覆';
    }
  }

  let adminEnhanceTimer = null;
  async function enhanceAdminTracking() {
    if (!['admin','employee'].includes(role())) return;
    const body = $('orderRows');
    if (!body || !body.querySelector('[data-save-status]')) return;
    try {
      const map = await getBoxMap();
      const table = body.closest('table');
      const headers = [...(table?.querySelectorAll('thead th') || [])];
      const replyIndex = headers.findIndex(th => th.textContent.trim() === '廠商回覆');
      if (replyIndex < 0) return;
      body.querySelectorAll('tr').forEach(row => {
        const btn = row.querySelector('[data-save-status]');
        if (!btn) return;
        const cell = row.children[replyIndex];
        if (!cell) return;
        cell.querySelector('.shipping-box-display')?.remove();
        const count = map.get(btn.dataset.saveStatus);
        const span = document.createElement('span');
        span.className = 'muted shipping-box-display';
        span.innerHTML = `<br>出貨箱數：<b>${count == null ? '—' : `${Number(count)} 箱`}</b>`;
        cell.appendChild(span);
      });
    } catch (e) {
      console.warn('admin shipping box display failed', e.message);
    }
  }

  function scheduleAdminEnhance() {
    clearTimeout(adminEnhanceTimer);
    adminEnhanceTimer = setTimeout(enhanceAdminTracking, 80);
  }

  function ensureReportHeader(tableBodyId, afterText) {
    const table = $(tableBodyId)?.closest('table');
    const row = table?.querySelector('thead tr');
    if (!row || [...row.children].some(th => th.textContent.trim() === '出貨箱數')) return;
    const cells = [...row.children];
    const idx = cells.findIndex(th => th.textContent.trim() === afterText);
    const th = document.createElement('th');
    th.textContent = '出貨箱數';
    if (idx >= 0 && cells[idx].nextSibling) row.insertBefore(th, cells[idx].nextSibling);
    else row.appendChild(th);
  }

  async function renderReportsWithBoxes() {
    if (!['admin','employee'].includes(role())) return;
    try {
      const [summary, monthly] = await Promise.all([
        rest('vendor_shipping_summary?select=*&order=vendor_code.asc'),
        rest('monthly_shipping_summary?select=*&order=month.desc,vendor_code.asc')
      ]);
      ensureReportHeader('vendorReportRows','已出貨');
      ensureReportHeader('monthlyReportRows','已出貨');

      if ($('vendorReportRows')) {
        $('vendorReportRows').innerHTML = (summary || []).map(x => `<tr>
          <td><b>${esc(x.vendor_code)} ${esc(x.vendor_name)}</b></td>
          <td>${Number(x.total_orders||0)}</td>
          <td>${Number(x.open_orders||0)}</td>
          <td class="${Number(x.overdue_orders)>0?'kpi-bad':''}">${Number(x.overdue_orders||0)}</td>
          <td class="${Number(x.due_soon_orders)>0?'kpi-warn':''}">${Number(x.due_soon_orders||0)}</td>
          <td>${Number(x.shipped_orders||0)}</td>
          <td><b>${Number(x.shipped_boxes||0)} 箱</b></td>
          <td class="${Number(x.on_time_rate)>=90?'kpi-good':''}">${x.on_time_rate==null?'—':`${x.on_time_rate}%`}</td>
          <td>${x.avg_delay_days==null?'—':`${x.avg_delay_days} 天`}</td>
        </tr>`).join('') || '<tr><td colspan="9">尚無資料</td></tr>';
      }

      if ($('monthlyReportRows')) {
        $('monthlyReportRows').innerHTML = (monthly || []).map(x => `<tr>
          <td>${esc(x.month)}</td>
          <td>${esc(x.vendor_code)} ${esc(x.vendor_name)}</td>
          <td>${Number(x.orders||0)}</td>
          <td>${Number(x.shipped||0)}</td>
          <td><b>${Number(x.shipped_boxes||0)} 箱</b></td>
          <td>${Number(x.pending||0)}</td>
          <td>${Number(x.on_time||0)}</td>
          <td class="${Number(x.late)>0?'kpi-bad':''}">${Number(x.late||0)}</td>
          <td>${x.on_time_rate==null?'—':`${x.on_time_rate}%`}</td>
        </tr>`).join('') || '<tr><td colspan="9">尚無資料</td></tr>';
      }
    } catch (e) {
      console.warn('shipping box report load failed', e.message);
    }
  }

  function install() {
    const style = document.createElement('style');
    style.id = 'shippingBoxStyles';
    style.textContent = `.shipping-box-field input{font-variant-numeric:tabular-nums}.shipping-box-display b{color:#344054}.shipping-box-field{min-width:120px}`;
    if (!$('shippingBoxStyles')) document.head.appendChild(style);

    document.addEventListener('click', (e) => {
      const saveBtn = e.target.closest?.('[data-vendor-save]');
      if (saveBtn && role() === 'vendor' && saveBtn.closest('#vendorOrders')) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        saveVendorWithBoxes(saveBtn);
        return;
      }
      const tab = e.target.closest?.('.tab[data-tab="report"]');
      if (tab) {
        setTimeout(renderReportsWithBoxes, 250);
        setTimeout(renderReportsWithBoxes, 900);
      }
    }, true);

    const vendorRoot = $('vendorOrders');
    if (vendorRoot) {
      new MutationObserver(() => setTimeout(enhanceVendorOrders, 30)).observe(vendorRoot,{childList:true,subtree:true});
    }
    const orderRoot = $('orderRows');
    if (orderRoot) {
      new MutationObserver(scheduleAdminEnhance).observe(orderRoot,{childList:true,subtree:true});
    }

    setTimeout(enhanceVendorOrders, 250);
    setTimeout(enhanceVendorOrders, 900);
    setTimeout(enhanceAdminTracking, 350);
    setTimeout(enhanceAdminTracking, 1000);
  }

  window.addEventListener('DOMContentLoaded', install);
})();
