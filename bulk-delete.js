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

  async function deleteViaAdminApi(orderIds) {
    const s = getSession();
    if (!s?.access_token) throw new Error('登入已過期，請重新登入');
    const res = await fetch(`${SB}/functions/v1/admin-orders`, {
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${s.access_token}`},
      body:JSON.stringify({ action:'delete_orders', order_ids:orderIds })
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
      .bulk-delete-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0 2px;padding:10px 12px;border:1px solid #fecaca;background:#fff7f7;border-radius:10px}
      .bulk-delete-bar .bulk-count{font-weight:700;color:#991b1b}
      .bulk-delete-btn{background:#b42318!important;color:#fff!important;border-color:#b42318!important}
      .bulk-delete-btn:disabled{opacity:.45;cursor:not-allowed}
      .order-select-cell,.order-select-head{width:42px;text-align:center!important;vertical-align:middle!important}
      .order-select-cell input,.order-select-head input{width:18px;height:18px;cursor:pointer}
      body.role-employee .bulk-delete-bar,body.role-employee .order-select-cell,body.role-employee .order-select-head{display:none!important}
    `;
    document.head.appendChild(st);
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
    return [...document.querySelectorAll('#orderRows .order-select-checkbox:checked')].map(x => x.dataset.orderId).filter(Boolean);
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
    bar.innerHTML = `<span class="bulk-count" id="bulkSelectedCount">已選 0 筆</span><button type="button" id="selectVisibleBtn" class="btn ghost">全選目前顯示</button><button type="button" id="clearSelectedBtn" class="btn ghost">取消全選</button><button type="button" id="bulkDeleteBtn" class="btn bulk-delete-btn" disabled>一鍵刪除已選訂單</button>`;
    filters.insertAdjacentElement('afterend', bar);
    $('selectVisibleBtn').addEventListener('click', () => {
      visibleSelectableRows().forEach(row => { const cb=row.querySelector('.order-select-checkbox'); if(cb) cb.checked=true; });
      updateBulkState();
    });
    $('clearSelectedBtn').addEventListener('click', () => {
      document.querySelectorAll('#orderRows .order-select-checkbox').forEach(cb => cb.checked=false);
      updateBulkState();
    });
    $('bulkDeleteBtn').addEventListener('click', bulkDeleteSelected);
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
        visibleSelectableRows().forEach(row=>{const cb=row.querySelector('.order-select-checkbox');if(cb)cb.checked=e.target.checked;});
        updateBulkState();
      });
    }
    body.querySelectorAll('tr').forEach(row=>{
      const saveBtn=row.querySelector('[data-save-status]');
      if(!saveBtn||row.querySelector('.order-select-cell'))return;
      const orderId=saveBtn.dataset.saveStatus;if(!orderId)return;
      const td=document.createElement('td');td.className='order-select-cell';
      td.innerHTML=`<input type="checkbox" class="order-select-checkbox" data-order-id="${orderId}" aria-label="選取訂單">`;
      row.insertBefore(td,row.firstChild);
      td.querySelector('input').addEventListener('change',updateBulkState);
    });
    updateBulkState();
  }

  async function singleDelete(btn) {
    const orderId=btn.dataset.deleteOrder;if(!orderId)return;
    const row=btn.closest('tr');
    const orderCell=row?.querySelector('.order-select-cell') ? row.cells?.[2] : row?.cells?.[1];
    const orderNo=orderCell?.querySelector('b')?.textContent?.trim() || '此訂單';
    if(!confirm(`確定永久刪除 ${orderNo}？\n商品明細與廠商回覆會一起刪除，LINE 匯入歷史會保留。`))return;
    btn.disabled=true;const old=btn.textContent;btn.textContent='刪除中…';
    try{const d=await deleteViaAdminApi([orderId]);alert(`刪除完成：${d.deleted_count} 筆`);$('reloadBtn')?.click();}
    catch(e){alert(`刪除失敗：${e.message}`);btn.disabled=false;btn.textContent=old||'刪除';}
  }

  async function bulkDeleteSelected() {
    const ids=selectedIds();if(!ids.length)return;
    if(!confirm(`確定要永久刪除已選取的 ${ids.length} 筆訂單？\n商品明細與廠商回覆會一併刪除。`))return;
    if(!confirm(`再次確認：刪除 ${ids.length} 筆訂單後無法復原。\n確定繼續？`))return;
    const btn=$('bulkDeleteBtn');btn.disabled=true;btn.textContent='批次刪除中…';
    try{const d=await deleteViaAdminApi(ids);alert(`批次刪除完成：成功刪除 ${d.deleted_count} 筆。`);$('reloadBtn')?.click();}
    catch(e){alert(`批次刪除失敗：${e.message}`);btn.disabled=false;btn.textContent='一鍵刪除已選訂單';}
  }

  function install() {
    injectStyles();
    if(!isAdmin())return;
    ensureBulkBar();enhanceTable();
    const body=$('orderRows');
    if(body&&!body.dataset.bulkDeleteObserved){
      body.dataset.bulkDeleteObserved='1';let timer;
      new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(enhanceTable,40);}).observe(body,{childList:true,subtree:true});
    }
    if(!document.documentElement.dataset.bulkDeleteClickInstalled){
      document.documentElement.dataset.bulkDeleteClickInstalled='1';
      document.addEventListener('click',e=>{
        const btn=e.target.closest?.('[data-delete-order]');
        if(!btn||!isAdmin())return;
        e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();singleDelete(btn);
      },true);
    }
  }

  window.addEventListener('DOMContentLoaded',()=>{
    setTimeout(install,150);setTimeout(install,700);setTimeout(install,1500);
    $('loginBtn')?.addEventListener('click',()=>{setTimeout(install,350);setTimeout(install,900);setTimeout(install,1600);});
    ['searchInput','vendorFilter','alertFilter','hideShippedToggle'].forEach(id=>{
      $(id)?.addEventListener('input',()=>setTimeout(updateBulkState,20));
      $(id)?.addEventListener('change',()=>setTimeout(updateBulkState,20));
    });
  });
})();
