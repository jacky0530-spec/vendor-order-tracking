(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const SB = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_PUBLISHABLE_KEY;
  const ADMIN_API = CFG.ADMIN_API_URL;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function session(){
    try{return JSON.parse(localStorage.getItem('vendor_order_session') || 'null');}
    catch{return null;}
  }
  function jwt(token=''){
    try{
      const p=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      const pad=p.length%4?'='.repeat(4-p.length%4):'';
      return JSON.parse(decodeURIComponent(escape(atob(p+pad))));
    }catch{return {};}
  }
  function role(){ return jwt(session()?.access_token || '').app_metadata?.role || ''; }

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
      throw new Error(m||`HTTP ${r.status}`);
    }
    return t?JSON.parse(t):null;
  }

  async function edge(body){
    const s=session();
    if(!s?.access_token) throw new Error('登入已過期，請重新登入');
    const r=await fetch(ADMIN_API,{method:'POST',headers:{Authorization:`Bearer ${s.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error||d.message||`HTTP ${r.status}`);
    return d;
  }

  function injectStyles(){
    if($('employeeOrderToolsStyles')) return;
    const st=document.createElement('style');
    st.id='employeeOrderToolsStyles';
    st.textContent=`
      .item-deadline-chip{display:inline-block;margin-left:8px;padding:3px 7px;border-radius:999px;background:#fff4e5;color:#b54708;font-size:11px;font-weight:800;white-space:nowrap}
      .buyer-line{display:inline-block;margin-top:4px;font-size:12px;color:#344054}
      .employee-edit-btn{margin-top:6px!important}
      .employee-modal{position:fixed;inset:0;z-index:100000;background:rgba(16,24,40,.62);display:flex;align-items:center;justify-content:center;padding:16px}
      .employee-modal.hidden{display:none}.employee-modal-card{width:min(980px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:18px;padding:20px;box-shadow:0 24px 70px rgba(0,0,0,.3)}
      .employee-modal-head{display:flex;gap:12px;align-items:flex-start;justify-content:space-between}.employee-modal-head h2{margin:0}.employee-modal-close{border:0;background:#f2f4f7;width:40px;height:40px;border-radius:10px;font-size:22px;cursor:pointer}
      .employee-order-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0}.employee-order-grid .full{grid-column:1/-1}
      .employee-items-edit{display:grid;gap:12px}.employee-item-edit{border:1px solid #d0d5dd;border-radius:14px;padding:14px;background:#f9fafb}.employee-item-grid{display:grid;grid-template-columns:1.1fr 2fr .7fr .7fr 1fr;gap:10px}
      .employee-modal label{display:block;font-weight:700;color:#344054}.employee-modal input,.employee-modal select,.employee-modal textarea{width:100%;margin-top:5px}.employee-modal textarea{min-height:72px}
      .employee-modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px;position:sticky;bottom:-20px;background:#fff;padding:14px 0 4px}
      .employee-pass-note{font-size:12px;color:#667085;margin-top:8px}
      body.role-employee .tab[data-tab="vendors"],body.role-employee .tab[data-tab="review"],body.role-employee .tab[data-tab="history"],body.role-employee .tab[data-tab="employees"]{display:none!important}
      @media(max-width:800px){.employee-order-grid,.employee-item-grid{grid-template-columns:1fr}.employee-order-grid .full{grid-column:auto}.employee-modal{padding:6px;align-items:flex-end}.employee-modal-card{border-radius:18px 18px 8px 8px;max-height:94vh}.employee-modal-actions .btn{flex:1}}
    `;
    document.head.appendChild(st);
  }

  function replaceEmployeeReload(){
    if(role()!=='employee') return;
    const old=$('reloadBtn');
    if(!old || old.dataset.employeeSafeReload==='1') return;
    const clone=old.cloneNode(true);
    clone.dataset.employeeSafeReload='1';
    old.replaceWith(clone);
    clone.addEventListener('click',(e)=>{
      // accounts.js 會程式化 click；該次不刷新，避免無限重新整理。
      if(e.isTrusted) location.reload();
    });
  }

  function ensurePasswordButton(){
    if(role()!=='employee' || $('employeePasswordBtn')) return;
    const logout=$('logoutBtn');
    if(!logout) return;
    const b=document.createElement('button');
    b.id='employeePasswordBtn';
    b.className='btn ghost';
    b.textContent='修改密碼';
    logout.parentElement?.insertBefore(b,logout);
    b.addEventListener('click',openPasswordModal);
  }

  function ensurePasswordModal(){
    if($('employeePasswordModal')) return;
    const d=document.createElement('div');
    d.id='employeePasswordModal';d.className='employee-modal hidden';
    d.innerHTML=`<div class="employee-modal-card" style="width:min(480px,100%)">
      <div class="employee-modal-head"><div><h2>修改員工密碼</h2><div class="employee-pass-note">至少 8 碼。修改後管理者不會看到你的私人新密碼。</div></div><button type="button" class="employee-modal-close" data-close-employee-pass>×</button></div>
      <label style="margin-top:14px">新密碼<input id="employeePass1" type="password" autocomplete="new-password"></label>
      <label>再次輸入<input id="employeePass2" type="password" autocomplete="new-password"></label>
      <div id="employeePassMsg" class="message"></div>
      <div class="employee-modal-actions"><button type="button" class="btn ghost" data-close-employee-pass>取消</button><button type="button" class="btn primary" id="employeePassSave">儲存新密碼</button></div>
    </div>`;
    document.body.appendChild(d);
    d.querySelectorAll('[data-close-employee-pass]').forEach(x=>x.addEventListener('click',()=>d.classList.add('hidden')));
    $('employeePassSave').addEventListener('click',savePassword);
  }
  function openPasswordModal(){ensurePasswordModal();$('employeePass1').value='';$('employeePass2').value='';$('employeePassMsg').textContent='';$('employeePasswordModal').classList.remove('hidden');}
  async function savePassword(){
    const a=$('employeePass1').value,b=$('employeePass2').value,m=$('employeePassMsg'),btn=$('employeePassSave');
    if(a.length<8){m.textContent='新密碼至少 8 碼。';m.className='message error';return;}
    if(a!==b){m.textContent='兩次密碼不一致。';m.className='message error';return;}
    btn.disabled=true;btn.textContent='儲存中…';
    try{await edge({action:'change_password',password:a});m.textContent='密碼已修改成功。';m.className='message success';setTimeout(()=>$('employeePasswordModal')?.classList.add('hidden'),650);}
    catch(e){m.textContent=e.message;m.className='message error';}
    finally{btn.disabled=false;btn.textContent='儲存新密碼';}
  }

  let deadlineRows=null,deadlineLoading=null;
  async function shippingRows(force=false){
    if(force)deadlineRows=null;
    if(deadlineRows) return deadlineRows;
    if(deadlineLoading) return deadlineLoading;
    deadlineLoading=rest('order_item_shipping_overview?select=*&order=order_no.asc,sort_order.asc').then(x=>deadlineRows=x||[]).finally(()=>deadlineLoading=null);
    return deadlineLoading;
  }

  async function enhanceDeadlines(){
    const r=role();
    if(!['admin','employee','vendor'].includes(r)) return;
    const all=await shippingRows().catch(()=>[]);
    if(r==='vendor'){
      document.querySelectorAll('#vendorOrders .item-pick-row').forEach(row=>{
        const id=row.querySelector('[data-item-select]')?.dataset.itemSelect;
        if(!id || row.querySelector('.item-deadline-chip')) return;
        const x=all.find(z=>z.order_item_id===id);
        if(!x?.expected_deadline) return;
        const chip=document.createElement('span');chip.className='item-deadline-chip';chip.textContent=`最晚交期 ${x.expected_deadline}`;
        row.querySelector('.item-pick-main > div')?.appendChild(chip);
      });
      return;
    }
    document.querySelectorAll('#orderRows tr').forEach(tr=>{
      const orderId=tr.querySelector('[data-save-status]')?.dataset.saveStatus;
      if(!orderId) return;
      const list=all.filter(x=>x.order_id===orderId).sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0));
      if(!list.length) return;
      const productCell=tr.children[2];if(!productCell)return;
      const rows=[...productCell.querySelectorAll('.admin-item-row')];
      if(rows.length){
        rows.forEach((row,i)=>{
          if(row.querySelector('.item-deadline-chip'))return;
          const x=list[i];if(!x?.expected_deadline)return;
          const chip=document.createElement('span');chip.className='item-deadline-chip';chip.textContent=`最晚交期 ${x.expected_deadline}`;
          row.querySelector('.admin-item-name')?.appendChild(chip);
        });
      }else{
        const lines=[...productCell.querySelectorAll('.product-line')];
        lines.forEach((line,i)=>{
          if(line.querySelector('.item-deadline-chip'))return;
          const x=list[i];if(!x?.expected_deadline)return;
          const chip=document.createElement('span');chip.className='item-deadline-chip';chip.textContent=`最晚交期 ${x.expected_deadline}`;line.appendChild(chip);
        });
      }
    });
  }

  function ensureEditButtons(){
    if(role()!=='employee') return;
    document.body.classList.add('role-employee');
    document.querySelectorAll('#orderRows tr').forEach(tr=>{
      const save=tr.querySelector('[data-save-status]');
      if(!save || tr.querySelector('[data-employee-edit]')) return;
      const b=document.createElement('button');
      b.type='button';b.className='btn small secondary employee-edit-btn';b.dataset.employeeEdit=save.dataset.saveStatus;b.textContent='編輯訂單';
      tr.lastElementChild?.appendChild(b);
    });
  }

  function ensureEditModal(){
    if($('employeeOrderModal')) return;
    const d=document.createElement('div');d.id='employeeOrderModal';d.className='employee-modal hidden';
    d.innerHTML=`<div class="employee-modal-card">
      <div class="employee-modal-head"><div><h2 id="employeeEditTitle">編輯訂單</h2><div class="muted">員工可調整訂單基本資料、商品編號與逐品項最晚交期。</div></div><button type="button" class="employee-modal-close" data-close-employee-edit>×</button></div>
      <div id="employeeOrderFields"></div><div id="employeeItemFields" class="employee-items-edit"></div>
      <div id="employeeEditMsg" class="message"></div>
      <div class="employee-modal-actions"><button type="button" class="btn ghost" data-close-employee-edit>取消</button><button type="button" class="btn primary" id="employeeEditSave">儲存修改</button></div>
    </div>`;
    document.body.appendChild(d);
    d.querySelectorAll('[data-close-employee-edit]').forEach(x=>x.addEventListener('click',()=>d.classList.add('hidden')));
    $('employeeEditSave').addEventListener('click',saveOrderEdit);
  }

  let editingOrder=null,editingItems=[];
  const statuses=['new','vendor_unconfirmed','vendor_confirmed','preparing','shipped','completed','cancelled','out_of_stock','delayed'];
  const statusName=s=>({new:'新訂單',vendor_unconfirmed:'待廠商確認',vendor_confirmed:'廠商已確認',preparing:'備貨中',shipped:'已出貨',completed:'已完成',cancelled:'已取消',out_of_stock:'缺貨',delayed:'延後'})[s]||s;

  async function openOrderEdit(orderId){
    ensureEditModal();
    try{
      const [orows,irows]=await Promise.all([
        rest(`orders?select=*&id=eq.${encodeURIComponent(orderId)}`),
        rest(`order_items?select=*&order_id=eq.${encodeURIComponent(orderId)}&order=sort_order.asc`)
      ]);
      editingOrder=orows?.[0];editingItems=irows||[];
      if(!editingOrder) throw new Error('找不到訂單');
      $('employeeEditTitle').textContent=`編輯 ORD-${String(editingOrder.tracking_id).padStart(6,'0')}`;
      $('employeeOrderFields').innerHTML=`<div class="employee-order-grid">
        <label>訂購日<input id="eeOrderDate" type="date" value="${esc(editingOrder.order_date||'')}"></label>
        <label>訂貨人<input id="eeBuyer" value="${esc(editingOrder.buyer||'')}"></label>
        <label>收貨人<input id="eeReceiver" value="${esc(editingOrder.receiver||'')}"></label>
        <label>電話<input id="eePhone" value="${esc(editingOrder.receiver_phone||'')}"></label>
        <label>運費<input id="eeFee" value="${esc(editingOrder.shipping_fee_text||'')}"></label>
        <label>狀態<select id="eeStatus">${statuses.map(s=>`<option value="${s}" ${editingOrder.status===s?'selected':''}>${statusName(s)}</option>`).join('')}</select></label>
        <label class="full">收貨地址<textarea id="eeAddress">${esc(editingOrder.receiver_address||'')}</textarea></label>
      </div>`;
      $('employeeItemFields').innerHTML=editingItems.map((x,i)=>`<div class="employee-item-edit" data-ee-item="${esc(x.id)}">
        <b>品項 ${i+1}</b>
        <div class="employee-item-grid">
          <label>商品編號（最多10碼）<input data-ee="code" maxlength="10" value="${esc(x.product_code||'')}"></label>
          <label>商品名稱<input data-ee="name" value="${esc(x.product_name||'')}"></label>
          <label>數量<input data-ee="qty" type="number" step="any" value="${x.quantity==null?'':esc(x.quantity)}"></label>
          <label>單位<input data-ee="unit" value="${esc(x.quantity_unit||'')}"></label>
          <label>最晚交期<input data-ee="deadline" type="date" value="${esc(x.expected_deadline||'')}"></label>
        </div>
        ${x.variant?`<div class="muted" style="margin-top:6px">規格：${esc(x.variant)}</div>`:''}
      </div>`).join('') || '<p class="muted">沒有商品明細。</p>';
      $('employeeEditMsg').textContent='';$('employeeOrderModal').classList.remove('hidden');
    }catch(e){alert(`編輯資料載入失敗：${e.message}`);}
  }

  async function saveOrderEdit(){
    if(!editingOrder) return;
    const btn=$('employeeEditSave'),msg=$('employeeEditMsg');
    const forms=[...document.querySelectorAll('[data-ee-item]')];
    const payloads=[];
    for(const f of forms){
      const code=f.querySelector('[data-ee="code"]')?.value.trim()||'';
      if(!code){msg.textContent='商品編號不可空白。';msg.className='message error';return;}
      if([...code].length>10){msg.textContent=`商品編號「${code}」超過 10 碼。`;msg.className='message error';return;}
      const deadline=f.querySelector('[data-ee="deadline"]')?.value||null;
      const qraw=f.querySelector('[data-ee="qty"]')?.value?.trim()||'';
      payloads.push({id:f.dataset.eeItem,product_code:code,product_name:f.querySelector('[data-ee="name"]')?.value.trim()||'',quantity:qraw===''?null:Number(qraw),quantity_unit:f.querySelector('[data-ee="unit"]')?.value.trim()||null,expected_deadline:deadline,expected_from:deadline,lead_time_text:'員工調整'});
    }
    btn.disabled=true;btn.textContent='儲存中…';msg.textContent='';
    try{
      await rest(`orders?id=eq.${encodeURIComponent(editingOrder.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({order_date:$('eeOrderDate').value||editingOrder.order_date,buyer:$('eeBuyer').value.trim()||null,receiver:$('eeReceiver').value.trim()||null,receiver_phone:$('eePhone').value.trim()||null,receiver_address:$('eeAddress').value.trim()||null,shipping_fee_text:$('eeFee').value.trim()||null,status:$('eeStatus').value})});
      for(const p of payloads){
        const {id,...body}=p;
        await rest(`order_items?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});
      }
      const dates=payloads.map(x=>x.expected_deadline).filter(Boolean).sort();
      if(dates.length){
        await rest(`orders?id=eq.${encodeURIComponent(editingOrder.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({expected_from:dates[0],expected_deadline:dates[dates.length-1],lead_time_text:'員工調整'})});
      }
      msg.textContent='修改已儲存。';msg.className='message success';deadlineRows=null;
      setTimeout(()=>location.reload(),550);
    }catch(e){msg.textContent=`儲存失敗：${e.message}`;msg.className='message error';}
    finally{btn.disabled=false;btn.textContent='儲存修改';}
  }

  let timer;
  function scheduleEnhance(){
    clearTimeout(timer);
    timer=setTimeout(()=>{replaceEmployeeReload();ensurePasswordButton();ensureEditButtons();enhanceDeadlines();},80);
  }

  function install(){
    injectStyles();
    replaceEmployeeReload();
    ensurePasswordButton();
    ensureEditModal();
    ensurePasswordModal();
    ensureEditButtons();
    enhanceDeadlines();
    const or=$('orderRows');if(or&&!or.dataset.employeeToolsObserver){or.dataset.employeeToolsObserver='1';new MutationObserver(scheduleEnhance).observe(or,{childList:true,subtree:true});}
    const vr=$('vendorOrders');if(vr&&!vr.dataset.employeeDeadlineObserver){vr.dataset.employeeDeadlineObserver='1';new MutationObserver(scheduleEnhance).observe(vr,{childList:true,subtree:true});}
    document.addEventListener('click',e=>{const b=e.target.closest?.('[data-employee-edit]');if(b&&role()==='employee'){e.preventDefault();openOrderEdit(b.dataset.employeeEdit);}});
    setTimeout(scheduleEnhance,250);setTimeout(scheduleEnhance,800);setTimeout(scheduleEnhance,1600);
  }

  if(document.readyState==='loading') window.addEventListener('DOMContentLoaded',install);
  else install();
})();