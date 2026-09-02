(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const SB = CFG.SUPABASE_URL;
  const $ = (id) => document.getElementById(id);

  function getSession() {
    try { return JSON.parse(localStorage.getItem('vendor_order_session') || 'null'); }
    catch { return null; }
  }

  function decodeJwt(token) {
    try {
      const p = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      const pad = p.length % 4 ? '='.repeat(4 - p.length % 4) : '';
      return JSON.parse(decodeURIComponent(escape(atob(p + pad))));
    } catch { return {}; }
  }

  function isAdmin() {
    const s = getSession();
    return decodeJwt(s?.access_token || '').app_metadata?.role === 'admin';
  }

  async function adminOrderAction(action, orderIds, extra = {}) {
    const s = getSession();
    if (!s?.access_token) throw new Error('登入已過期，請重新登入');
    const res = await fetch(`${SB}/functions/v1/admin-orders`, {
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${s.access_token}`},
      body:JSON.stringify({ action, order_ids:orderIds, ...extra })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function injectStyles() {
    if ($('bulkDeleteStyles')) return;
    const st = document.createElement('style');
    st.id = 'bulkDeleteStyles';
    st.textContent = `
      .bulk-delete-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0 2px;padding:10px 12px;border:1px solid #fedf89;background:#fffaeb;border-radius:10px}
      .bulk-delete-bar .bulk-count{font-weight:700;color:#93370d}
      .bulk-delete-btn{background:#b54708!important;color:#fff!important;border-color:#b54708!important}
      .bulk-delete-btn:disabled{opacity:.45;cursor:not-allowed}
      .order-select-cell,.order-select-head{width:42px;min-width:42px;max-width:42px;text-align:center!important;vertical-align:middle!important;padding-left:8px!important;padding-right:8px!important}
      .order-select-cell input,.order-select-head input{width:20px;height:20px;cursor:pointer}
      body.role-employee .bulk-delete-bar,body.role-employee .order-select-cell,body.role-employee .order-select-head{display:none!important}
    `;
    document.head.appendChild(st);
  }

  function orderIdFromRow(row) {
    return row.querySelector('[data-save-status]')?.dataset.saveStatus ||
      row.querySelector('[data-delete-order]')?.dataset.deleteOrder ||
      row.querySelector('[data-employee-edit]')?.dataset.employeeEdit || '';
  }

  function visibleSelectableRows() {
    const body = $('orderRows');
    if (!body) return [];
    return [...body.querySelectorAll('tr')].filter(row => {
      const cb = row.querySelector('.order-select-checkbox');
      if (!cb || row.classList.contains('shipped-hidden')) return false;
      return getComputedStyle(row).display !== 'none';
    });
  }

  function selectedIds() {
    return [...document.querySelectorAll('#orderRows .order-select-checkbox:checked')]
      .map(x => x.dataset.orderId).filter(Boolean);
  }

  function updateBulkState() {
    const ids = selectedIds();
    if ($('bulkSelectedCount')) $('bulkSelectedCount').textContent = `已選 ${ids.length} 筆`;
    if ($('bulkDeleteBtn')) $('bulkDeleteBtn').disabled = ids.length === 0;
    const all = $('selectAllOrders');
    if (all) {
      const rows = visibleSelectableRows();
      const checked = rows.filter(r => r.querySelector('.order-select-checkbox')?.checked).length;
      all.checked = rows.length > 0 && checked === rows.length;
      all.indeterminate = checked > 0 && checked < rows.length;
    }
  }

  function ensureBulkBar() {
    if (!isAdmin() || $('bulkDeleteBar')) return;
    const filters = document.querySelector('#tab-tracking .filters');
    if (!filters) return;
    const bar = document.createElement('div');
    bar.id = 'bulkDeleteBar';
    bar.className = 'bulk-delete-bar';
    bar.innerHTML = `
      <span class="bulk-count" id="bulkSelectedCount">已選 0 筆</span>
      <button type="button" id="selectVisibleBtn" class="btn ghost">全選目前顯示</button>
      <button type="button" id="clearSelectedBtn" class="btn ghost">取消全選</button>
      <button type="button" id="bulkDeleteBtn" class="btn bulk-delete-btn" disabled>移到回收桶</button>`;
    filters.insertAdjacentElement('afterend', bar);

    $('selectVisibleBtn').addEventListener('click', () => {
      visibleSelectableRows().forEach(row => {
        const cb=row.querySelector('.order-select-checkbox');
        if(cb) cb.checked=true;
      });
      updateBulkState();
    });
    $('clearSelectedBtn').addEventListener('click', () => {
      document.querySelectorAll('#orderRows .order-select-checkbox').forEach(cb => cb.checked=false);
      updateBulkState();
    });
    $('bulkDeleteBtn').addEventListener('click', bulkRecycleSelected);
  }

  function bindRowCheckbox(cb) {
    if (!cb || cb.dataset.bulkBound === '1') return;
    cb.dataset.bulkBound = '1';
    cb.addEventListener('change', updateBulkState);
  }

  function ensureRowSelectCell(row) {
    const orderId = orderIdFromRow(row);
    if (!orderId) return;
    let td = row.querySelector('.order-select-cell');
    if (!td) {
      td = document.createElement('td');
      td.className = 'order-select-cell';
      td.innerHTML = `<input type="checkbox" class="order-select-checkbox" data-order-id="${orderId}" aria-label="選取訂單">`;
      row.insertBefore(td,row.firstChild);
    }
    const cb = td.querySelector('.order-select-checkbox');
    if (cb) {
      cb.dataset.orderId = orderId;
      bindRowCheckbox(cb);
    }
  }

  function enhanceTable() {
    if (!isAdmin()) return;
    ensureBulkBar();
    const body = $('orderRows');
    const table = body?.closest('table');
    if (!body || !table) return;

    const headRow = table.querySelector('thead tr');
    if (headRow && !headRow.querySelector('.order-select-head')) {
      const th=document.createElement('th');
      th.className='order-select-head';
      th.innerHTML='<input type="checkbox" id="selectAllOrders" title="全選目前顯示">';
      headRow.insertBefore(th,headRow.firstChild);
      th.querySelector('input').addEventListener('change',e=>{
        visibleSelectableRows().forEach(row=>{
          const cb=row.querySelector('.order-select-checkbox');
          if(cb) cb.checked=e.target.checked;
        });
        updateBulkState();
      });
    }

    body.querySelectorAll('tr').forEach(row=>{
      const oldDelete = row.querySelector('[data-delete-order]');
      if (oldDelete) {
        oldDelete.textContent = '移到回收桶';
        oldDelete.title = '可從回收桶還原';
      }
      ensureRowSelectCell(row);
    });

    // 最後再校正一次：表頭有批次勾選欄時，每一筆有效訂單也必須有相同第一欄。
    if (headRow?.querySelector('.order-select-head')) {
      body.querySelectorAll('tr').forEach(row => {
        if (orderIdFromRow(row) && !row.firstElementChild?.classList.contains('order-select-cell')) {
          ensureRowSelectCell(row);
        }
      });
    }
    updateBulkState();
  }

  async function singleRecycle(btn) {
    const orderId=btn.dataset.deleteOrder;
    if(!orderId) return;
    const row=btn.closest('tr');
    const orderCell=row?.querySelector('.order-select-cell') ? row.cells?.[2] : row?.cells?.[1];
    const orderNo=orderCell?.querySelector('b')?.textContent?.trim() || '此訂單';
    if(!confirm(`確定將 ${orderNo} 移到回收桶？\n之後可以從「回收桶」還原。`)) return;
    btn.disabled=true;
    const old=btn.textContent;
    btn.textContent='移動中…';
    try{
      const d=await adminOrderAction('recycle_orders',[orderId],{reason:'ADMIN 單筆移到回收桶'});
      alert(`已移到回收桶：${d.moved_count || 0} 筆`);
      $('reloadBtn')?.click();
      window.dispatchEvent(new CustomEvent('recycle-bin-changed'));
    } catch(e) {
      alert(`移動失敗：${e.message}`);
      btn.disabled=false;
      btn.textContent=old||'移到回收桶';
    }
  }

  async function bulkRecycleSelected() {
    const ids=selectedIds();
    if(!ids.length) return;
    if(!confirm(`確定將已選取的 ${ids.length} 筆訂單移到回收桶？\n可於回收桶內還原。`)) return;
    const btn=$('bulkDeleteBtn');
    btn.disabled=true;
    btn.textContent='移動中…';
    try{
      const d=await adminOrderAction('recycle_orders',ids,{reason:'ADMIN 批次移到回收桶'});
      alert(`完成：${d.moved_count || 0} 筆已移到回收桶。`);
      document.querySelectorAll('#orderRows .order-select-checkbox').forEach(cb => cb.checked=false);
      $('reloadBtn')?.click();
      window.dispatchEvent(new CustomEvent('recycle-bin-changed'));
    } catch(e) {
      alert(`移動失敗：${e.message}`);
      btn.disabled=false;
      btn.textContent='移到回收桶';
    }
  }

  let reconcileTimer = null;
  function scheduleEnhance(delay=30) {
    clearTimeout(reconcileTimer);
    reconcileTimer=setTimeout(enhanceTable,delay);
  }

  function install() {
    injectStyles();
    if(!isAdmin()) return;
    ensureBulkBar();
    enhanceTable();
    const body=$('orderRows');
    if(body&&!body.dataset.bulkDeleteObserved){
      body.dataset.bulkDeleteObserved='1';
      new MutationObserver(()=>scheduleEnhance(20)).observe(body,{childList:true,subtree:true});
    }
    if(!document.documentElement.dataset.bulkDeleteClickInstalled){
      document.documentElement.dataset.bulkDeleteClickInstalled='1';
      document.addEventListener('click',e=>{
        const btn=e.target.closest?.('[data-delete-order]');
        if(!btn||!isAdmin()) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        singleRecycle(btn);
      },true);
    }
  }

  window.addEventListener('DOMContentLoaded',()=>{
    [100,300,700,1200,2000,3500].forEach(ms=>setTimeout(install,ms));
    $('loginBtn')?.addEventListener('click',()=>{
      [250,600,1000,1600,2600].forEach(ms=>setTimeout(install,ms));
    });
    ['searchInput','vendorFilter','alertFilter','hideShippedToggle','reloadBtn'].forEach(id=>{
      $(id)?.addEventListener('input',()=>scheduleEnhance(20));
      $(id)?.addEventListener('change',()=>scheduleEnhance(20));
      $(id)?.addEventListener('click',()=>scheduleEnhance(80));
    });
    // 其他相容模組可能在載入後再次重畫 tbody；短時間輪詢只做欄位校正。
    let checks=0;
    const timer=setInterval(()=>{
      if(++checks>20){clearInterval(timer);return;}
      if(isAdmin()) enhanceTable();
    },500);
  });
})();
