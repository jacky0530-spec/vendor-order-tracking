(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const SB = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_PUBLISHABLE_KEY;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  let roleCache = null;
  let rolePromise = null;
  let editingOrder = null;
  let editingItems = [];

  function session(){
    try { return JSON.parse(localStorage.getItem('vendor_order_session') || 'null'); }
    catch { return null; }
  }

  async function rest(path,opt={}){
    const s=session();
    if(!s?.access_token) throw new Error('登入已過期，請重新登入');
    const r=await fetch(`${SB}/rest/v1/${path}`,{
      ...opt,
      headers:{
        apikey:KEY,
        Authorization:`Bearer ${s.access_token}`,
        'Content-Type':'application/json',
        ...(opt.headers||{})
      }
    });
    const t=await r.text();
    if(!r.ok){
      let m=t;
      try{const d=JSON.parse(t);m=d.message||d.hint||d.details||t}catch{}
      throw new Error(m||`HTTP ${r.status}`);
    }
    if(!t) return null;
    try{return JSON.parse(t)}catch{return t}
  }

  async function currentRole(force=false){
    if(force){roleCache=null;rolePromise=null;}
    if(roleCache) return roleCache;
    if(rolePromise) return rolePromise;
    const s=session();
    if(!s?.user?.id) return null;
    rolePromise=rest(`user_profiles?select=role,active&user_id=eq.${encodeURIComponent(s.user.id)}`)
      .then(rows=>{
        const p=rows?.[0];
        roleCache=p?.active===false?null:(p?.role||null);
        return roleCache;
      })
      .finally(()=>{rolePromise=null;});
    return rolePromise;
  }

  function canEditRole(role){return role==='admin'||role==='employee';}

  function injectStyles(){
    if($('stableOrderEditorStyles')) return;
    const st=document.createElement('style');
    st.id='stableOrderEditorStyles';
    st.textContent=`
      .stable-order-edit-btn{display:block!important;margin-top:6px!important;background:#344054!important;color:#fff!important;border-color:#344054!important}
      .stable-edit-overlay{position:fixed;inset:0;z-index:120000;background:rgba(16,24,40,.64);display:flex;align-items:center;justify-content:center;padding:16px}
      .stable-edit-overlay.hidden{display:none!important}
      .stable-edit-card{width:min(1020px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:18px;padding:20px;box-shadow:0 24px 70px rgba(0,0,0,.3)}
      .stable-edit-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.stable-edit-head h2{margin:0}
      .stable-edit-close{border:0;background:#f2f4f7;width:40px;height:40px;border-radius:10px;font-size:22px;cursor:pointer}
      .stable-order-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0}.stable-order-grid .full{grid-column:1/-1}
      .stable-items{display:grid;gap:12px}.stable-item{border:1px solid #d0d5dd;border-radius:14px;padding:14px;background:#f9fafb}
      .stable-item-grid{display:grid;grid-template-columns:1.05fr 2fr .7fr .7fr 1fr;gap:10px}
      .stable-edit-card label{display:block;font-weight:700;color:#344054}.stable-edit-card input,.stable-edit-card select,.stable-edit-card textarea{width:100%;margin-top:5px;box-sizing:border-box}.stable-edit-card textarea{min-height:72px}
      .stable-edit-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px;position:sticky;bottom:-20px;background:#fff;padding:14px 0 4px}
      .stable-edit-msg{margin-top:10px;font-size:13px}.stable-edit-msg.error{color:#b42318}.stable-edit-msg.success{color:#067647}
      @media(max-width:800px){.stable-order-grid,.stable-item-grid{grid-template-columns:1fr}.stable-order-grid .full{grid-column:auto}.stable-edit-overlay{padding:6px;align-items:flex-end}.stable-edit-card{border-radius:18px 18px 8px 8px;max-height:94vh}}
    `;
    document.head.appendChild(st);
  }

  function ensureModal(){
    if($('stableOrderEditModal')) return;
    const d=document.createElement('div');
    d.id='stableOrderEditModal';
    d.className='stable-edit-overlay hidden';
    d.innerHTML=`<div class="stable-edit-card">
      <div class="stable-edit-head"><div><h2 id="stableEditTitle">編輯訂單</h2><div class="muted">ADMIN／員工可修改訂單與每個品項資料。</div></div><button type="button" class="stable-edit-close" data-stable-close>×</button></div>
      <div id="stableOrderFields"></div>
      <div id="stableItemFields" class="stable-items"></div>
      <div id="stableEditMsg" class="stable-edit-msg"></div>
      <div class="stable-edit-actions"><button type="button" class="btn ghost" data-stable-close>取消</button><button type="button" id="stableEditSave" class="btn primary">儲存修改</button></div>
    </div>`;
    document.body.appendChild(d);
    d.querySelectorAll('[data-stable-close]').forEach(b=>b.addEventListener('click',()=>d.classList.add('hidden')));
    $('stableEditSave').addEventListener('click',saveEdit);
  }

  const statuses=['new','vendor_unconfirmed','vendor_confirmed','preparing','shipped','completed','cancelled','out_of_stock','delayed'];
  const statusName=s=>({new:'新訂單',vendor_unconfirmed:'待廠商確認',vendor_confirmed:'廠商已確認',preparing:'備貨中',shipped:'已出貨',completed:'已完成',cancelled:'已取消',out_of_stock:'缺貨',delayed:'延後'})[s]||s;

  async function openEdit(orderId){
    const role=await currentRole().catch(()=>null);
    if(!canEditRole(role)) return;
    ensureModal();
    const modal=$('stableOrderEditModal');
    modal.classList.remove('hidden');
    $('stableEditTitle').textContent='編輯訂單';
    $('stableOrderFields').innerHTML='<div class="muted" style="padding:16px 0">載入中…</div>';
    $('stableItemFields').innerHTML='';
    $('stableEditMsg').textContent='';
    try{
      const [orows,irows]=await Promise.all([
        rest(`orders?select=*&id=eq.${encodeURIComponent(orderId)}`),
        rest(`order_items?select=*&order_id=eq.${encodeURIComponent(orderId)}&order=sort_order.asc`)
      ]);
      editingOrder=orows?.[0]||null;
      editingItems=irows||[];
      if(!editingOrder) throw new Error('找不到訂單');
      $('stableEditTitle').textContent=`編輯 ORD-${String(editingOrder.tracking_id||'').padStart(6,'0')}`;
      $('stableOrderFields').innerHTML=`<div class="stable-order-grid">
        <label>訂購日<input id="soOrderDate" type="date" value="${esc(editingOrder.order_date||'')}"></label>
        <label>訂貨人<input id="soBuyer" value="${esc(editingOrder.buyer||'')}"></label>
        <label>收貨人<input id="soReceiver" value="${esc(editingOrder.receiver||'')}"></label>
        <label>電話<input id="soPhone" value="${esc(editingOrder.receiver_phone||'')}"></label>
        <label>運費<input id="soFee" value="${esc(editingOrder.shipping_fee_text||'')}"></label>
        <label>狀態<select id="soStatus">${statuses.map(s=>`<option value="${s}" ${editingOrder.status===s?'selected':''}>${statusName(s)}</option>`).join('')}</select></label>
        <label class="full">收貨地址<textarea id="soAddress">${esc(editingOrder.receiver_address||'')}</textarea></label>
      </div>`;
      $('stableItemFields').innerHTML=editingItems.map((x,i)=>`<div class="stable-item" data-stable-item="${esc(x.id)}"><b>品項 ${i+1}</b><div class="stable-item-grid" style="margin-top:8px">
        <label>商品編號<input data-f="product_code" maxlength="10" value="${esc(x.product_code||'')}"></label>
        <label>商品名稱<input data-f="product_name" value="${esc(x.product_name||'')}"></label>
        <label>數量<input data-f="quantity" type="number" min="0" step="any" value="${esc(x.quantity??'')}"></label>
        <label>單位<input data-f="quantity_unit" value="${esc(x.quantity_unit||'')}"></label>
        <label>最晚交期<input data-f="expected_deadline" type="date" value="${esc(x.expected_deadline||'')}"></label>
      </div><label style="margin-top:8px">規格／備註<input data-f="variant" value="${esc(x.variant||'')}"></label></div>`).join('')||'<div class="muted">此訂單沒有商品明細。</div>';
    }catch(e){
      $('stableOrderFields').innerHTML='';
      $('stableEditMsg').textContent=`載入失敗：${e.message}`;
      $('stableEditMsg').className='stable-edit-msg error';
    }
  }

  async function saveEdit(){
    if(!editingOrder) return;
    const role=await currentRole().catch(()=>null);
    if(!canEditRole(role)) return;
    const btn=$('stableEditSave');
    const msg=$('stableEditMsg');
    btn.disabled=true;btn.textContent='儲存中…';msg.textContent='';msg.className='stable-edit-msg';
    try{
      const orderPatch={
        order_date:$('soOrderDate')?.value||editingOrder.order_date,
        buyer:$('soBuyer')?.value.trim()||null,
        receiver:$('soReceiver')?.value.trim()||null,
        receiver_phone:$('soPhone')?.value.trim()||null,
        receiver_address:$('soAddress')?.value.trim()||null,
        shipping_fee_text:$('soFee')?.value.trim()||null,
        status:$('soStatus')?.value||editingOrder.status,
        updated_at:new Date().toISOString()
      };
      await rest(`orders?id=eq.${encodeURIComponent(editingOrder.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(orderPatch)});

      const cards=[...document.querySelectorAll('#stableItemFields [data-stable-item]')];
      for(const card of cards){
        const id=card.dataset.stableItem;
        const get=f=>card.querySelector(`[data-f="${f}"]`)?.value??'';
        const code=get('product_code').trim();
        if(code.length>10) throw new Error(`商品編號 ${code} 超過 10 碼`);
        const qRaw=get('quantity');
        const patch={
          product_code:code||null,
          product_name:get('product_name').trim()||null,
          quantity:qRaw===''?null:Number(qRaw),
          quantity_unit:get('quantity_unit').trim()||null,
          expected_deadline:get('expected_deadline')||null,
          variant:get('variant').trim()||null
        };
        await rest(`order_items?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(patch)});
      }

      msg.textContent='儲存成功，正在重新整理訂單資料…';msg.className='stable-edit-msg success';
      setTimeout(()=>window.location.reload(),550);
    }catch(e){
      msg.textContent=`儲存失敗：${e.message}`;msg.className='stable-edit-msg error';
      btn.disabled=false;btn.textContent='儲存修改';
    }
  }

  async function enhanceRows(){
    const role=await currentRole().catch(()=>null);
    if(!canEditRole(role)) return;
    const body=$('orderRows');
    if(!body) return;
    body.querySelectorAll('tr').forEach(tr=>{
      const save=tr.querySelector('[data-save-status]');
      if(!save) return;
      const id=save.dataset.saveStatus;
      if(!id || tr.querySelector('[data-stable-order-edit]')) return;
      const actionCell=tr.lastElementChild;
      if(!actionCell) return;
      const b=document.createElement('button');
      b.type='button';b.className='btn small secondary stable-order-edit-btn';b.dataset.stableOrderEdit=id;b.textContent='編輯訂單';
      actionCell.appendChild(b);
    });
  }

  let scheduled=false;
  function scheduleEnhance(){
    if(scheduled) return;
    scheduled=true;
    requestAnimationFrame(()=>{scheduled=false;enhanceRows();});
  }

  async function install(){
    injectStyles();ensureModal();
    roleCache=null;
    await currentRole().catch(()=>null);
    await enhanceRows();
    const body=$('orderRows');
    if(body&&!body.dataset.stableEditorObserved){
      body.dataset.stableEditorObserved='1';
      new MutationObserver(muts=>{
        if(muts.some(m=>m.addedNodes?.length)) scheduleEnhance();
      }).observe(body,{childList:true,subtree:true});
    }
  }

  document.addEventListener('click',e=>{
    const b=e.target.closest?.('[data-stable-order-edit]');
    if(!b) return;
    e.preventDefault();e.stopPropagation();
    openEdit(b.dataset.stableOrderEdit);
  });

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>install(),{once:true}); else install();
  $('loginBtn')?.addEventListener('click',()=>setTimeout(()=>install(),900));
})();
