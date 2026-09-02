(() => {
  'use strict';

  const VERSION = 'V2.28';
  const CFG = window.APP_CONFIG || {};
  const SB = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_PUBLISHABLE_KEY;
  const PORTAL = CFG.ADMIN_API_URL;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  let profileCache = null;
  let profilePromise = null;
  let deadlineCache = null;
  let deadlinePromise = null;
  let editOrder = null;
  let editItems = [];
  let enhanceTimer = null;

  function session() {
    try { return JSON.parse(localStorage.getItem('vendor_order_session') || 'null'); }
    catch { return null; }
  }

  async function rest(path, options = {}) {
    const s = session();
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
      try {
        const d = JSON.parse(text);
        msg = d.message || d.hint || d.details || text;
      } catch {}
      throw new Error(msg || `HTTP ${res.status}`);
    }
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }

  async function edge(body) {
    const s = session();
    if (!s?.access_token) throw new Error('登入已過期，請重新登入');
    const res = await fetch(PORTAL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || d.message || `HTTP ${res.status}`);
    return d;
  }

  async function adminOrders(action, ids = []) {
    const s = session();
    if (!s?.access_token) throw new Error('登入已過期，請重新登入');
    const res = await fetch(`${SB}/functions/v1/admin-orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, order_ids: ids })
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) throw new Error(d.error || d.message || `HTTP ${res.status}`);
    return d;
  }

  async function ownProfile(force = false) {
    const s = session();
    const uid = s?.user?.id;
    if (!uid) {
      profileCache = null;
      profilePromise = null;
      return null;
    }
    if (force) {
      profileCache = null;
      profilePromise = null;
    }
    if (profileCache?.user_id === uid) return profileCache;
    if (profilePromise) return profilePromise;
    profilePromise = rest(`user_profiles?select=*&user_id=eq.${encodeURIComponent(uid)}`)
      .then(rows => {
        const p = rows?.[0] || null;
        profileCache = p?.active === false ? null : p;
        return profileCache;
      })
      .finally(() => { profilePromise = null; });
    return profilePromise;
  }

  function canManage(p) {
    return p && (p.role === 'admin' || p.role === 'employee');
  }

  function setVersion() {
    let chip = document.querySelector('.system-version-chip');
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'system-version-chip';
      chip.style.cssText = 'display:inline-flex;position:fixed;right:16%;top:96px;z-index:50;padding:5px 10px;border:1px solid #b2ddff;background:#eff8ff;color:#175cd3;border-radius:999px;font-size:12px;font-weight:700';
      document.body.appendChild(chip);
    }
    chip.textContent = `系統版本 ${VERSION}`;
    const footer = document.querySelector('footer');
    if (footer) footer.textContent = `Vendor Order Tracking ${VERSION}`;
  }

  function injectStyles() {
    if ($('v228Styles')) return;
    const st = document.createElement('style');
    st.id = 'v228Styles';
    st.textContent = `
      .topbar{position:sticky;top:0;z-index:9000}
      #adminView{padding-top:4px}
      #adminView .tabs{gap:6px;margin:2px 0 8px}
      #adminView .tabs .tab{padding:8px 14px;min-height:36px;font-size:14px}
      #tab-tracking .metrics{gap:10px;margin:0 0 10px}
      #tab-tracking .metric.card{padding:10px 15px;min-height:68px;border-radius:12px}
      #tab-tracking .metric span{font-size:11px;line-height:1.1}
      #tab-tracking .metric strong{font-size:27px;line-height:1;margin-top:4px}
      #tab-tracking .section-card{padding:12px 14px;border-radius:14px}
      #tab-tracking .section-head{margin-bottom:7px;gap:8px}
      #tab-tracking .section-head h2{font-size:18px;line-height:1.15;margin:0 0 2px}
      #tab-tracking .section-head .muted{font-size:10px;line-height:1.2;margin:0}
      #tab-tracking .filters{gap:7px;margin:0 0 7px}
      #tab-tracking .filters input,#tab-tracking .filters select{min-height:36px;height:36px;padding-top:6px;padding-bottom:6px;font-size:13px}
      #tab-tracking .table-wrap{max-height:calc(100vh - 355px);min-height:360px;overflow:auto;overscroll-behavior:contain}
      #tab-tracking .table-wrap thead th{position:sticky;top:0;z-index:30;background:#f8fafc;box-shadow:0 1px 0 #e4e7ec}
      .v228-action{display:block;margin-top:6px!important;min-width:76px}
      .v228-edit{background:#344054!important;color:#fff!important;border-color:#344054!important}
      .v228-delete{background:#fff!important;color:#b42318!important;border:1px solid #fda29b!important}
      .v228-row-check{display:flex;align-items:center;gap:4px;margin:5px 0 0;font-size:10px;color:#667085}
      .v228-row-check input{width:16px;height:16px}
      #v228BulkBar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0;padding:8px 10px;border:1px solid #fedf89;background:#fffaeb;border-radius:10px}
      .v228-overlay{position:fixed;inset:0;z-index:120000;background:rgba(16,24,40,.64);display:flex;align-items:center;justify-content:center;padding:16px}
      .v228-overlay.hidden{display:none!important}
      .v228-card{width:min(1020px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:18px;padding:20px;box-shadow:0 24px 70px rgba(0,0,0,.3)}
      .v228-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
      .v228-head h2{margin:0}
      .v228-close{border:0;background:#f2f4f7;width:40px;height:40px;border-radius:10px;font-size:22px;cursor:pointer}
      .v228-order-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0}
      .v228-order-grid .full{grid-column:1/-1}
      .v228-items{display:grid;gap:12px}
      .v228-item{border:1px solid #d0d5dd;border-radius:14px;padding:14px;background:#f9fafb}
      .v228-item-grid{display:grid;grid-template-columns:1.05fr 2fr .7fr .7fr 1fr;gap:10px}
      .v228-card label{display:block;font-weight:700;color:#344054}
      .v228-card input,.v228-card select,.v228-card textarea{width:100%;margin-top:5px;box-sizing:border-box}
      .v228-card textarea{min-height:72px}
      .v228-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px;position:sticky;bottom:-20px;background:#fff;padding:14px 0 4px}
      .v228-msg{margin-top:10px;font-size:13px}
      .v228-msg.error{color:#b42318}.v228-msg.success{color:#067647}
      .v228-deadline{display:inline-block;margin:5px 0 0 8px;padding:3px 7px;border-radius:999px;background:#fff4e5;color:#b54708;font-size:11px;font-weight:800;white-space:nowrap}
      .v228-adminbox{border:1px solid #e4e7ec;border-radius:13px;background:#fff;padding:13px;margin-top:12px}
      .v228-admin-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}
      .v228-recycle-card{border:1px solid #e4e7ec;border-radius:12px;padding:12px;background:#fff;margin-bottom:10px}
      @media(max-width:800px){
        .v228-order-grid,.v228-item-grid,.v228-admin-grid{grid-template-columns:1fr}
        .v228-order-grid .full{grid-column:auto}
        .v228-overlay{padding:6px;align-items:flex-end}
        .v228-card{border-radius:18px 18px 8px 8px;max-height:94vh}
        #tab-tracking .metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
        #tab-tracking .table-wrap{max-height:calc(100vh - 385px);min-height:300px}
      }
    `;
    document.head.appendChild(st);
  }

  function statusName(s) {
    return ({new:'新訂單',vendor_unconfirmed:'待廠商確認',vendor_confirmed:'廠商已確認',preparing:'備貨中',shipped:'已出貨',completed:'已完成',cancelled:'已取消',out_of_stock:'缺貨',delayed:'延後'})[s] || s;
  }

  function ensureEditModal() {
    if ($('v228EditModal')) return;
    const d = document.createElement('div');
    d.id = 'v228EditModal';
    d.className = 'v228-overlay hidden';
    d.innerHTML = `<div class="v228-card">
      <div class="v228-head"><div><h2 id="v228EditTitle">編輯訂單</h2><div class="muted">ADMIN／員工可修改訂單、商品編號與逐品項最晚交期。</div></div><button class="v228-close" type="button" data-v228-close>×</button></div>
      <div id="v228OrderFields"></div>
      <div id="v228ItemFields" class="v228-items"></div>
      <div id="v228EditMsg" class="v228-msg"></div>
      <div class="v228-actions"><button type="button" class="btn ghost" data-v228-close>取消</button><button type="button" id="v228SaveEdit" class="btn primary">儲存修改</button></div>
    </div>`;
    document.body.appendChild(d);
    d.querySelectorAll('[data-v228-close]').forEach(b => b.addEventListener('click', () => d.classList.add('hidden')));
    $('v228SaveEdit').addEventListener('click', saveEdit);
  }

  async function openEdit(orderId) {
    const p = await ownProfile().catch(() => null);
    if (!canManage(p)) return;
    ensureEditModal();
    const modal = $('v228EditModal');
    modal.classList.remove('hidden');
    $('v228EditTitle').textContent = '編輯訂單';
    $('v228OrderFields').innerHTML = '<div class="muted" style="padding:16px 0">載入中…</div>';
    $('v228ItemFields').innerHTML = '';
    $('v228EditMsg').textContent = '';
    try {
      const [orows, irows] = await Promise.all([
        rest(`orders?select=*&id=eq.${encodeURIComponent(orderId)}`),
        rest(`order_items?select=*&order_id=eq.${encodeURIComponent(orderId)}&order=sort_order.asc`)
      ]);
      editOrder = orows?.[0] || null;
      editItems = irows || [];
      if (!editOrder) throw new Error('找不到訂單');
      $('v228EditTitle').textContent = `編輯 ORD-${String(editOrder.tracking_id || '').padStart(6,'0')}`;
      const statuses = ['new','vendor_unconfirmed','vendor_confirmed','preparing','shipped','completed','cancelled','out_of_stock','delayed'];
      $('v228OrderFields').innerHTML = `<div class="v228-order-grid">
        <label>訂購日<input id="v228OrderDate" type="date" value="${esc(editOrder.order_date || '')}"></label>
        <label>訂貨人<input id="v228Buyer" value="${esc(editOrder.buyer || '')}"></label>
        <label>收貨人<input id="v228Receiver" value="${esc(editOrder.receiver || '')}"></label>
        <label>電話<input id="v228Phone" value="${esc(editOrder.receiver_phone || '')}"></label>
        <label>運費<input id="v228Fee" value="${esc(editOrder.shipping_fee_text || '')}"></label>
        <label>狀態<select id="v228Status">${statuses.map(s => `<option value="${s}" ${editOrder.status===s?'selected':''}>${statusName(s)}</option>`).join('')}</select></label>
        <label class="full">收貨地址<textarea id="v228Address">${esc(editOrder.receiver_address || '')}</textarea></label>
      </div>`;
      $('v228ItemFields').innerHTML = editItems.map((x,i) => `<div class="v228-item" data-v228-item="${esc(x.id)}"><b>品項 ${i+1}</b>
        <div class="v228-item-grid" style="margin-top:8px">
          <label>商品編號<input data-f="product_code" maxlength="10" value="${esc(x.product_code || '')}"></label>
          <label>商品名稱<input data-f="product_name" value="${esc(x.product_name || '')}"></label>
          <label>數量<input data-f="quantity" type="number" min="0" step="any" value="${esc(x.quantity ?? '')}"></label>
          <label>單位<input data-f="quantity_unit" value="${esc(x.quantity_unit || '')}"></label>
          <label>最晚交期<input data-f="expected_deadline" type="date" value="${esc(x.expected_deadline || '')}"></label>
        </div>
        <label style="margin-top:8px">規格／備註<input data-f="variant" value="${esc(x.variant || '')}"></label>
      </div>`).join('') || '<div class="muted">此訂單沒有商品明細。</div>';
    } catch (e) {
      $('v228OrderFields').innerHTML = '';
      $('v228EditMsg').textContent = `載入失敗：${e.message}`;
      $('v228EditMsg').className = 'v228-msg error';
    }
  }

  async function saveEdit() {
    if (!editOrder) return;
    const p = await ownProfile().catch(() => null);
    if (!canManage(p)) return;
    const btn = $('v228SaveEdit');
    const msg = $('v228EditMsg');
    btn.disabled = true;
    btn.textContent = '儲存中…';
    msg.textContent = '';
    msg.className = 'v228-msg';
    try {
      await rest(`orders?id=eq.${encodeURIComponent(editOrder.id)}`, {
        method:'PATCH',
        headers:{Prefer:'return=minimal'},
        body:JSON.stringify({
          order_date:$('v228OrderDate')?.value || editOrder.order_date,
          buyer:$('v228Buyer')?.value.trim() || null,
          receiver:$('v228Receiver')?.value.trim() || null,
          receiver_phone:$('v228Phone')?.value.trim() || null,
          receiver_address:$('v228Address')?.value.trim() || null,
          shipping_fee_text:$('v228Fee')?.value.trim() || null,
          status:$('v228Status')?.value || editOrder.status,
          updated_at:new Date().toISOString()
        })
      });
      const dates = [];
      for (const card of document.querySelectorAll('#v228ItemFields [data-v228-item]')) {
        const id = card.dataset.v228Item;
        const val = f => card.querySelector(`[data-f="${f}"]`)?.value ?? '';
        const code = val('product_code').trim();
        if (code.length > 10) throw new Error(`商品編號 ${code} 超過 10 碼`);
        const deadline = val('expected_deadline') || null;
        if (deadline) dates.push(deadline);
        const qRaw = val('quantity');
        await rest(`order_items?id=eq.${encodeURIComponent(id)}`, {
          method:'PATCH',
          headers:{Prefer:'return=minimal'},
          body:JSON.stringify({
            product_code:code || null,
            product_name:val('product_name').trim() || null,
            quantity:qRaw === '' ? null : Number(qRaw),
            quantity_unit:val('quantity_unit').trim() || null,
            expected_deadline:deadline,
            variant:val('variant').trim() || null
          })
        });
      }
      dates.sort();
      if (dates.length) {
        await rest(`orders?id=eq.${encodeURIComponent(editOrder.id)}`, {
          method:'PATCH',
          headers:{Prefer:'return=minimal'},
          body:JSON.stringify({expected_from:dates[0],expected_deadline:dates[dates.length-1],lead_time_text:'人工調整'})
        });
      }
      deadlineCache = null;
      msg.textContent = '儲存成功。';
      msg.className = 'v228-msg success';
      setTimeout(() => window.location.reload(), 450);
    } catch (e) {
      msg.textContent = `儲存失敗：${e.message}`;
      msg.className = 'v228-msg error';
      btn.disabled = false;
      btn.textContent = '儲存修改';
    }
  }

  async function deadlineRows(force = false) {
    if (force) deadlineCache = null;
    if (deadlineCache) return deadlineCache;
    if (deadlinePromise) return deadlinePromise;
    deadlinePromise = rest('order_item_shipping_overview?select=*&order=order_no.asc,sort_order.asc')
      .then(rows => deadlineCache = rows || [])
      .finally(() => { deadlinePromise = null; });
    return deadlinePromise;
  }

  async function enhanceDeadlines() {
    const p = await ownProfile().catch(() => null);
    if (!p) return;
    const all = await deadlineRows().catch(() => []);
    if (canManage(p)) {
      const table = $('orderRows')?.closest('table');
      const heads = [...(table?.querySelectorAll('thead th') || [])];
      const pi = heads.findIndex(th => /商品編號|商品名稱|^商品$/.test(th.textContent.trim()));
      if (pi < 0) return;
      document.querySelectorAll('#orderRows tr').forEach(tr => {
        const orderId = tr.querySelector('[data-save-status]')?.dataset.saveStatus;
        if (!orderId) return;
        const list = all.filter(x => x.order_id === orderId).sort((a,b) => Number(a.sort_order||0)-Number(b.sort_order||0));
        const cell = tr.children[pi];
        if (!cell || !list.length) return;
        const adminRows = [...cell.querySelectorAll('.admin-item-row')];
        if (adminRows.length) {
          adminRows.forEach((row,i) => {
            const d = list[i]?.expected_deadline;
            if (!d) return;
            let chip = row.querySelector('.v228-deadline,.item-deadline-chip');
            if (!chip) {
              chip = document.createElement('span');
              chip.className = 'v228-deadline';
              row.querySelector('.admin-item-name')?.appendChild(chip);
            }
            const text = `最晚交期 ${d}`;
            if (chip.textContent !== text) chip.textContent = text;
          });
        }
      });
    } else if (p.role === 'vendor') {
      document.querySelectorAll('#vendorOrders .item-pick-row').forEach(row => {
        const id = row.querySelector('[data-item-select]')?.dataset.itemSelect;
        const d = all.find(x => x.order_item_id === id)?.expected_deadline;
        if (!id || !d) return;
        let chip = row.querySelector('.v228-deadline,.item-deadline-chip');
        if (!chip) {
          chip = document.createElement('span');
          chip.className = 'v228-deadline';
          row.querySelector('.item-pick-main > div')?.appendChild(chip);
        }
        const text = `最晚交期 ${d}`;
        if (chip.textContent !== text) chip.textContent = text;
      });
    }
  }

  function isDoneRow(row) {
    const status = row.querySelector('select[id^="status-"]')?.value || '';
    return status === 'shipped' || status === 'completed' || !!row.querySelector('.badge.completed');
  }

  function ensureTrackingControls() {
    const filters = document.querySelector('#tab-tracking .filters');
    if (!filters) return;
    if (!$('v228OrderSort')) {
      const sel = document.createElement('select');
      sel.id = 'v228OrderSort';
      sel.innerHTML = '<option value="asc">訂單編號：小 → 大</option><option value="desc">訂單編號：大 → 小</option>';
      sel.value = localStorage.getItem('vendor_order_sort_direction') === 'desc' ? 'desc' : 'asc';
      filters.appendChild(sel);
      sel.addEventListener('change', () => {
        localStorage.setItem('vendor_order_sort_direction', sel.value);
        safeSortRows();
      });
    }
    if (!$('v228HideShipped')) {
      const label = document.createElement('label');
      label.className = 'filter-toggle';
      label.innerHTML = '<input id="v228HideShipped" type="checkbox"> <span>隱藏已出貨／完成</span>';
      filters.appendChild(label);
      const cb = $('v228HideShipped');
      cb.checked = localStorage.getItem('vendor_order_hide_shipped') !== '0';
      cb.addEventListener('change', () => {
        localStorage.setItem('vendor_order_hide_shipped', cb.checked ? '1' : '0');
        applyHideShipped();
      });
    }
  }

  function applyHideShipped() {
    const hide = $('v228HideShipped')?.checked ?? true;
    document.querySelectorAll('#orderRows > tr').forEach(row => {
      row.style.display = hide && isDoneRow(row) ? 'none' : '';
    });
  }

  function alertRank(row) {
    if (row.querySelector('.badge.overdue')) return 0;
    if (row.querySelector('.badge.due_soon')) return 1;
    return 2;
  }

  function orderNo(row) {
    const m = (row.textContent || '').match(/ORD-\s*0*(\d+)/i);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  }

  function safeSortRows() {
    const body = $('orderRows');
    if (!body) return;
    const rows = [...body.querySelectorAll(':scope > tr')].filter(r => r.querySelector('[data-save-status]'));
    if (rows.length < 2) return;
    const dir = $('v228OrderSort')?.value || 'asc';
    const index = new Map(rows.map((r,i) => [r,i]));
    const sorted = [...rows].sort((a,b) => {
      const ar = alertRank(a), br = alertRank(b);
      if (ar !== br) return ar - br;
      if (ar < 2) return index.get(a) - index.get(b);
      const an = orderNo(a), bn = orderNo(b);
      return dir === 'desc' ? bn - an : an - bn;
    });
    if (sorted.every((r,i) => r === rows[i])) return;
    const frag = document.createDocumentFragment();
    sorted.forEach(r => frag.appendChild(r));
    body.appendChild(frag);
  }

  function selectedIds() {
    return [...document.querySelectorAll('#orderRows .v228-select:checked')].map(x => x.dataset.id).filter(Boolean);
  }

  function updateBulk() {
    const ids = selectedIds();
    if ($('v228BulkCount')) $('v228BulkCount').textContent = `已選 ${ids.length} 筆`;
    if ($('v228BulkDelete')) $('v228BulkDelete').disabled = !ids.length;
  }

  function ensureBulkBar() {
    if ($('v228BulkBar')) return;
    const filters = document.querySelector('#tab-tracking .filters');
    if (!filters) return;
    const d = document.createElement('div');
    d.id = 'v228BulkBar';
    d.innerHTML = '<b id="v228BulkCount">已選 0 筆</b><button id="v228SelectVisible" class="btn ghost">全選目前顯示</button><button id="v228ClearSelected" class="btn ghost">取消全選</button><button id="v228BulkDelete" class="btn secondary" disabled>移到回收桶</button>';
    filters.insertAdjacentElement('afterend', d);
    $('v228SelectVisible').addEventListener('click', () => {
      document.querySelectorAll('#orderRows > tr').forEach(row => {
        if (getComputedStyle(row).display === 'none') return;
        const cb = row.querySelector('.v228-select');
        if (cb) cb.checked = true;
      });
      updateBulk();
    });
    $('v228ClearSelected').addEventListener('click', () => {
      document.querySelectorAll('#orderRows .v228-select').forEach(cb => cb.checked = false);
      updateBulk();
    });
    $('v228BulkDelete').addEventListener('click', async () => {
      const ids = selectedIds();
      if (!ids.length || !confirm(`將 ${ids.length} 筆訂單移到回收桶？`)) return;
      try {
        await adminOrders('recycle_orders', ids);
        window.location.reload();
      } catch (e) { alert(`移動失敗：${e.message}`); }
    });
  }

  function enhanceActionRows() {
    document.querySelectorAll('#orderRows > tr').forEach(row => {
      const save = row.querySelector('[data-save-status]');
      if (!save) return;
      const id = save.dataset.saveStatus;
      const first = row.firstElementChild;
      if (first && !first.querySelector('.v228-select')) {
        const lab = document.createElement('label');
        lab.className = 'v228-row-check';
        lab.innerHTML = `<input type="checkbox" class="v228-select" data-id="${esc(id)}">選取`;
        first.appendChild(lab);
        lab.querySelector('input').addEventListener('change', updateBulk);
      }
      const action = row.lastElementChild;
      if (action && !action.querySelector('[data-v228-edit]')) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn small v228-action v228-edit';
        b.dataset.v228Edit = id;
        b.textContent = '編輯訂單';
        action.appendChild(b);
      }
      if (action && !action.querySelector('[data-v228-delete]')) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn small v228-action v228-delete';
        b.dataset.v228Delete = id;
        b.textContent = '刪除';
        action.appendChild(b);
      }
    });
  }

  async function loadHistory() {
    const rows = $('historyRows');
    if (!rows) return;
    rows.innerHTML = '<tr><td colspan="5" class="muted">載入中…</td></tr>';
    try {
      const [events, ords] = await Promise.all([
        rest('line_events?select=id,received_at,source_type,raw_text,parse_status,parse_error,parsed_payload,created_order_id&order=received_at.desc&limit=500'),
        rest('orders?select=id,tracking_id')
      ]);
      const map = new Map((ords || []).map(o => [o.id, `ORD-${String(o.tracking_id).padStart(6,'0')}`]));
      window.__V228_HISTORY__ = {events:events || [], map};
      renderHistory();
    } catch (e) {
      rows.innerHTML = `<tr><td colspan="5" class="muted">載入失敗：${esc(e.message)}</td></tr>`;
    }
  }

  function renderHistory() {
    const state = window.__V228_HISTORY__;
    const rows = $('historyRows');
    if (!state || !rows) return;
    const q = ($('historySearch')?.value || '').trim().toLowerCase();
    const st = $('historyStatus')?.value || '';
    const list = state.events.filter(e => {
      const vendor = e.parsed_payload?.shipper || '';
      const ord = state.map.get(e.created_order_id) || '';
      const hay = `${e.raw_text || ''} ${vendor} ${ord} ${e.parse_error || ''}`.toLowerCase();
      return (!q || hay.includes(q)) && (!st || e.parse_status === st);
    });
    if ($('historySummary')) $('historySummary').textContent = `共 ${state.events.length} 筆，目前顯示 ${list.length} 筆。`;
    rows.innerHTML = list.map(e => {
      const ord = state.map.get(e.created_order_id) || (e.parse_status === 'ignored' ? '不建立' : '—');
      const vendor = e.parsed_payload?.shipper || '—';
      return `<tr><td>${esc(new Date(e.received_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}))}</td><td>${esc(e.parse_status)}${e.parse_error?`<br><span class="muted">${esc(e.parse_error)}</span>`:''}</td><td><b>${esc(ord)}</b></td><td>${esc(vendor)}</td><td><details><summary>查看原始訊息</summary><pre style="white-space:pre-wrap">${esc(e.raw_text || '')}</pre></details></td></tr>`;
    }).join('') || '<tr><td colspan="5" class="muted">沒有符合條件的紀錄。</td></tr>';
  }

  function ensureHistoryHandlers() {
    const tab = document.querySelector('.tab[data-tab="history"]');
    if (tab && tab.dataset.v228Bound !== '1') {
      tab.dataset.v228Bound = '1';
      tab.addEventListener('click', () => setTimeout(loadHistory, 0));
    }
    if ($('reloadHistoryBtn') && $('reloadHistoryBtn').dataset.v228Bound !== '1') {
      $('reloadHistoryBtn').dataset.v228Bound = '1';
      $('reloadHistoryBtn').addEventListener('click', loadHistory);
    }
    if ($('historySearch') && $('historySearch').dataset.v228Bound !== '1') {
      $('historySearch').dataset.v228Bound = '1';
      $('historySearch').addEventListener('input', renderHistory);
    }
    if ($('historyStatus') && $('historyStatus').dataset.v228Bound !== '1') {
      $('historyStatus').dataset.v228Bound = '1';
      $('historyStatus').addEventListener('change', renderHistory);
    }
  }

  function switchTab(name) {
    document.querySelectorAll('#adminView .tab').forEach(x => x.classList.toggle('active', x.dataset.tab === name));
    document.querySelectorAll('#adminView .tab-panel').forEach(x => x.classList.add('hidden'));
    $(`tab-${name}`)?.classList.remove('hidden');
  }

  function ensureRecycleTab() {
    const nav = document.querySelector('#adminView .tabs');
    if (!nav) return;
    let tab = nav.querySelector('.tab[data-tab="recycle"]');
    if (!tab) {
      tab = document.createElement('button');
      tab.className = 'tab';
      tab.dataset.tab = 'recycle';
      tab.textContent = '🗑️ 回收桶';
      nav.appendChild(tab);
    }
    if (!$('tab-recycle')) {
      const panel = document.createElement('div');
      panel.id = 'tab-recycle';
      panel.className = 'tab-panel hidden';
      panel.innerHTML = `<div class="card section-card"><div class="section-head"><div><h2>回收桶</h2><p class="muted">可還原或永久刪除訂單。</p></div><button id="v228RecycleReload" class="btn ghost">重新整理</button></div><div id="v228RecycleList"></div></div>`;
      $('adminView').appendChild(panel);
      $('v228RecycleReload').addEventListener('click', loadRecycle);
    }
    if (tab.dataset.v228Bound !== '1') {
      tab.dataset.v228Bound = '1';
      tab.addEventListener('click', () => { switchTab('recycle'); loadRecycle(); });
    }
  }

  async function loadRecycle() {
    const box = $('v228RecycleList');
    if (!box) return;
    box.innerHTML = '<div class="muted">載入中…</div>';
    try {
      const rows = await rest('recycle_bin_orders?select=id,order_no,order_date,buyer,receiver,vendor_name,deleted_at,deleted_reason&order=deleted_at.desc&limit=500');
      box.innerHTML = (rows || []).map(r => `<div class="v228-recycle-card"><b>${esc(r.order_no)}</b>｜${esc(r.vendor_name || '—')}<div class="muted">訂購日 ${esc(r.order_date || '—')}｜訂貨人 ${esc(r.buyer || '—')}｜收貨人 ${esc(r.receiver || '—')}</div><div class="muted">刪除時間 ${esc(r.deleted_at || '—')}</div><div style="margin-top:8px"><button class="btn secondary" data-v228-restore="${esc(r.id)}">還原</button> <button class="btn danger-outline" data-v228-purge="${esc(r.id)}">永久刪除</button></div></div>`).join('') || '<div class="muted">回收桶目前是空的。</div>';
      box.querySelectorAll('[data-v228-restore]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('還原此訂單？')) return;
        try { await adminOrders('restore_orders',[b.dataset.v228Restore]); loadRecycle(); } catch(e) { alert(e.message); }
      }));
      box.querySelectorAll('[data-v228-purge]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('永久刪除此訂單？此動作無法還原。')) return;
        try { await adminOrders('purge_orders',[b.dataset.v228Purge]); loadRecycle(); } catch(e) { alert(e.message); }
      }));
    } catch(e) {
      box.innerHTML = `<div class="message error">載入失敗：${esc(e.message)}</div>`;
    }
  }

  function ensureEmployeeTab() {
    const nav = document.querySelector('#adminView .tabs');
    if (!nav) return;
    let tab = nav.querySelector('.tab[data-tab="employees"]');
    if (!tab) {
      tab = document.createElement('button');
      tab.className = 'tab';
      tab.dataset.tab = 'employees';
      tab.textContent = '員工帳號';
      const vendorTab = nav.querySelector('.tab[data-tab="vendors"]');
      vendorTab?.insertAdjacentElement('afterend', tab);
    }
    if (!$('tab-employees')) {
      const panel = document.createElement('div');
      panel.id = 'tab-employees';
      panel.className = 'tab-panel hidden';
      panel.innerHTML = `<div class="card section-card"><div class="section-head"><div><h2>員工帳號管理</h2><p class="muted">員工與 ADMIN 均有完整操作權限。</p></div><button id="v228EmployeeReload" class="btn ghost">重新整理</button></div>
        <div class="v228-adminbox"><h3>建立員工</h3><div class="v228-admin-grid"><label>姓名<input id="v228EmployeeName"></label><label>登入帳號<input id="v228EmployeeLogin" placeholder="STAFF01"></label></div><label>初始密碼<input id="v228EmployeePassword" type="text" value="Staff@2026!"></label><button id="v228CreateEmployee" class="btn primary">建立員工</button></div>
        <div id="v228EmployeeList" class="v228-admin-grid"></div></div>`;
      $('adminView').appendChild(panel);
      $('v228EmployeeReload').addEventListener('click', loadEmployees);
      $('v228CreateEmployee').addEventListener('click', createEmployee);
    }
    if (tab.dataset.v228Bound !== '1') {
      tab.dataset.v228Bound = '1';
      tab.addEventListener('click', () => { switchTab('employees'); loadEmployees(); });
    }
  }

  async function loadEmployees() {
    const box = $('v228EmployeeList');
    if (!box) return;
    box.innerHTML = '<div class="muted">載入中…</div>';
    try {
      const rows = await rest('user_profiles?select=user_id,display_name,login_name,active,must_change_password&role=eq.employee&order=created_at.asc');
      box.innerHTML = (rows || []).map(p => `<div class="v228-adminbox"><h3>${esc(p.display_name || p.login_name)}</h3><div>帳號：<b>${esc(p.login_name)}</b></div><div class="muted">${p.active?'啟用':'停用'}｜${p.must_change_password?'待首次改密碼':'已完成密碼設定'}</div><div style="margin-top:8px"><button class="btn small secondary" data-v228-reset-employee="${esc(p.user_id)}" data-login="${esc(p.login_name)}" data-name="${esc(p.display_name || p.login_name)}">重設密碼</button> <button class="btn small ghost" data-v228-toggle-employee="${esc(p.user_id)}" data-active="${p.active?'1':'0'}">${p.active?'停用':'啟用'}</button></div></div>`).join('') || '<div class="muted">尚無員工。</div>';
      box.querySelectorAll('[data-v228-reset-employee]').forEach(b => b.addEventListener('click', async () => {
        const pw = prompt(`輸入 ${b.dataset.login} 的新臨時密碼（至少8碼）：`, 'Staff@2026!');
        if (!pw) return;
        try { await edge({action:'employee_account',user_id:b.dataset.v228ResetEmployee,login_name:b.dataset.login,display_name:b.dataset.name,password:pw}); alert('已重設密碼。'); loadEmployees(); } catch(e) { alert(e.message); }
      }));
      box.querySelectorAll('[data-v228-toggle-employee]').forEach(b => b.addEventListener('click', async () => {
        const next = b.dataset.active !== '1';
        if (!confirm(`確定${next?'啟用':'停用'}此員工？`)) return;
        try { await edge({action:'employee_active',user_id:b.dataset.v228ToggleEmployee,active:next}); loadEmployees(); } catch(e) { alert(e.message); }
      }));
    } catch(e) {
      box.innerHTML = `<div class="message error">載入失敗：${esc(e.message)}</div>`;
    }
  }

  async function createEmployee() {
    try {
      const name = $('v228EmployeeName').value.trim();
      const login = $('v228EmployeeLogin').value.trim();
      const password = $('v228EmployeePassword').value;
      if (!name || !login || password.length < 8) return alert('請輸入姓名、帳號與至少8碼密碼。');
      const d = await edge({action:'employee_account',display_name:name,login_name:login,password});
      alert(`已建立 ${d.username || login}`);
      $('v228EmployeeName').value = '';
      $('v228EmployeeLogin').value = '';
      loadEmployees();
    } catch(e) { alert(e.message); }
  }

  function ensurePasswordUI(p) {
    const logout = $('logoutBtn');
    if (!logout || !canManage(p) || $('v228PasswordBtn') || !$('loginView')?.classList.contains('hidden')) return;
    const b = document.createElement('button');
    b.id = 'v228PasswordBtn';
    b.className = 'btn ghost';
    b.textContent = '修改密碼';
    logout.parentElement?.insertBefore(b, logout);
    b.addEventListener('click', () => openPassword(false));
  }

  function ensurePasswordModal() {
    if ($('v228PasswordModal')) return;
    const d = document.createElement('div');
    d.id = 'v228PasswordModal';
    d.className = 'v228-overlay hidden';
    d.innerHTML = `<div class="v228-card" style="width:min(480px,100%)"><div class="v228-head"><div><h2>修改密碼</h2><div class="muted">新密碼至少 8 碼。</div></div><button class="v228-close" type="button" data-v228-pass-close>×</button></div><label style="margin-top:14px">新密碼<input id="v228Pass1" type="password"></label><label>再次輸入<input id="v228Pass2" type="password"></label><div id="v228PassMsg" class="v228-msg"></div><div class="v228-actions"><button class="btn ghost" type="button" data-v228-pass-close>取消</button><button id="v228PassSave" class="btn primary" type="button">儲存新密碼</button></div></div>`;
    document.body.appendChild(d);
    d.querySelectorAll('[data-v228-pass-close]').forEach(b => b.addEventListener('click', () => d.classList.add('hidden')));
    $('v228PassSave').addEventListener('click', savePassword);
  }

  function openPassword(forced) {
    ensurePasswordModal();
    const m = $('v228PasswordModal');
    m.dataset.forced = forced ? '1' : '0';
    m.classList.remove('hidden');
    $('v228Pass1').value = '';
    $('v228Pass2').value = '';
    $('v228PassMsg').textContent = forced ? '首次登入，請先修改密碼。' : '';
    if (forced) m.querySelectorAll('[data-v228-pass-close]').forEach(b => b.style.display = 'none');
  }

  async function savePassword() {
    const a = $('v228Pass1').value;
    const b = $('v228Pass2').value;
    const msg = $('v228PassMsg');
    if (a.length < 8) { msg.textContent = '新密碼至少 8 碼。'; msg.className = 'v228-msg error'; return; }
    if (a !== b) { msg.textContent = '兩次密碼不一致。'; msg.className = 'v228-msg error'; return; }
    try {
      $('v228PassSave').disabled = true;
      await edge({action:'change_password',password:a});
      msg.textContent = '密碼修改成功。';
      msg.className = 'v228-msg success';
      profileCache = null;
      setTimeout(() => window.location.reload(), 450);
    } catch(e) {
      msg.textContent = e.message;
      msg.className = 'v228-msg error';
      $('v228PassSave').disabled = false;
    }
  }

  function normalizeVendorDom() {
    const root = $('vendorOrders');
    if (!root) return;
    root.querySelectorAll('.vendor-order').forEach(card => {
      card.classList.add('order-card');
      card.querySelector('.item-box')?.classList.add('order-products');
      const save = card.querySelector('[data-vsave]');
      if (save) {
        save.dataset.vendorSave = save.dataset.vsave || '';
        save.classList.add('legacy-order-shipping');
      }
      card.querySelectorAll('.form-grid').forEach(x => x.classList.add('legacy-order-shipping'));
    });
  }

  function vendorOrderNo(card) {
    const m = (card.textContent || '').match(/ORD-\s*0*(\d+)/i);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  }

  function vendorPriority(card) {
    if (card.querySelector('.badge.overdue')) return 0;
    if (card.querySelector('.badge.due_soon')) return 1;
    return 2;
  }

  function safeSortVendor() {
    const root = $('vendorOrders');
    if (!root) return;
    const cards = [...root.querySelectorAll(':scope > .vendor-order,:scope > .order-card')];
    if (cards.length < 2) return;
    const sorted = [...cards].sort((a,b) => vendorPriority(a)-vendorPriority(b) || vendorOrderNo(a)-vendorOrderNo(b));
    if (sorted.every((c,i) => c === cards[i])) return;
    const f = document.createDocumentFragment();
    sorted.forEach(c => f.appendChild(c));
    root.appendChild(f);
  }

  function ensureVendorHideToggle() {
    const root = $('vendorOrders');
    if (!root || $('v228VendorHide')) return;
    const label = document.createElement('label');
    label.className = 'filter-toggle';
    label.style.marginBottom = '10px';
    label.innerHTML = '<input id="v228VendorHide" type="checkbox"> <span>隱藏已出貨商品／完成訂單</span>';
    root.parentElement?.insertBefore(label, root);
    const cb = $('v228VendorHide');
    cb.checked = localStorage.getItem('vendor_order_show_shipped') !== '1';
    cb.addEventListener('change', () => {
      localStorage.setItem('vendor_order_show_shipped', cb.checked ? '0' : '1');
      applyVendorHide();
    });
  }

  function applyVendorHide() {
    const hide = $('v228VendorHide')?.checked ?? true;
    document.querySelectorAll('#vendorOrders .item-pick-row.is-shipped').forEach(x => x.style.display = hide ? 'none' : '');
    document.querySelectorAll('#vendorOrders .vendor-order,#vendorOrders .order-card').forEach(card => {
      const picks = [...card.querySelectorAll('.item-pick-row')];
      if (picks.length) card.style.display = hide && picks.every(x => x.classList.contains('is-shipped')) ? 'none' : '';
    });
  }

  function scheduleEnhance() {
    clearTimeout(enhanceTimer);
    enhanceTimer = setTimeout(async () => {
      const p = await ownProfile().catch(() => null);
      if (!p) return;
      setVersion();
      if (canManage(p)) {
        ensureTrackingControls();
        ensureBulkBar();
        enhanceActionRows();
        safeSortRows();
        applyHideShipped();
        ensureHistoryHandlers();
        ensureRecycleTab();
        ensureEmployeeTab();
        ensurePasswordUI(p);
        enhanceDeadlines();
      } else if (p.role === 'vendor') {
        normalizeVendorDom();
        safeSortVendor();
        ensureVendorHideToggle();
        applyVendorHide();
        enhanceDeadlines();
      }
    }, 40);
  }

  async function activate(force = false) {
    injectStyles();
    setVersion();
    const p = await ownProfile(force).catch(() => null);
    if (!p) return;
    document.body.dataset.appRole = p.role;
    window.dispatchEvent(new CustomEvent('vendor-role-ready',{detail:{role:p.role}}));
    if (canManage(p)) {
      ensureEditModal();
      ensurePasswordModal();
      ensureTrackingControls();
      ensureBulkBar();
      enhanceActionRows();
      safeSortRows();
      applyHideShipped();
      ensureHistoryHandlers();
      ensureRecycleTab();
      ensureEmployeeTab();
      ensurePasswordUI(p);
      if (p.must_change_password && p.role === 'employee') openPassword(true);
      enhanceDeadlines();
      const body = $('orderRows');
      if (body && body.dataset.v228Observed !== '1') {
        body.dataset.v228Observed = '1';
        new MutationObserver(scheduleEnhance).observe(body,{childList:true,subtree:true});
      }
    } else if (p.role === 'vendor') {
      normalizeVendorDom();
      safeSortVendor();
      ensureVendorHideToggle();
      applyVendorHide();
      enhanceDeadlines();
      const root = $('vendorOrders');
      if (root && root.dataset.v228Observed !== '1') {
        root.dataset.v228Observed = '1';
        new MutationObserver(scheduleEnhance).observe(root,{childList:true,subtree:true});
      }
    }
  }

  function bindGlobalEvents() {
    document.addEventListener('click', async e => {
      const edit = e.target.closest?.('[data-v228-edit]');
      if (edit) { e.preventDefault(); openEdit(edit.dataset.v228Edit); return; }
      const del = e.target.closest?.('[data-v228-delete]');
      if (del) {
        e.preventDefault();
        if (!confirm('確定將此訂單移到回收桶？')) return;
        try { await adminOrders('recycle_orders',[del.dataset.v228Delete]); window.location.reload(); }
        catch(err) { alert(`刪除失敗：${err.message}`); }
      }
    });

    ['searchInput','vendorFilter','alertFilter'].forEach(id => {
      $(id)?.addEventListener('input', () => setTimeout(scheduleEnhance,0));
      $(id)?.addEventListener('change', () => setTimeout(scheduleEnhance,0));
    });

    const login = $('loginView');
    if (login) {
      new MutationObserver(() => {
        if (login.classList.contains('hidden')) {
          profileCache = null;
          setTimeout(() => activate(true), 80);
        }
      }).observe(login,{attributes:true,attributeFilter:['class']});
    }
    $('logoutBtn')?.addEventListener('click', () => {
      profileCache = null;
      localStorage.removeItem('vendor_order_role');
    });
  }

  function boot() {
    injectStyles();
    setVersion();
    bindGlobalEvents();
    setTimeout(() => activate(true), 120);
    setTimeout(() => activate(false), 700);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();