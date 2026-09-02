(() => {
  'use strict';

  const VERSION = 'V2.16';
  const CFG = window.APP_CONFIG || {};
  const SB = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_PUBLISHABLE_KEY;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  let cachedUid = null;
  let cachedRole = null;
  let itemCache = null;
  let editingOrder = null;
  let editingItems = [];
  let mutationTimer = null;

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

  async function resolveRole(){
    const s = session();
    const uid = s?.user?.id;
    if(!uid){ cachedUid = null; cachedRole = null; return null; }
    if(cachedUid === uid && cachedRole) return cachedRole;
    const rows = await rest(`user_profiles?select=role,active&user_id=eq.${encodeURIComponent(uid)}`);
    const p = rows?.[0];
    cachedUid = uid;
    cachedRole = p?.active === false ? null : (p?.role || null);
    return cachedRole;
  }

  function setVersion(){
    document.querySelectorAll('.system-version-chip').forEach(el => el.textContent = `系統版本 ${VERSION}`);
    const footer = document.querySelector('footer');
    if(footer) footer.textContent = `Vendor Order Tracking ${VERSION}`;
  }

  function injectStyles(){
    if($('profileOrderEditorStyles')) return;
    const st = document.createElement('style');
    st.id = 'profileOrderEditorStyles';
    st.textContent = `
      .profile-edit-order-btn{display:block!important;margin-top:7px!important;min-width:76px!important}
      .profile-item-deadline{display:block!important;width:max-content;max-width:100%;margin-top:5px;padding:3px 7px;border-radius:999px;background:#fff4e5;color:#b54708;font-size:11px;font-weight:800;white-space:nowrap}
      .profile-edit-overlay{position:fixed;inset:0;z-index:200000;background:rgba(16,24,40,.68);display:flex;align-items:center;justify-content:center;padding:14px}
      .profile-edit-overlay.hidden{display:none!important}.profile-edit-card{width:min(1040px,100%);max-height:94vh;overflow:auto;background:#fff;border-radius:18px;padding:20px;box-shadow:0 24px 70px rgba(0,0,0,.35)}
      .profile-edit-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.profile-edit-head h2{margin:0}.profile-edit-close{border:0;background:#f2f4f7;border-radius:10px;width:40px;height:40px;font-size:22px;cursor:pointer}
      .profile-order-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0}.profile-order-grid .full{grid-column:1/-1}
      .profile-edit-card label{display:block;font-weight:700;color:#344054}.profile-edit-card input,.profile-edit-card select,.profile-edit-card textarea{width:100%;margin-top:5px}.profile-edit-card textarea{min-height:72px}
      .profile-item-editor{border:1px solid #d0d5dd;background:#f9fafb;border-radius:14px;padding:14px;margin:10px 0}.profile-item-grid{display:grid;grid-template-columns:1.1fr 2fr .7fr .7fr 1fr;gap:10px}
      .profile-edit-actions{position:sticky;bottom:-20px;background:#fff;display:flex;justify-content:flex-end;gap:10px;padding:14px 0 4px;margin-top:16px}
      @media(max-width:800px){.profile-order-grid,.profile-item-grid{grid-template-columns:1fr}.profile-order-grid .full{grid-column:auto}.profile-edit-overlay{padding:5px;align-items:flex-end}.profile-edit-card{border-radius:18px 18px 8px 8px}.profile-edit-actions .btn{flex:1}}
    `;
    document.head.appendChild(st);
  }

  async function getItems(force = false){
    if(force) itemCache = null;
    if(itemCache) return itemCache;
    itemCache = await rest('order_items?select=id,order_id,product_code,product_name,variant,quantity,quantity_unit,expected_from,expected_deadline,sort_order&order=sort_order.asc');
    return itemCache || [];
  }

  function productColumnIndex(){
    const table = $('orderRows')?.closest('table');
    const heads = [...(table?.querySelectorAll('thead th') || [])];
    return heads.findIndex(th => /商品編號|商品名稱|^商品$/.test((th.textContent || '').trim()));
  }

  function addEditButtons(role){
    if(!['admin','employee'].includes(role)) return;
    document.querySelectorAll('#orderRows tr').forEach(tr => {
      const save = tr.querySelector('[data-save-status]');
      if(!save) return;
      const orderId = save.dataset.saveStatus;
      const cell = save.closest('td') || tr.lastElementChild;
      if(!orderId || !cell || cell.querySelector('[data-profile-edit-order]')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn small secondary profile-edit-order-btn';
      btn.dataset.profileEditOrder = orderId;
      btn.textContent = '編輯訂單';
      cell.appendChild(btn);
    });
  }

  async function addDeadlines(role){
    if(!['admin','employee','vendor'].includes(role)) return;
    const all = await getItems().catch(() => []);

    if(role === 'vendor'){
      document.querySelectorAll('#vendorOrders .item-pick-row').forEach(row => {
        const id = row.querySelector('[data-item-select]')?.dataset.itemSelect;
        const x = all.find(v => v.id === id);
        if(!x?.expected_deadline) return;
        const target = row.querySelector('.item-pick-main > div') || row.querySelector('.item-pick-main');
        if(!target) return;
        let chip = row.querySelector('.profile-item-deadline');
        if(!chip){ chip = document.createElement('span'); chip.className = 'profile-item-deadline'; target.appendChild(chip); }
        chip.textContent = `最晚交期 ${x.expected_deadline}`;
      });
      return;
    }

    const pi = productColumnIndex();
    if(pi < 0) return;
    document.querySelectorAll('#orderRows tr').forEach(tr => {
      const orderId = tr.querySelector('[data-save-status]')?.dataset.saveStatus;
      if(!orderId) return;
      const list = all.filter(x => x.order_id === orderId).sort((a,b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
      if(!list.length) return;
      const cell = tr.children[pi];
      if(!cell) return;
      const rendered = [...cell.querySelectorAll('.admin-item-row')];
      if(rendered.length){
        rendered.forEach((row, i) => {
          const x = list[i];
          if(!x?.expected_deadline) return;
          const target = row.querySelector('.admin-item-name') || row;
          let chip = row.querySelector('.profile-item-deadline');
          if(!chip){ chip = document.createElement('span'); chip.className = 'profile-item-deadline'; target.appendChild(chip); }
          chip.textContent = `最晚交期 ${x.expected_deadline}`;
        });
        return;
      }
      const lines = [...cell.querySelectorAll('.product-line')];
      lines.forEach((line, i) => {
        const x = list[i];
        if(!x?.expected_deadline) return;
        let chip = line.querySelector('.profile-item-deadline');
        if(!chip){ chip = document.createElement('span'); chip.className = 'profile-item-deadline'; line.appendChild(chip); }
        chip.textContent = `最晚交期 ${x.expected_deadline}`;
      });
    });
  }

  function ensureModal(){
    if($('profileOrderEditModal')) return;
    const d = document.createElement('div');
    d.id = 'profileOrderEditModal';
    d.className = 'profile-edit-overlay hidden';
    d.innerHTML = `<div class="profile-edit-card">
      <div class="profile-edit-head"><div><h2 id="profileEditTitle">編輯訂單</h2><div class="muted">管理員與員工可修改訂單資料、商品編號及每個品項最晚交期。</div></div><button type="button" class="profile-edit-close" data-profile-edit-close>×</button></div>
      <div id="profileOrderFields"></div><div id="profileItemFields"></div><div id="profileEditMsg" class="message"></div>
      <div class="profile-edit-actions"><button type="button" class="btn ghost" data-profile-edit-close>取消</button><button type="button" class="btn primary" id="profileEditSave">儲存修改</button></div>
    </div>`;
    document.body.appendChild(d);
    d.querySelectorAll('[data-profile-edit-close]').forEach(b => b.addEventListener('click', () => d.classList.add('hidden')));
    $('profileEditSave').addEventListener('click', saveEdit);
  }

  const statuses = ['new','vendor_unconfirmed','vendor_confirmed','preparing','shipped','completed','cancelled','out_of_stock','delayed'];
  const statusText = s => ({new:'新訂單',vendor_unconfirmed:'待廠商確認',vendor_confirmed:'廠商已確認',preparing:'備貨中',shipped:'已出貨',completed:'已完成',cancelled:'已取消',out_of_stock:'缺貨',delayed:'延後'})[s] || s;

  async function openEdit(orderId){
    const role = await resolveRole();
    if(!['admin','employee'].includes(role)) return;
    ensureModal();
    try{
      const [ors, its] = await Promise.all([
        rest(`orders?select=*&id=eq.${encodeURIComponent(orderId)}`),
        rest(`order_items?select=*&order_id=eq.${encodeURIComponent(orderId)}&order=sort_order.asc`)
      ]);
      editingOrder = ors?.[0] || null;
      editingItems = its || [];
      if(!editingOrder) throw new Error('找不到訂單');
      $('profileEditTitle').textContent = `編輯 ORD-${String(editingOrder.tracking_id).padStart(6,'0')}`;
      $('profileOrderFields').innerHTML = `<div class="profile-order-grid">
        <label>訂購日<input id="peOrderDate" type="date" value="${esc(editingOrder.order_date || '')}"></label>
        <label>訂貨人<input id="peBuyer" value="${esc(editingOrder.buyer || '')}"></label>
        <label>收貨人<input id="peReceiver" value="${esc(editingOrder.receiver || '')}"></label>
        <label>電話<input id="pePhone" value="${esc(editingOrder.receiver_phone || '')}"></label>
        <label>運費<input id="peFee" value="${esc(editingOrder.shipping_fee_text || '')}"></label>
        <label>狀態<select id="peStatus">${statuses.map(s => `<option value="${s}" ${editingOrder.status === s ? 'selected' : ''}>${statusText(s)}</option>`).join('')}</select></label>
        <label class="full">收貨地址<textarea id="peAddress">${esc(editingOrder.receiver_address || '')}</textarea></label>
      </div>`;
      $('profileItemFields').innerHTML = editingItems.map((x,i) => `<div class="profile-item-editor" data-pe-item="${esc(x.id)}">
        <b>品項 ${i+1}${x.variant ? `｜${esc(x.variant)}` : ''}</b>
        <div class="profile-item-grid">
          <label>商品編號（最多10碼）<input data-pe="code" maxlength="10" value="${esc(x.product_code || '')}"></label>
          <label>商品名稱<input data-pe="name" value="${esc(x.product_name || '')}"></label>
          <label>數量<input data-pe="qty" type="number" step="any" value="${x.quantity == null ? '' : esc(x.quantity)}"></label>
          <label>單位<input data-pe="unit" value="${esc(x.quantity_unit || '')}"></label>
          <label>最晚交期<input data-pe="deadline" type="date" value="${esc(x.expected_deadline || '')}"></label>
        </div>
      </div>`).join('') || '<p class="muted">沒有商品明細。</p>';
      $('profileEditMsg').textContent = '';
      $('profileOrderEditModal').classList.remove('hidden');
    }catch(e){ alert(`編輯資料載入失敗：${e.message}`); }
  }

  async function saveEdit(){
    const role = await resolveRole();
    if(!editingOrder || !['admin','employee'].includes(role)) return;
    const msg = $('profileEditMsg');
    const btn = $('profileEditSave');
    const updates = [];
    for(const f of document.querySelectorAll('[data-pe-item]')){
      const code = f.querySelector('[data-pe="code"]')?.value.trim() || '';
      if(!code){ msg.textContent = '商品編號不可空白。'; msg.className = 'message error'; return; }
      if([...code].length > 10){ msg.textContent = `商品編號「${code}」超過10碼。`; msg.className = 'message error'; return; }
      const qraw = f.querySelector('[data-pe="qty"]')?.value.trim() || '';
      const deadline = f.querySelector('[data-pe="deadline"]')?.value || null;
      updates.push({
        id: f.dataset.peItem,
        product_code: code,
        product_name: f.querySelector('[data-pe="name"]')?.value.trim() || '',
        quantity: qraw === '' ? null : Number(qraw),
        quantity_unit: f.querySelector('[data-pe="unit"]')?.value.trim() || null,
        expected_from: deadline,
        expected_deadline: deadline,
        lead_time_text: role === 'admin' ? '管理員調整' : '員工調整'
      });
    }
    btn.disabled = true; btn.textContent = '儲存中…'; msg.textContent = '';
    try{
      await rest(`orders?id=eq.${encodeURIComponent(editingOrder.id)}`, {method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({
        order_date: $('peOrderDate').value || editingOrder.order_date,
        buyer: $('peBuyer').value.trim() || null,
        receiver: $('peReceiver').value.trim() || null,
        receiver_phone: $('pePhone').value.trim() || null,
        receiver_address: $('peAddress').value.trim() || null,
        shipping_fee_text: $('peFee').value.trim() || null,
        status: $('peStatus').value
      })});
      for(const u of updates){
        const {id, ...body} = u;
        await rest(`order_items?id=eq.${encodeURIComponent(id)}`, {method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});
      }
      const dates = updates.map(x => x.expected_deadline).filter(Boolean).sort();
      await rest(`orders?id=eq.${encodeURIComponent(editingOrder.id)}`, {method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({
        expected_from: dates[0] || null,
        expected_deadline: dates.length ? dates[dates.length - 1] : null,
        lead_time_text: role === 'admin' ? '管理員調整' : '員工調整'
      })});
      itemCache = null;
      msg.textContent = '修改已儲存。'; msg.className = 'message success';
      setTimeout(() => location.reload(), 550);
    }catch(e){ msg.textContent = `儲存失敗：${e.message}`; msg.className = 'message error'; }
    finally{ btn.disabled = false; btn.textContent = '儲存修改'; }
  }

  async function activate(){
    setVersion();
    injectStyles();
    const role = await resolveRole().catch(() => null);
    if(!role) return;
    addEditButtons(role);
    await addDeadlines(role);
  }

  function schedule(){
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => activate(), 120);
  }

  function installObservers(){
    const or = $('orderRows');
    if(or && !or.dataset.profileOrderEditorObserved){
      or.dataset.profileOrderEditorObserved = '1';
      new MutationObserver(schedule).observe(or,{childList:true,subtree:true});
    }
    const vr = $('vendorOrders');
    if(vr && !vr.dataset.profileOrderEditorObserved){
      vr.dataset.profileOrderEditorObserved = '1';
      new MutationObserver(schedule).observe(vr,{childList:true,subtree:true});
    }
  }

  function install(){
    injectStyles(); ensureModal(); installObservers();
    document.addEventListener('click', e => {
      const btn = e.target.closest?.('[data-profile-edit-order]');
      if(!btn) return;
      e.preventDefault(); e.stopPropagation();
      openEdit(btn.dataset.profileEditOrder);
    });
    $('loginBtn')?.addEventListener('click', () => { cachedUid = null; cachedRole = null; itemCache = null; setTimeout(activate, 700); setTimeout(activate, 1600); });
    activate();
    setTimeout(activate, 400);
    setTimeout(activate, 1000);
    setTimeout(activate, 1800);
    setInterval(() => { setVersion(); installObservers(); activate(); }, 2500);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true});
  else install();
})();