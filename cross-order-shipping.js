(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const SB = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_PUBLISHABLE_KEY;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone:'Asia/Taipei' });

  function session(){
    try { return JSON.parse(localStorage.getItem('vendor_order_session') || 'null'); }
    catch { return null; }
  }
  function jwtRole(){
    try{
      const token=session()?.access_token || '';
      const p=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      const pad=p.length%4?'='.repeat(4-p.length%4):'';
      return JSON.parse(decodeURIComponent(escape(atob(p+pad)))).app_metadata?.role || '';
    }catch{return '';}
  }
  async function rest(path, options={}){
    const s=session();
    if(!s?.access_token) throw new Error('登入已過期，請重新登入');
    const res=await fetch(`${SB}/rest/v1/${path}`,{
      ...options,
      headers:{apikey:KEY,Authorization:`Bearer ${s.access_token}`,'Content-Type':'application/json',...(options.headers||{})}
    });
    const text=await res.text();
    if(!res.ok){
      let msg=text;
      try{const d=JSON.parse(text);msg=d.message||d.hint||d.details||text;}catch{}
      throw new Error(msg||`HTTP ${res.status}`);
    }
    return text?JSON.parse(text):null;
  }

  let itemCache=[];
  let itemLoading=null;
  async function loadItems(force=false){
    if(!force && itemCache.length) return itemCache;
    if(itemLoading) return itemLoading;
    itemLoading=rest('order_item_shipping_overview?select=*&order=order_no.asc,sort_order.asc')
      .then(rows=>{itemCache=rows||[];return itemCache;})
      .finally(()=>itemLoading=null);
    return itemLoading;
  }

  function selectedChecks(){
    return [...document.querySelectorAll('#vendorOrders [data-item-select]:checked:not(:disabled)')];
  }
  function selectedIds(){ return [...new Set(selectedChecks().map(x=>x.dataset.itemSelect).filter(Boolean))]; }

  function injectStyle(){
    if($('crossOrderShippingStyles')) return;
    const st=document.createElement('style');
    st.id='crossOrderShippingStyles';
    st.textContent=`
      #vendorView .item-shipping-actions,#vendorView .item-shipping-host{display:none!important}
      .cross-ship-help{margin:10px 0 16px;padding:12px 14px;border:1px solid #b2ddff;background:#eff8ff;border-radius:12px;color:#175cd3;font-weight:650}
      .cross-ship-bar{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:90;display:none;align-items:center;gap:12px;width:min(760px,calc(100vw - 28px));padding:12px 14px;background:#101828;color:#fff;border-radius:16px;box-shadow:0 14px 35px rgba(16,24,40,.25)}
      .cross-ship-bar.show{display:flex}.cross-ship-count{font-weight:800;flex:1}.cross-ship-orders{font-size:12px;color:#d0d5dd}
      .cross-ship-bar .btn{min-height:44px}.cross-ship-clear{background:transparent!important;color:#fff!important;border:1px solid #667085!important}
      .cross-ship-overlay{position:fixed;inset:0;z-index:120;background:rgba(16,24,40,.55);display:none;align-items:center;justify-content:center;padding:18px}
      .cross-ship-overlay.show{display:flex}.cross-ship-panel{width:min(820px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:18px;padding:20px;box-shadow:0 24px 60px rgba(0,0,0,.28)}
      .cross-ship-head{display:flex;align-items:flex-start;gap:12px;justify-content:space-between;margin-bottom:12px}.cross-ship-head h3{margin:0;font-size:22px}.cross-ship-close{border:0;background:#f2f4f7;border-radius:10px;width:40px;height:40px;font-size:22px;cursor:pointer}
      .cross-ship-selection{max-height:220px;overflow:auto;background:#f9fafb;border:1px solid #eaecf0;border-radius:12px;padding:10px;margin:12px 0}
      .cross-ship-item{padding:8px 6px;border-bottom:1px dashed #d0d5dd}.cross-ship-item:last-child{border-bottom:0}.cross-ship-order{font-size:12px;color:#667085;font-weight:700}.cross-ship-code{color:#0f766e;font-weight:850}
      .cross-required{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:14px}.cross-optional{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
      .cross-ship-panel label{font-weight:700;color:#344054}.cross-ship-panel label em{color:#d92d20;font-style:normal;font-size:12px}.cross-ship-panel input,.cross-ship-panel textarea{width:100%;margin-top:6px}.cross-ship-panel textarea{min-height:90px}.cross-submit{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}
      #vendorOrders .item-pick-row.is-shipped input[data-item-select]{opacity:.45}
      #vendorOrders .item-pick-row.is-shipped{cursor:default}
      .admin-batch-tag{display:inline-block;margin:4px 0 2px;padding:2px 7px;border-radius:999px;background:#eef4ff;color:#3538cd;font-size:11px;font-weight:800}
      @media(max-width:760px){
        .cross-ship-bar{bottom:10px;flex-wrap:wrap}.cross-ship-count{min-width:150px}.cross-ship-orders{width:100%;order:3}.cross-ship-bar .btn{flex:1}
        .cross-ship-overlay{padding:8px;align-items:flex-end}.cross-ship-panel{border-radius:18px 18px 8px 8px;max-height:90vh;padding:16px}
        .cross-required,.cross-optional{grid-template-columns:1fr}.cross-submit{position:sticky;bottom:-16px;background:#fff;padding:12px 0 16px}.cross-submit .btn{flex:1;min-height:48px}
      }
    `;
    document.head.appendChild(st);
  }

  function ensureVendorUI(){
    if(jwtRole()!=='vendor') return;
    injectStyle();
    const root=$('vendorOrders');
    if(!root) return;

    document.querySelectorAll('#vendorOrders .item-pick-row.is-shipped input[data-item-select]').forEach(cb=>{
      cb.checked=false; cb.disabled=true; cb.title='此商品已有出貨紀錄';
    });

    if(!$('crossShipHelp')){
      const help=document.createElement('div');
      help.id='crossShipHelp'; help.className='cross-ship-help';
      help.textContent='可跨不同訂單勾選多個商品，最後一次填寫同一批出貨日期、總箱數與物流資料。';
      root.parentElement?.insertBefore(help,root);
    }
    if(!$('crossShipBar')){
      const bar=document.createElement('div');
      bar.id='crossShipBar'; bar.className='cross-ship-bar';
      bar.innerHTML=`<div class="cross-ship-count">已選 <span id="crossShipCount">0</span> 項</div><div class="cross-ship-orders" id="crossShipOrders"></div><button type="button" class="btn cross-ship-clear" id="crossShipClear">取消選取</button><button type="button" class="btn primary" id="crossShipOpen">批次出貨</button>`;
      document.body.appendChild(bar);
    }
    if(!$('crossShipOverlay')){
      const overlay=document.createElement('div');
      overlay.id='crossShipOverlay'; overlay.className='cross-ship-overlay';
      overlay.innerHTML=`<div class="cross-ship-panel" role="dialog" aria-modal="true" aria-labelledby="crossShipTitle">
        <div class="cross-ship-head"><div><h3 id="crossShipTitle">跨訂單批次出貨</h3><div class="muted">以下商品會共用同一批出貨資料；出貨箱數代表整批總箱數。</div></div><button type="button" class="cross-ship-close" id="crossShipClose" aria-label="關閉">×</button></div>
        <div id="crossShipSelection" class="cross-ship-selection"></div>
        <div class="cross-required">
          <label>預計出貨日 <em>*必填</em><input id="crossPromised" type="date" required></label>
          <label>實際出貨日 <em>*必填</em><input id="crossActual" type="date" required></label>
          <label>本批出貨箱數 <em>*必填</em><input id="crossBoxes" type="number" inputmode="numeric" min="1" step="1" placeholder="例如 3" required></label>
        </div>
        <div class="cross-optional">
          <label>物流公司（選填）<input id="crossCarrier" placeholder="黑貓／新竹物流…"></label>
          <label>物流單號（選填）<input id="crossTracking"></label>
        </div>
        <label style="display:block;margin-top:12px">備註（選填）<textarea id="crossNote"></textarea></label>
        <div class="cross-submit"><button type="button" class="btn ghost" id="crossShipCancel">取消</button><button type="button" class="btn primary" id="crossShipSave">確認並儲存整批出貨</button></div>
      </div>`;
      document.body.appendChild(overlay);
    }
    updateBar();
  }

  async function updateBar(){
    if(jwtRole()!=='vendor') return;
    const ids=selectedIds();
    const bar=$('crossShipBar'); if(!bar) return;
    $('crossShipCount').textContent=String(ids.length);
    bar.classList.toggle('show',ids.length>0);
    if(!ids.length){ $('crossShipOrders').textContent=''; return; }
    try{
      const rows=await loadItems();
      const orderNos=[...new Set(rows.filter(x=>ids.includes(x.order_item_id)).map(x=>x.order_no))];
      $('crossShipOrders').textContent=`跨 ${orderNos.length} 張訂單：${orderNos.join('、')}`;
    }catch{ $('crossShipOrders').textContent=''; }
  }

  function clearSelection(){
    document.querySelectorAll('#vendorOrders [data-item-select]:checked').forEach(cb=>cb.checked=false);
    updateBar();
  }

  async function openBatch(){
    const ids=selectedIds();
    if(!ids.length) return alert('請先勾選要一起出貨的商品。');
    let rows;
    try{rows=await loadItems();}catch(e){return alert(`商品資料載入失敗：${e.message}`);}
    const picked=rows.filter(x=>ids.includes(x.order_item_id));
    if(picked.length!==ids.length) return alert('部分商品資料已變更，請重新整理後再勾選。');
    $('crossShipSelection').innerHTML=picked.map(x=>`<div class="cross-ship-item"><div class="cross-ship-order">${esc(x.order_no)}</div><span class="cross-ship-code">${esc(x.product_code||'')}</span> ${esc(x.product_name||'')}${x.variant?`｜${esc(x.variant)}`:''}${x.quantity!=null?` × ${esc(x.quantity)}${esc(x.quantity_unit||'')}`:''}</div>`).join('');
    $('crossPromised').value='';
    $('crossActual').value=today();
    $('crossBoxes').value=''; $('crossCarrier').value=''; $('crossTracking').value=''; $('crossNote').value='';
    $('crossShipOverlay').classList.add('show');
    document.body.style.overflow='hidden';
  }
  function closeBatch(){ $('crossShipOverlay')?.classList.remove('show'); document.body.style.overflow=''; }

  async function saveBatch(){
    const ids=selectedIds();
    const promised=$('crossPromised')?.value||'';
    const actual=$('crossActual')?.value||'';
    const boxRaw=$('crossBoxes')?.value?.trim()||'';
    const boxes=Number(boxRaw);
    if(!ids.length) return alert('沒有選取商品。');
    if(!promised){alert('「預計出貨日」為必填。');$('crossPromised')?.focus();return;}
    if(!actual){alert('「實際出貨日」為必填。');$('crossActual')?.focus();return;}
    if(!boxRaw||!Number.isInteger(boxes)||boxes<1){alert('「本批出貨箱數」為必填，請輸入 1 以上整數。');$('crossBoxes')?.focus();return;}
    const btn=$('crossShipSave'); const old=btn.textContent; btn.disabled=true; btn.textContent='儲存中…';
    try{
      const result=await rest('rpc/create_vendor_shipping_batch',{
        method:'POST',
        body:JSON.stringify({
          p_item_ids:ids,
          p_promised_ship_date:promised,
          p_actual_ship_date:actual,
          p_shipping_box_count:boxes,
          p_carrier:$('crossCarrier')?.value?.trim()||null,
          p_tracking_no:$('crossTracking')?.value?.trim()||null,
          p_note:$('crossNote')?.value?.trim()||null
        })
      });
      const row=Array.isArray(result)?result[0]:result;
      closeBatch(); clearSelection(); itemCache=[];
      alert(`出貨已儲存。\n批次：${row?.batch_code||'已建立'}\n商品：${row?.item_count||ids.length} 項\n總箱數：${boxes} 箱`);
      $('vendorReloadBtn')?.click();
      setTimeout(()=>{itemCache=[];ensureVendorUI();},500);
    }catch(e){
      alert(`批次出貨儲存失敗：${e.message}`);
    }finally{btn.disabled=false;btn.textContent=old;}
  }

  let adminCache=[];
  async function enhanceAdminBatch(){
    if(!['admin','employee'].includes(jwtRole())) return;
    const body=$('orderRows'); if(!body) return;
    try{adminCache=await rest('order_item_shipping_overview?select=*&order=order_no.asc,sort_order.asc');}catch{return;}
    const table=body.closest('table'); const heads=[...(table?.querySelectorAll('thead th')||[])];
    const productIndex=heads.findIndex(th=>/商品編號|商品名稱|^商品$/.test(th.textContent.trim()));
    const replyIndex=heads.findIndex(th=>th.textContent.trim()==='廠商回覆');
    if(productIndex<0) return;
    body.querySelectorAll('tr').forEach(tr=>{
      if(tr.children.length!==heads.length) return;
      const orderId=tr.querySelector('[data-save-status]')?.dataset.saveStatus; if(!orderId) return;
      const list=adminCache.filter(x=>x.order_id===orderId);
      const productRows=[...(tr.children[productIndex]?.querySelectorAll('.admin-item-row')||[])];
      productRows.forEach((el,i)=>{
        const x=list[i]; if(!x?.shipment_batch_no) return;
        const info=el.querySelector('.admin-item-shipping'); if(!info) return;
        let tag=info.querySelector('.admin-batch-tag');
        if(!tag){tag=document.createElement('span');tag.className='admin-batch-tag';info.prepend(tag);}
        tag.textContent=`批次 ${x.shipment_batch_no}`;
      });
      if(replyIndex>=0){
        const summary=tr.children[replyIndex]?.querySelector('.item-shipping-order-summary');
        if(summary){
          const shipped=list.filter(x=>x.actual_ship_date);
          const groups=new Map();
          shipped.forEach(x=>{
            const key=x.shipment_batch_id||`legacy:${x.order_item_id}`;
            if(!groups.has(key)) groups.set(key,Number(x.shipping_box_count||0));
          });
          const boxes=[...groups.values()].reduce((a,b)=>a+b,0);
          summary.innerHTML=`逐商品出貨：<b>${shipped.length}/${list.length} 項</b>${shipped.length?`｜涉及批次箱數 <b>${boxes} 箱</b>`:''}`;
        }
      }
    });
  }

  function install(){
    injectStyle();
    document.addEventListener('change',e=>{
      if(e.target.matches?.('#vendorOrders [data-item-select]')) updateBar();
    });
    document.addEventListener('click',e=>{
      if(e.target.closest?.('#crossShipOpen')) openBatch();
      if(e.target.closest?.('#crossShipClear')) clearSelection();
      if(e.target.closest?.('#crossShipClose')||e.target.closest?.('#crossShipCancel')) closeBatch();
      if(e.target.closest?.('#crossShipSave')) saveBatch();
      if(e.target.id==='crossShipOverlay') closeBatch();
    });
    const root=$('vendorOrders');
    if(root) new MutationObserver(()=>setTimeout(ensureVendorUI,50)).observe(root,{childList:true,subtree:true});
    const admin=$('orderRows');
    if(admin){let t;new MutationObserver(()=>{clearTimeout(t);t=setTimeout(enhanceAdminBatch,300);}).observe(admin,{childList:true,subtree:true});}
    setTimeout(ensureVendorUI,400);setTimeout(ensureVendorUI,1000);
    setTimeout(enhanceAdminBatch,700);setTimeout(enhanceAdminBatch,1500);
    $('loginBtn')?.addEventListener('click',()=>{setTimeout(ensureVendorUI,800);setTimeout(enhanceAdminBatch,1000);});
    $('vendorReloadBtn')?.addEventListener('click',()=>{itemCache=[];setTimeout(ensureVendorUI,450);});
    $('reloadBtn')?.addEventListener('click',()=>setTimeout(enhanceAdminBatch,600));
  }
  window.addEventListener('DOMContentLoaded',install);
})();
