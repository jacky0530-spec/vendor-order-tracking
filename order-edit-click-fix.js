(() => {
  'use strict';

  const VERSION = 'V2.19';
  const CFG = window.APP_CONFIG || {};
  const SB = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_PUBLISHABLE_KEY;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  let currentOrder = null;
  let currentItems = [];
  let currentRole = null;
  let lastOpenAt = 0;

  function session(){
    try { return JSON.parse(localStorage.getItem('vendor_order_session') || 'null'); }
    catch { return null; }
  }

  async function rest(path, opt = {}){
    const s = session();
    if(!s?.access_token) throw new Error('登入已過期，請重新登入');
    const res = await fetch(`${SB}/rest/v1/${path}`, {
      ...opt,
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${s.access_token}`,
        'Content-Type':'application/json',
        ...(opt.headers || {})
      }
    });
    const text = await res.text();
    if(!res.ok){
      let msg = text;
      try { const d = JSON.parse(text); msg = d.message || d.hint || d.details || text; } catch {}
      throw new Error(msg || `HTTP ${res.status}`);
    }
    return text ? JSON.parse(text) : null;
  }

  async function role(){
    const uid = session()?.user?.id;
    if(!uid) return null;
    const rows = await rest(`user_profiles?select=role,active&user_id=eq.${encodeURIComponent(uid)}`);
    const p = rows?.[0];
    if(!p || p.active === false) return null;
    return p.role || null;
  }

  function setVersion(){
    document.querySelectorAll('.system-version-chip').forEach(el => el.textContent = `系統版本 ${VERSION}`);
    const footer = document.querySelector('footer');
    if(footer) footer.textContent = `Vendor Order Tracking ${VERSION}`;
  }

  function ensureStyle(){
    const old = $('orderEditClickFixStyles');
    if(old) old.remove();
    const st = document.createElement('style');
    st.id = 'orderEditClickFixStyles';
    st.textContent = `
      .fix-edit-overlay{position:fixed!important;inset:0!important;z-index:500000!important;background:rgba(16,24,40,.72)!important;align-items:center!important;justify-content:center!important;padding:14px!important}
      .fix-edit-card{width:min(1040px,100%)!important;max-height:94vh!important;overflow:auto!important;background:#fff!important;border-radius:18px!important;padding:20px!important;box-shadow:0 24px 70px rgba(0,0,0,.38)!important}
      .fix-edit-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.fix-edit-head h2{margin:0}.fix-edit-close{border:0;background:#f2f4f7;border-radius:10px;width:40px;height:40px;font-size:22px;cursor:pointer}
      .fix-order-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0}.fix-order-grid .full{grid-column:1/-1}
      .fix-edit-card label{display:block;font-weight:700;color:#344054}.fix-edit-card input,.fix-edit-card select,.fix-edit-card textarea{width:100%;margin-top:5px}.fix-edit-card textarea{min-height:72px}
      .fix-item-editor{border:1px solid #d0d5dd;background:#f9fafb;border-radius:14px;padding:14px;margin:10px 0}.fix-item-grid{display:grid;grid-template-columns:1.1fr 2fr .7fr .7fr 1fr;gap:10px}
      .fix-edit-actions{position:sticky;bottom:-20px;background:#fff;display:flex;justify-content:flex-end;gap:10px;padding:14px 0 4px;margin-top:16px}

      /* V2.19：固定但壓縮上方操作區，讓訂單清單取得更多高度 */
      .topbar{position:sticky!important;top:0!important;z-index:10000!important}
      #adminView{padding-top:4px!important}
      #adminVersionRow{margin:0 0 3px!important;min-height:22px!important}
      #adminVersionRow .system-version-chip{font-size:10px!important;padding:3px 7px!important}
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
      #tab-tracking .table-wrap table{margin-bottom:0!important}
      #orderRows button[data-profile-edit-order],#orderRows button[data-employee-edit],#orderRows button[data-core-edit-order]{pointer-events:auto!important;cursor:pointer!important;touch-action:manipulation!important}

      @media(max-height:800px){#tab-tracking .table-wrap{max-height:calc(100vh - 320px)!important;min-height:300px!important}}
      @media(max-width:800px){
        .fix-order-grid,.fix-item-grid{grid-template-columns:1fr}.fix-order-grid .full{grid-column:auto}.fix-edit-overlay{padding:5px!important;align-items:flex-end!important}.fix-edit-card{border-radius:18px 18px 8px 8px!important}.fix-edit-actions .btn{flex:1}
        #tab-tracking .metrics{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:6px!important}
        #tab-tracking .metric.card{min-height:58px!important;padding:8px 10px!important}
        #tab-tracking .metric strong{font-size:23px!important}
        #tab-tracking .table-wrap{max-height:calc(100vh - 385px)!important;min-height:300px!important}
      }
    `;
    document.head.appendChild(st);
  }

  function ensureModal(){
    if($('fixOrderEditModal')) return;
    ensureStyle();
    const d = document.createElement('div');
    d.id = 'fixOrderEditModal';
    d.className = 'fix-edit-overlay';
    d.style.display = 'none';
    d.innerHTML = `<div class="fix-edit-card">
      <div class="fix-edit-head"><div><h2 id="fixEditTitle">編輯訂單</h2><div class="muted">管理員與員工可修改訂單資料、商品編號與每個品項最晚交期。</div></div><button type="button" class="fix-edit-close" data-fix-close>×</button></div>
      <div id="fixOrderFields"></div>
      <div id="fixItemFields"></div>
      <div id="fixEditMsg" class="message"></div>
      <div class="fix-edit-actions"><button type="button" class="btn ghost" data-fix-close>取消</button><button type="button" class="btn primary" id="fixEditSave">儲存修改</button></div>
    </div>`;
    document.body.appendChild(d);
    d.querySelectorAll('[data-fix-close]').forEach(b => b.addEventListener('click', e => {
      e.preventDefault();
      d.style.display = 'none';
    }));
  }

  const statuses = ['new','vendor_unconfirmed','vendor_confirmed','preparing','shipped','completed','cancelled','out_of_stock','delayed'];
  const statusText = s => ({new:'新訂單',vendor_unconfirmed:'待廠商確認',vendor_confirmed:'廠商已確認',preparing:'備貨中',shipped:'已出貨',completed:'已完成',cancelled:'已取消',out_of_stock:'缺貨',delayed:'延後'})[s] || s;

  function orderIdFromButton(btn){
    return btn?.dataset?.profileEditOrder ||
      btn?.dataset?.employeeEdit ||
      btn?.dataset?.coreEditOrder ||
      btn?.closest?.('tr')?.querySelector?.('[data-save-status]')?.dataset?.saveStatus || '';
  }

  async function openEditor(orderId){
    if(!orderId) return alert('找不到此列的訂單 ID，請重新整理後再試。');
    ensureModal();
    const modal = $('fixOrderEditModal');
    modal.style.setProperty('display','flex','important');
    $('fixEditTitle').textContent = '編輯訂單｜載入中…';
    $('fixOrderFields').innerHTML = '<p class="muted">正在載入訂單資料…</p>';
    $('fixItemFields').innerHTML = '';
    $('fixEditMsg').textContent = '';

    try{
      currentRole = await role();
      if(!['admin','employee'].includes(currentRole)) throw new Error('此帳號沒有編輯訂單權限');
      const [ors, its] = await Promise.all([
        rest(`orders?select=*&id=eq.${encodeURIComponent(orderId)}`),
        rest(`order_items?select=*&order_id=eq.${encodeURIComponent(orderId)}&order=sort_order.asc`)
      ]);
      currentOrder = ors?.[0] || null;
      currentItems = its || [];
      if(!currentOrder) throw new Error('找不到訂單資料');

      $('fixEditTitle').textContent = `編輯 ORD-${String(currentOrder.tracking_id).padStart(6,'0')}`;
      $('fixOrderFields').innerHTML = `<div class="fix-order-grid">
        <label>訂購日<input id="feOrderDate" type="date" value="${esc(currentOrder.order_date || '')}"></label>
        <label>訂貨人<input id="feBuyer" value="${esc(currentOrder.buyer || '')}"></label>
        <label>收貨人<input id="feReceiver" value="${esc(currentOrder.receiver || '')}"></label>
        <label>電話<input id="fePhone" value="${esc(currentOrder.receiver_phone || '')}"></label>
        <label>運費<input id="feFee" value="${esc(currentOrder.shipping_fee_text || '')}"></label>
        <label>狀態<select id="feStatus">${statuses.map(s => `<option value="${s}" ${currentOrder.status === s ? 'selected' : ''}>${statusText(s)}</option>`).join('')}</select></label>
        <label class="full">收貨地址<textarea id="feAddress">${esc(currentOrder.receiver_address || '')}</textarea></label>
      </div>`;

      $('fixItemFields').innerHTML = currentItems.map((x,i) => `<div class="fix-item-editor" data-fe-item="${esc(x.id)}">
        <b>品項 ${i+1}${x.variant ? `｜${esc(x.variant)}` : ''}</b>
        <div class="fix-item-grid">
          <label>商品編號（最多10碼）<input data-fe="code" maxlength="10" value="${esc(x.product_code || '')}"></label>
          <label>商品名稱<input data-fe="name" value="${esc(x.product_name || '')}"></label>
          <label>數量<input data-fe="qty" type="number" step="any" value="${x.quantity == null ? '' : esc(x.quantity)}"></label>
          <label>單位<input data-fe="unit" value="${esc(x.quantity_unit || '')}"></label>
          <label>最晚交期<input data-fe="deadline" type="date" value="${esc(x.expected_deadline || '')}"></label>
        </div>
      </div>`).join('') || '<p class="muted">沒有商品明細。</p>';
    }catch(e){
      $('fixOrderFields').innerHTML = '';
      $('fixItemFields').innerHTML = '';
      $('fixEditMsg').textContent = `載入失敗：${e.message}`;
      $('fixEditMsg').className = 'message error';
    }
  }

  async function saveEditor(){
    if(!currentOrder || !['admin','employee'].includes(currentRole)) return;
    const msg = $('fixEditMsg');
    const btn = $('fixEditSave');
    const updates = [];

    for(const f of document.querySelectorAll('[data-fe-item]')){
      const code = f.querySelector('[data-fe="code"]')?.value.trim() || '';
      if(!code){ msg.textContent = '商品編號不可空白。'; msg.className = 'message error'; return; }
      if([...code].length > 10){ msg.textContent = `商品編號「${code}」超過10碼。`; msg.className = 'message error'; return; }
      const qraw = f.querySelector('[data-fe="qty"]')?.value.trim() || '';
      const deadline = f.querySelector('[data-fe="deadline"]')?.value || null;
      updates.push({
        id: f.dataset.feItem,
        product_code: code,
        product_name: f.querySelector('[data-fe="name"]')?.value.trim() || '',
        quantity: qraw === '' ? null : Number(qraw),
        quantity_unit: f.querySelector('[data-fe="unit"]')?.value.trim() || null,
        expected_from: deadline,
        expected_deadline: deadline,
        lead_time_text: currentRole === 'admin' ? '管理員調整' : '員工調整'
      });
    }

    btn.disabled = true;
    btn.textContent = '儲存中…';
    msg.textContent = '';
    try{
      await rest(`orders?id=eq.${encodeURIComponent(currentOrder.id)}`, {
        method:'PATCH', headers:{Prefer:'return=minimal'}, body:JSON.stringify({
          order_date: $('feOrderDate').value || currentOrder.order_date,
          buyer: $('feBuyer').value.trim() || null,
          receiver: $('feReceiver').value.trim() || null,
          receiver_phone: $('fePhone').value.trim() || null,
          receiver_address: $('feAddress').value.trim() || null,
          shipping_fee_text: $('feFee').value.trim() || null,
          status: $('feStatus').value
        })
      });

      for(const u of updates){
        const {id, ...body} = u;
        await rest(`order_items?id=eq.${encodeURIComponent(id)}`, {method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});
      }

      const dates = updates.map(x => x.expected_deadline).filter(Boolean).sort();
      await rest(`orders?id=eq.${encodeURIComponent(currentOrder.id)}`, {
        method:'PATCH', headers:{Prefer:'return=minimal'}, body:JSON.stringify({
          expected_from: dates[0] || null,
          expected_deadline: dates.length ? dates[dates.length - 1] : null,
          lead_time_text: currentRole === 'admin' ? '管理員調整' : '員工調整'
        })
      });

      msg.textContent = '修改已儲存。';
      msg.className = 'message success';
      setTimeout(() => location.reload(), 600);
    }catch(e){
      msg.textContent = `儲存失敗：${e.message}`;
      msg.className = 'message error';
    }finally{
      btn.disabled = false;
      btn.textContent = '儲存修改';
    }
  }

  function handleEditPress(e, btn){
    const now = Date.now();
    if(now - lastOpenAt < 500){
      e.preventDefault?.();
      return;
    }
    const orderId = orderIdFromButton(btn);
    if(!orderId) return;
    lastOpenAt = now;
    e.preventDefault?.();
    e.stopPropagation?.();
    openEditor(orderId);
  }

  function bindVisibleEditButtons(){
    document.querySelectorAll('#orderRows button').forEach(btn => {
      if(!/編輯訂單/.test((btn.textContent || '').trim())) return;
      if(btn.dataset.v219Bound === '1') return;
      btn.dataset.v219Bound = '1';
      btn.type = 'button';
      btn.style.setProperty('pointer-events','auto','important');
      btn.style.setProperty('cursor','pointer','important');
      btn.style.setProperty('touch-action','manipulation','important');
      btn.onpointerdown = e => handleEditPress(e, btn);
      btn.onmousedown = e => {
        if(typeof PointerEvent === 'undefined') handleEditPress(e, btn);
      };
      btn.onclick = e => handleEditPress(e, btn);
    });
  }

  function install(){
    setVersion();
    ensureStyle();
    ensureModal();
    bindVisibleEditButtons();

    /* pointerdown capture：比 click 更早，避開舊模組 click 攔截 */
    document.addEventListener('pointerdown', e => {
      const btn = e.target.closest?.('button');
      if(!btn || !/編輯訂單/.test((btn.textContent || '').trim())) return;
      const orderId = orderIdFromButton(btn);
      if(!orderId) return;
      e.preventDefault();
      e.stopPropagation();
      handleEditPress(e, btn);
    }, true);

    /* click fallback */
    document.addEventListener('click', e => {
      const btn = e.target.closest?.('button');
      if(!btn || !/編輯訂單/.test((btn.textContent || '').trim())) return;
      const orderId = orderIdFromButton(btn);
      if(!orderId) return;
      e.preventDefault();
      e.stopPropagation();
      handleEditPress(e, btn);
    }, true);

    $('fixEditSave')?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      saveEditor();
    });

    const rows = $('orderRows');
    if(rows){
      new MutationObserver(() => bindVisibleEditButtons()).observe(rows,{childList:true,subtree:true});
    }

    setInterval(() => {
      setVersion();
      bindVisibleEditButtons();
    }, 1000);
  }

  window.__vendorOrderOpenEditor = openEditor;

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true});
  else install();
})();