(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const SB = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_PUBLISHABLE_KEY;
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone:'Asia/Taipei' });

  function getSession(){
    try { return JSON.parse(localStorage.getItem('vendor_order_session') || 'null'); }
    catch { return null; }
  }
  function decodeJwt(token=''){
    try{
      const p=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      const pad=p.length%4?'='.repeat(4-p.length%4):'';
      return JSON.parse(decodeURIComponent(escape(atob(p+pad))));
    }catch{return {};}
  }
  function role(){ return decodeJwt(getSession()?.access_token || '').app_metadata?.role || ''; }

  async function rest(path, options={}){
    const s=getSession();
    if(!s?.access_token) throw new Error('登入已過期，請重新登入');
    const res=await fetch(`${SB}/rest/v1/${path}`,{
      ...options,
      headers:{
        apikey:KEY,
        Authorization:`Bearer ${s.access_token}`,
        'Content-Type':'application/json',
        ...(options.headers||{})
      }
    });
    const text=await res.text();
    if(!res.ok){
      let msg=text;
      try{const d=JSON.parse(text);msg=d.message||d.hint||d.details||text;}catch{}
      throw new Error(msg||`HTTP ${res.status}`);
    }
    return text?JSON.parse(text):null;
  }

  let cache=[];
  let loading=null;
  async function loadOverview(force=false){
    if(!force && cache.length) return cache;
    if(loading) return loading;
    loading=rest('order_item_shipping_overview?select=*&order=order_no.asc,sort_order.asc')
      .then(rows=>{cache=rows||[];return cache;})
      .finally(()=>{loading=null;});
    return loading;
  }
  function invalidate(){ cache=[]; }

  function qtyText(x){
    return x.quantity==null?'':` × ${esc(x.quantity)}${esc(x.quantity_unit||'')}`;
  }
  function itemTitle(x){
    const variant=x.variant?`｜${esc(x.variant)}`:'';
    return `<b class="item-product-code">${esc(x.product_code||'')}</b> <span>${esc(x.product_name||'')}${variant}${qtyText(x)}</span>`;
  }
  function shippingSummary(x){
    if(!x.actual_ship_date) return '<span class="item-ship-pending">待出貨</span>';
    const logistics=[x.carrier,x.tracking_no].filter(Boolean).map(esc).join('／');
    return `<div class="item-ship-summary">
      <span class="item-ship-done">已出貨</span>
      <span>預計 ${esc(x.promised_ship_date||'—')}</span>
      <span>實際 ${esc(x.actual_ship_date)}</span>
      <span><b>${Number(x.shipping_box_count||0)} 箱</b></span>
      ${logistics?`<span>物流 ${logistics}</span>`:''}
      ${x.note?`<span>備註 ${esc(x.note)}</span>`:''}
    </div>`;
  }

  function hideLegacyOrderShipping(card){
    card.querySelectorAll('.form-grid').forEach(el=>el.classList.add('legacy-order-shipping'));
    const oldSave=card.querySelector('[data-vendor-save]');
    if(oldSave) oldSave.classList.add('legacy-order-shipping');
    [...card.children].forEach(el=>{
      if(el.tagName==='LABEL' && el.querySelector('textarea[id^="v-note-"]')) el.classList.add('legacy-order-shipping');
    });
  }

  function vendorItemsHtml(list){
    return `<div class="item-pick-title">請勾選本次要出貨的商品</div>` + list.map(x=>`
      <label class="item-pick-row ${x.actual_ship_date?'is-shipped':''}">
        <input type="checkbox" class="item-ship-check" data-item-select="${esc(x.order_item_id)}">
        <div class="item-pick-main">
          <div>${itemTitle(x)}</div>
          ${shippingSummary(x)}
        </div>
      </label>`).join('');
  }

  function itemFormHtml(x){
    const promised=x.promised_ship_date || x.expected_deadline || '';
    const actual=x.actual_ship_date || today();
    const boxes=x.shipping_box_count==null?'':Number(x.shipping_box_count);
    return `<div class="item-shipping-form" data-item-shipping-form="${esc(x.order_item_id)}" data-order-id="${esc(x.order_id)}" data-vendor-id="${esc(x.vendor_id)}">
      <div class="item-form-head">${itemTitle(x)}</div>
      <div class="item-required-grid">
        <label>預計出貨日 <em>*必填</em><input type="date" data-f="promised" value="${esc(promised)}" required></label>
        <label>實際出貨日 <em>*必填</em><input type="date" data-f="actual" value="${esc(actual)}" required></label>
        <label>出貨箱數 <em>*必填</em><input type="number" data-f="boxes" inputmode="numeric" min="1" step="1" value="${esc(boxes)}" placeholder="例如 3" required></label>
      </div>
      <div class="item-optional-grid">
        <label>物流公司（選填）<input data-f="carrier" value="${esc(x.carrier||'')}" placeholder="黑貓／新竹物流…"></label>
        <label>物流單號（選填）<input data-f="tracking" value="${esc(x.tracking_no||'')}"></label>
      </div>
      <label>備註（選填）<textarea data-f="note">${esc(x.note||'')}</textarea></label>
    </div>`;
  }

  async function enhanceVendorOrders(){
    if(role()!=='vendor') return;
    const root=$('vendorOrders');
    if(!root) return;
    const cards=[...root.querySelectorAll('.order-card')];
    if(!cards.length) return;
    let rows;
    try{ rows=await loadOverview(); }catch(e){ console.warn('item shipping load failed',e.message); return; }

    for(const card of cards){
      const oldSave=card.querySelector('[data-vendor-save]');
      const orderId=oldSave?.dataset.vendorSave || card.dataset.itemShippingOrder;
      if(!orderId) continue;
      const list=rows.filter(x=>x.order_id===orderId);
      if(!list.length) continue;
      card.dataset.itemShippingOrder=orderId;
      hideLegacyOrderShipping(card);

      const productBox=card.querySelector('.order-products');
      if(productBox && productBox.dataset.itemShippingRendered!==orderId){
        productBox.dataset.itemShippingRendered=orderId;
        productBox.innerHTML=vendorItemsHtml(list);
      }

      if(!card.querySelector('[data-item-shipping-actions]')){
        const actions=document.createElement('div');
        actions.dataset.itemShippingActions='1';
        actions.className='item-shipping-actions';
        actions.innerHTML=`<button type="button" class="btn primary" data-prepare-item-shipping="${esc(orderId)}">出貨勾選商品</button><span class="muted">勾選商品後再輸入逐項出貨資料</span>`;
        const host=document.createElement('div');
        host.dataset.itemShippingHost=orderId;
        host.className='item-shipping-host';
        (productBox||card.firstElementChild)?.insertAdjacentElement('afterend',actions);
        actions.insertAdjacentElement('afterend',host);
      }
    }
  }

  async function prepareForms(btn){
    const card=btn.closest('.order-card');
    const orderId=btn.dataset.prepareItemShipping;
    if(!card||!orderId) return;
    const ids=[...card.querySelectorAll('[data-item-select]:checked')].map(x=>x.dataset.itemSelect).filter(Boolean);
    if(!ids.length){ alert('請先勾選這次要出貨的商品。'); return; }
    const rows=await loadOverview();
    const selected=rows.filter(x=>x.order_id===orderId && ids.includes(x.order_item_id));
    const host=card.querySelector(`[data-item-shipping-host="${CSS.escape(orderId)}"]`);
    if(!host) return;
    host.innerHTML=selected.map(itemFormHtml).join('') + `<button type="button" class="btn primary item-confirm-ship" data-save-item-shipping="${esc(orderId)}">確認並儲存出貨</button>`;
    host.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  function field(form,name){ return form.querySelector(`[data-f="${name}"]`); }

  async function saveForms(btn){
    const card=btn.closest('.order-card');
    const forms=[...(card?.querySelectorAll('[data-item-shipping-form]')||[])];
    const s=getSession();
    if(!forms.length||!s?.user?.id) return;
    const payload=[];
    for(const form of forms){
      const promised=field(form,'promised')?.value||'';
      const actual=field(form,'actual')?.value||'';
      const boxRaw=field(form,'boxes')?.value?.trim()||'';
      const boxes=Number(boxRaw);
      if(!promised){ alert('「預計出貨日」為必填。'); field(form,'promised')?.focus(); return; }
      if(!actual){ alert('「實際出貨日」為必填。'); field(form,'actual')?.focus(); return; }
      if(!boxRaw || !Number.isInteger(boxes) || boxes<1){ alert('「出貨箱數」為必填，請輸入 1 以上整數。'); field(form,'boxes')?.focus(); return; }
      payload.push({
        order_item_id:form.dataset.itemShippingForm,
        order_id:form.dataset.orderId,
        vendor_id:form.dataset.vendorId,
        promised_ship_date:promised,
        actual_ship_date:actual,
        shipping_box_count:boxes,
        carrier:field(form,'carrier')?.value?.trim()||null,
        tracking_no:field(form,'tracking')?.value?.trim()||null,
        note:field(form,'note')?.value?.trim()||null,
        shipped_by:s.user.id,
        updated_at:new Date().toISOString()
      });
    }
    btn.disabled=true;
    const old=btn.textContent;
    btn.textContent='儲存中…';
    try{
      await rest('order_item_shipments?on_conflict=order_item_id',{
        method:'POST',
        headers:{Prefer:'resolution=merge-duplicates,return=representation'},
        body:JSON.stringify(payload)
      });
      invalidate();
      alert(`已儲存 ${payload.length} 項商品出貨資料。`);
      $('vendorReloadBtn')?.click();
      setTimeout(enhanceVendorOrders,350);
    }catch(e){
      alert(`儲存失敗：${e.message}`);
      btn.disabled=false;
      btn.textContent=old||'確認並儲存出貨';
    }
  }

  function adminItemHtml(x){
    const variant=x.variant?`｜${esc(x.variant)}`:'';
    const info=x.actual_ship_date
      ? `<div class="admin-item-shipping"><b>已出貨</b>｜預計 ${esc(x.promised_ship_date||'—')}｜實際 ${esc(x.actual_ship_date)}｜<b>${Number(x.shipping_box_count||0)} 箱</b>${x.carrier||x.tracking_no?`<br>物流：${esc(x.carrier||'—')} ${x.tracking_no?`／ ${esc(x.tracking_no)}`:''}`:''}${x.note?`<br>備註：${esc(x.note)}`:''}</div>`
      : `<div class="admin-item-pending">尚未出貨</div>`;
    return `<div class="admin-item-row"><div><span class="product-code-chip">商品編號 ${esc(x.product_code||'')}</span></div><div class="admin-item-name">${esc(x.product_name||'')}${variant}${qtyText(x)}</div>${info}</div>`;
  }

  let adminTimer;
  async function enhanceAdmin(){
    if(!['admin','employee'].includes(role())) return;
    const body=$('orderRows');
    if(!body) return;
    let rows;
    try{rows=await loadOverview();}catch(e){console.warn('admin item shipping load failed',e.message);return;}
    const table=body.closest('table');
    const heads=[...(table?.querySelectorAll('thead th')||[])];
    const productIndex=heads.findIndex(th=>/商品編號|商品名稱|^商品$/.test(th.textContent.trim()));
    const replyIndex=heads.findIndex(th=>th.textContent.trim()==='廠商回覆');
    if(productIndex<0) return;

    body.querySelectorAll('tr').forEach(tr=>{
      const save=tr.querySelector('[data-save-status]');
      const orderId=save?.dataset.saveStatus;
      if(!orderId) return;
      const list=rows.filter(x=>x.order_id===orderId);
      if(!list.length) return;
      const cell=tr.children[productIndex];
      if(cell){
        cell.classList.add('admin-item-cell');
        cell.innerHTML=list.map(adminItemHtml).join('');
      }
      if(replyIndex>=0){
        const reply=tr.children[replyIndex];
        if(reply){
          reply.querySelector('.item-shipping-order-summary')?.remove();
          const shipped=list.filter(x=>x.actual_ship_date).length;
          const boxes=list.reduce((n,x)=>n+Number(x.shipping_box_count||0),0);
          const summary=document.createElement('div');
          summary.className='item-shipping-order-summary';
          summary.innerHTML=`逐商品出貨：<b>${shipped}/${list.length} 項</b>${shipped?`｜<b>${boxes} 箱</b>`:''}`;
          reply.appendChild(summary);
        }
      }
    });
  }
  function scheduleAdmin(){ clearTimeout(adminTimer); adminTimer=setTimeout(enhanceAdmin,80); }

  function injectStyles(){
    if($('itemShippingStyles')) return;
    const st=document.createElement('style');
    st.id='itemShippingStyles';
    st.textContent=`
      .legacy-order-shipping{display:none!important}
      .item-pick-title{font-weight:800;margin:0 0 10px;color:#344054}
      .item-pick-row{display:flex;gap:12px;align-items:flex-start;padding:12px;margin:8px 0;background:#fff;border:1px solid #d0d5dd;border-radius:12px;cursor:pointer}
      .item-pick-row.is-shipped{border-color:#abefc6;background:#f6fef9}
      .item-pick-row>input{width:22px;height:22px;flex:0 0 auto;margin:1px 0 0;accent-color:#0f766e}
      .item-pick-main{min-width:0;flex:1}.item-product-code{color:#0f766e}
      .item-ship-summary{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;font-size:12px;color:#475467}
      .item-ship-done{background:#dcfae6;color:#067647;border-radius:999px;padding:2px 7px;font-weight:800}
      .item-ship-pending{display:inline-block;margin-top:5px;background:#f2f4f7;color:#475467;border-radius:999px;padding:2px 7px;font-size:12px;font-weight:700}
      .item-shipping-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0}
      .item-shipping-host{margin:10px 0 18px}
      .item-shipping-form{border:2px solid #ccfbf1;background:#f8fffe;border-radius:14px;padding:14px;margin:12px 0}
      .item-form-head{font-weight:800;margin-bottom:10px}
      .item-required-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
      .item-optional-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .item-shipping-form label{display:block;font-size:13px;color:#475467;margin:8px 0}
      .item-shipping-form em{font-style:normal;color:#b42318;font-size:11px;font-weight:800}
      .item-confirm-ship{margin-top:4px;min-width:180px}
      .admin-item-row{padding:8px 0;border-bottom:1px dashed #d0d5dd}.admin-item-row:last-child{border-bottom:0}
      .admin-item-name{margin:5px 0;font-weight:600}.admin-item-shipping{margin-top:5px;padding:6px 8px;background:#ecfdf3;border-radius:8px;color:#175cd3;font-size:12px;line-height:1.55}
      .admin-item-pending{margin-top:5px;color:#667085;font-size:12px}.item-shipping-order-summary{margin-top:6px;padding-top:6px;border-top:1px dashed #d0d5dd;font-size:12px;color:#344054}
      @media(max-width:800px){.item-required-grid,.item-optional-grid{grid-template-columns:1fr}.item-pick-row{padding:12px 10px}.item-shipping-actions .btn,.item-confirm-ship{width:100%;min-height:46px}}
    `;
    document.head.appendChild(st);
  }

  function install(){
    injectStyles();
    const vendorRoot=$('vendorOrders');
    if(vendorRoot && !vendorRoot.dataset.itemShippingObserver){
      vendorRoot.dataset.itemShippingObserver='1';
      new MutationObserver(()=>setTimeout(enhanceVendorOrders,40)).observe(vendorRoot,{childList:true,subtree:true});
    }
    const orderRoot=$('orderRows');
    if(orderRoot && !orderRoot.dataset.itemShippingObserver){
      orderRoot.dataset.itemShippingObserver='1';
      new MutationObserver(scheduleAdmin).observe(orderRoot,{childList:true,subtree:true});
    }
    document.addEventListener('click',e=>{
      const prep=e.target.closest?.('[data-prepare-item-shipping]');
      if(prep && role()==='vendor'){e.preventDefault();prepareForms(prep);return;}
      const save=e.target.closest?.('[data-save-item-shipping]');
      if(save && role()==='vendor'){e.preventDefault();saveForms(save);return;}
      if(e.target.closest?.('#vendorReloadBtn,#reloadBtn')){invalidate();setTimeout(enhanceVendorOrders,300);setTimeout(enhanceAdmin,300);}
    });
    setTimeout(enhanceVendorOrders,250);setTimeout(enhanceVendorOrders,900);
    setTimeout(enhanceAdmin,300);setTimeout(enhanceAdmin,1000);
  }

  window.addEventListener('DOMContentLoaded',install);
})();
