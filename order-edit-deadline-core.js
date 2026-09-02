(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const SB = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_PUBLISHABLE_KEY;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function session(){ try{return JSON.parse(localStorage.getItem('vendor_order_session') || 'null');}catch{return null;} }
  function jwt(token=''){
    try{
      const p=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      const pad=p.length%4?'='.repeat(4-p.length%4):'';
      return JSON.parse(decodeURIComponent(escape(atob(p+pad))));
    }catch{return {};}
  }
  function role(){ return jwt(session()?.access_token || '').app_metadata?.role || ''; }
  function canEdit(){ return ['admin','employee'].includes(role()); }

  async function rest(path,opt={}){
    const s=session();
    if(!s?.access_token) throw new Error('登入已過期，請重新登入');
    const r=await fetch(`${SB}/rest/v1/${path}`,{
      ...opt,
      headers:{apikey:KEY,Authorization:`Bearer ${s.access_token}`,'Content-Type':'application/json',...(opt.headers||{})}
    });
    const t=await r.text();
    if(!r.ok){
      let m=t;
      try{const d=JSON.parse(t);m=d.message||d.hint||d.details||t;}catch{}
      throw new Error(m || `HTTP ${r.status}`);
    }
    return t ? JSON.parse(t) : null;
  }

  function injectStyles(){
    if($('orderEditDeadlineCoreStyles')) return;
    const st=document.createElement('style');
    st.id='orderEditDeadlineCoreStyles';
    st.textContent=`
      [data-employee-edit]{display:none!important}
      .core-edit-order-btn{display:block!important;margin-top:7px!important;min-width:72px}
      .core-item-deadline{display:inline-block;margin:5px 0 0 7px;padding:3px 7px;border-radius:999px;background:#fff4e5;color:#b54708;font-size:11px;font-weight:800;white-space:nowrap}
      .core-edit-overlay{position:fixed;inset:0;z-index:120000;background:rgba(16,24,40,.68);display:flex;align-items:center;justify-content:center;padding:14px}
      .core-edit-overlay.hidden{display:none}.core-edit-card{width:min(1020px,100%);max-height:94vh;overflow:auto;background:#fff;border-radius:18px;padding:20px;box-shadow:0 24px 70px rgba(0,0,0,.35)}
      .core-edit-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.core-edit-head h2{margin:0}.core-edit-close{border:0;background:#f2f4f7;border-radius:10px;width:40px;height:40px;font-size:22px;cursor:pointer}
      .core-order-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0}.core-order-grid .full{grid-column:1/-1}
      .core-edit-card label{display:block;font-weight:700;color:#344054}.core-edit-card input,.core-edit-card select,.core-edit-card textarea{width:100%;margin-top:5px}.core-edit-card textarea{min-height:72px}
      .core-item-editor{border:1px solid #d0d5dd;background:#f9fafb;border-radius:14px;padding:14px;margin:10px 0}.core-item-grid{display:grid;grid-template-columns:1.1fr 2fr .7fr .7fr 1fr;gap:10px}
      .core-edit-actions{position:sticky;bottom:-20px;background:#fff;display:flex;justify-content:flex-end;gap:10px;padding:14px 0 4px;margin-top:16px}
      @media(max-width:800px){.core-order-grid,.core-item-grid{grid-template-columns:1fr}.core-order-grid .full{grid-column:auto}.core-edit-overlay{padding:5px;align-items:flex-end}.core-edit-card{border-radius:18px 18px 8px 8px}.core-edit-actions .btn{flex:1}}
    `;
    document.head.appendChild(st);
  }

  let itemCache=null;
  async function getItems(force=false){
    if(force) itemCache=null;
    if(itemCache) return itemCache;
    itemCache=await rest('order_items?select=id,order_id,product_code,product_name,variant,quantity,quantity_unit,expected_from,expected_deadline,sort_order&order=sort_order.asc');
    return itemCache || [];
  }

  function productColumnIndex(){
    const table=$('orderRows')?.closest('table');
    const heads=[...(table?.querySelectorAll('thead th') || [])];
    return heads.findIndex(th=>/商品編號|商品名稱|^商品$/.test((th.textContent||'').trim()));
  }

  function addEditButtons(){
    if(!canEdit()) return;
    document.querySelectorAll('#orderRows tr').forEach(tr=>{
      const save=tr.querySelector('[data-save-status]');
      if(!save) return;
      const orderId=save.dataset.saveStatus;
      const actionCell=save.closest('td') || tr.lastElementChild;
      if(!orderId || !actionCell || actionCell.querySelector('[data-core-edit-order]')) return;
      const b=document.createElement('button');
      b.type='button';
      b.className='btn small secondary core-edit-order-btn';
      b.dataset.coreEditOrder=orderId;
      b.textContent='編輯訂單';
      actionCell.appendChild(b);
    });
  }

  async function addDeadlines(){
    const r=role();
    if(!['admin','employee','vendor'].includes(r)) return;
    const all=await getItems().catch(()=>[]);

    if(r==='vendor'){
      document.querySelectorAll('#vendorOrders .item-pick-row').forEach(row=>{
        const id=row.querySelector('[data-item-select]')?.dataset.itemSelect;
        const x=all.find(v=>v.id===id);
        if(!x?.expected_deadline) return;
        row.querySelectorAll('.item-deadline-chip:not(.core-item-deadline)').forEach(n=>n.remove());
        const target=row.querySelector('.item-pick-main > div') || row.querySelector('.item-pick-main');
        if(!target) return;
        let chip=row.querySelector('.core-item-deadline');
        if(!chip){chip=document.createElement('span');chip.className='item-deadline-chip core-item-deadline';target.appendChild(chip);}
        const text=`最晚交期 ${x.expected_deadline}`;
        if(chip.textContent!==text) chip.textContent=text;
      });
      return;
    }

    const pi=productColumnIndex();
    if(pi<0) return;
    document.querySelectorAll('#orderRows tr').forEach(tr=>{
      const orderId=tr.querySelector('[data-save-status]')?.dataset.saveStatus;
      if(!orderId) return;
      const list=all.filter(x=>x.order_id===orderId).sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0));
      if(!list.length) return;
      const cell=tr.children[pi];
      if(!cell) return;

      const itemRows=[...cell.querySelectorAll('.admin-item-row')];
      if(itemRows.length){
        itemRows.forEach((row,i)=>{
          const x=list[i];
          if(!x?.expected_deadline) return;
          row.querySelectorAll('.item-deadline-chip:not(.core-item-deadline)').forEach(n=>n.remove());
          const target=row.querySelector('.admin-item-name') || row;
          let chip=row.querySelector('.core-item-deadline');
          if(!chip){chip=document.createElement('span');chip.className='item-deadline-chip core-item-deadline';target.appendChild(chip);}
          const text=`最晚交期 ${x.expected_deadline}`;
          if(chip.textContent!==text) chip.textContent=text;
        });
        return;
      }

      const lines=[...cell.querySelectorAll('.product-line')];
      lines.forEach((line,i)=>{
        const x=list[i];
        if(!x?.expected_deadline) return;
        line.querySelectorAll('.item-deadline-chip:not(.core-item-deadline)').forEach(n=>n.remove());
        let chip=line.querySelector('.core-item-deadline');
        if(!chip){chip=document.createElement('span');chip.className='item-deadline-chip core-item-deadline';line.appendChild(chip);}
        const text=`最晚交期 ${x.expected_deadline}`;
        if(chip.textContent!==text) chip.textContent=text;
      });
    });
  }

  function ensureModal(){
    if($('coreOrderEditModal')) return;
    const d=document.createElement('div');
    d.id='coreOrderEditModal';
    d.className='core-edit-overlay hidden';
    d.innerHTML=`<div class="core-edit-card">
      <div class="core-edit-head"><div><h2 id="coreEditTitle">編輯訂單</h2><div class="muted">管理員與員工可修改訂單資料、商品編號及每個品項最晚交期。</div></div><button type="button" class="core-edit-close" data-core-edit-close>×</button></div>
      <div id="coreOrderFields"></div>
      <div id="coreItemFields"></div>
      <div id="coreEditMsg" class="message"></div>
      <div class="core-edit-actions"><button type="button" class="btn ghost" data-core-edit-close>取消</button><button type="button" class="btn primary" id="coreEditSave">儲存修改</button></div>
    </div>`;
    document.body.appendChild(d);
    d.querySelectorAll('[data-core-edit-close]').forEach(b=>b.addEventListener('click',()=>d.classList.add('hidden')));
    $('coreEditSave').addEventListener('click',saveEdit);
  }

  let editingOrder=null;
  let editingItems=[];
  const statuses=['new','vendor_unconfirmed','vendor_confirmed','preparing','shipped','completed','cancelled','out_of_stock','delayed'];
  const statusText=s=>({new:'新訂單',vendor_unconfirmed:'待廠商確認',vendor_confirmed:'廠商已確認',preparing:'備貨中',shipped:'已出貨',completed:'已完成',cancelled:'已取消',out_of_stock:'缺貨',delayed:'延後'})[s]||s;

  async function openEdit(orderId){
    if(!canEdit()) return;
    ensureModal();
    try{
      const [ors,its]=await Promise.all([
        rest(`orders?select=*&id=eq.${encodeURIComponent(orderId)}`),
        rest(`order_items?select=*&order_id=eq.${encodeURIComponent(orderId)}&order=sort_order.asc`)
      ]);
      editingOrder=ors?.[0] || null;
      editingItems=its || [];
      if(!editingOrder) throw new Error('找不到訂單');
      $('coreEditTitle').textContent=`編輯 ORD-${String(editingOrder.tracking_id).padStart(6,'0')}`;
      $('coreOrderFields').innerHTML=`<div class="core-order-grid">
        <label>訂購日<input id="coreOrderDate" type="date" value="${esc(editingOrder.order_date||'')}"></label>
        <label>訂貨人<input id="coreBuyer" value="${esc(editingOrder.buyer||'')}"></label>
        <label>收貨人<input id="coreReceiver" value="${esc(editingOrder.receiver||'')}"></label>
        <label>電話<input id="corePhone" value="${esc(editingOrder.receiver_phone||'')}"></label>
        <label>運費<input id="coreFee" value="${esc(editingOrder.shipping_fee_text||'')}"></label>
        <label>狀態<select id="coreStatus">${statuses.map(s=>`<option value="${s}" ${editingOrder.status===s?'selected':''}>${statusText(s)}</option>`).join('')}</select></label>
        <label class="full">收貨地址<textarea id="coreAddress">${esc(editingOrder.receiver_address||'')}</textarea></label>
      </div>`;
      $('coreItemFields').innerHTML=editingItems.map((x,i)=>`<div class="core-item-editor" data-core-item="${esc(x.id)}">
        <b>品項 ${i+1}${x.variant?`｜${esc(x.variant)}`:''}</b>
        <div class="core-item-grid">
          <label>商品編號（最多10碼）<input data-core-field="code" maxlength="10" value="${esc(x.product_code||'')}"></label>
          <label>商品名稱<input data-core-field="name" value="${esc(x.product_name||'')}"></label>
          <label>數量<input data-core-field="qty" type="number" step="any" value="${x.quantity==null?'':esc(x.quantity)}"></label>
          <label>單位<input data-core-field="unit" value="${esc(x.quantity_unit||'')}"></label>
          <label>最晚交期<input data-core-field="deadline" type="date" value="${esc(x.expected_deadline||'')}"></label>
        </div>
      </div>`).join('') || '<p class="muted">沒有商品明細。</p>';
      $('coreEditMsg').textContent='';
      $('coreOrderEditModal').classList.remove('hidden');
    }catch(e){ alert(`編輯資料載入失敗：${e.message}`); }
  }

  async function saveEdit(){
    if(!editingOrder || !canEdit()) return;
    const msg=$('coreEditMsg'),btn=$('coreEditSave');
    const forms=[...document.querySelectorAll('[data-core-item]')];
    const updates=[];

    for(const f of forms){
      const code=f.querySelector('[data-core-field="code"]')?.value.trim() || '';
      if(!code){msg.textContent='商品編號不可空白。';msg.className='message error';return;}
      if([...code].length>10){msg.textContent=`商品編號「${code}」超過10碼。`;msg.className='message error';return;}
      const qraw=f.querySelector('[data-core-field="qty"]')?.value.trim() || '';
      const deadline=f.querySelector('[data-core-field="deadline"]')?.value || null;
      const original=editingItems.find(x=>x.id===f.dataset.coreItem) || {};
      updates.push({
        id:f.dataset.coreItem,
        product_code:code,
        product_name:f.querySelector('[data-core-field="name"]')?.value.trim() || '',
        quantity:qraw===''?null:Number(qraw),
        quantity_unit:f.querySelector('[data-core-field="unit"]')?.value.trim() || null,
        expected_from:original.expected_from && deadline && original.expected_from>deadline ? deadline : original.expected_from,
        expected_deadline:deadline,
        lead_time_text:role()==='admin'?'管理員調整':'員工調整'
      });
    }

    btn.disabled=true;btn.textContent='儲存中…';msg.textContent='';
    try{
      await rest(`orders?id=eq.${encodeURIComponent(editingOrder.id)}`,{
        method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({
          order_date:$('coreOrderDate').value || editingOrder.order_date,
          buyer:$('coreBuyer').value.trim() || null,
          receiver:$('coreReceiver').value.trim() || null,
          receiver_phone:$('corePhone').value.trim() || null,
          receiver_address:$('coreAddress').value.trim() || null,
          shipping_fee_text:$('coreFee').value.trim() || null,
          status:$('coreStatus').value
        })
      });

      for(const u of updates){
        const {id,...body}=u;
        await rest(`order_items?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});
      }

      const deadlines=updates.map(x=>x.expected_deadline).filter(Boolean).sort();
      const starts=updates.map(x=>x.expected_from).filter(Boolean).sort();
      await rest(`orders?id=eq.${encodeURIComponent(editingOrder.id)}`,{
        method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({
          expected_from:starts[0] || null,
          expected_deadline:deadlines.at(-1) || null,
          lead_time_text:role()==='admin'?'管理員調整':'員工調整'
        })
      });

      itemCache=null;
      msg.textContent='修改已儲存。';msg.className='message success';
      setTimeout(()=>location.reload(),500);
    }catch(e){msg.textContent=`儲存失敗：${e.message}`;msg.className='message error';}
    finally{btn.disabled=false;btn.textContent='儲存修改';}
  }

  let timer;
  function schedule(){
    clearTimeout(timer);
    timer=setTimeout(()=>{addEditButtons();addDeadlines();},220);
  }

  function install(){
    injectStyles();
    ensureModal();
    addEditButtons();
    addDeadlines();

    const or=$('orderRows');
    if(or && !or.dataset.coreEditDeadlineObserver){
      or.dataset.coreEditDeadlineObserver='1';
      new MutationObserver(schedule).observe(or,{childList:true,subtree:true});
    }
    const vr=$('vendorOrders');
    if(vr && !vr.dataset.coreEditDeadlineObserver){
      vr.dataset.coreEditDeadlineObserver='1';
      new MutationObserver(schedule).observe(vr,{childList:true,subtree:true});
    }

    document.addEventListener('click',e=>{
      const b=e.target.closest?.('[data-core-edit-order]');
      if(!b || !canEdit()) return;
      e.preventDefault();e.stopPropagation();
      openEdit(b.dataset.coreEditOrder);
    });

    setTimeout(schedule,350);
    setTimeout(schedule,1000);
    setTimeout(schedule,2000);
  }

  if(document.readyState==='loading') window.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();
