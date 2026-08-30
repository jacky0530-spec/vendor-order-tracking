(() => {
  'use strict';

  const VERSION = 'V2.7';
  const PREF_KEY = 'vendor_order_show_shipped';
  const $ = (id) => document.getElementById(id);

  function session(){
    try{return JSON.parse(localStorage.getItem('vendor_order_session')||'null');}
    catch{return null;}
  }
  function role(){
    try{
      const token=session()?.access_token||'';
      const p=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      const pad=p.length%4?'='.repeat(4-p.length%4):'';
      return JSON.parse(decodeURIComponent(escape(atob(p+pad)))).app_metadata?.role||'';
    }catch{return '';}
  }

  function injectStyles(){
    if($('vendorDisplayOptionsStyles')) return;
    const st=document.createElement('style');
    st.id='vendorDisplayOptionsStyles';
    st.textContent=`
      .system-version-chip{display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border-radius:999px;background:#eef4ff;color:#3538cd;border:1px solid #c7d7fe;font-size:12px;font-weight:800;white-space:nowrap}
      .view-version-row{display:flex;justify-content:flex-end;margin:0 0 10px}
      .vendor-display-options{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin:12px 0 16px;padding:12px 14px;border:1px solid #d0d5dd;border-radius:12px;background:#fff}
      .vendor-display-toggle{display:flex;align-items:center;gap:9px;font-weight:750;color:#344054;cursor:pointer;margin:0}
      .vendor-display-toggle input{width:20px;height:20px;accent-color:#0f766e;flex:0 0 auto}
      .vendor-hidden-summary{font-size:12px;color:#667085}
      #vendorOrders .vendor-hide-shipped-item{display:none!important}
      #vendorOrders .vendor-hide-completed-order{display:none!important}
      @media(max-width:760px){
        .view-version-row{justify-content:flex-start}.vendor-display-options{align-items:flex-start}.vendor-display-toggle{width:100%;font-size:15px}.vendor-hidden-summary{width:100%;padding-left:29px}
      }
    `;
    document.head.appendChild(st);
  }

  function addVersionBadges(){
    const admin=$('adminView');
    if(admin && !$('adminVersionRow')){
      const row=document.createElement('div');
      row.id='adminVersionRow'; row.className='view-version-row';
      row.innerHTML=`<span class="system-version-chip">系統版本 ${VERSION}</span>`;
      admin.insertBefore(row,admin.firstElementChild);
    }
    const vendor=$('vendorView');
    if(vendor && !$('vendorVersionRow')){
      const card=vendor.querySelector('.section-card');
      const row=document.createElement('div');
      row.id='vendorVersionRow'; row.className='view-version-row';
      row.innerHTML=`<span class="system-version-chip">系統版本 ${VERSION}</span>`;
      if(card) card.insertBefore(row,card.firstElementChild); else vendor.prepend(row);
    }
  }

  function getShowShipped(){ return localStorage.getItem(PREF_KEY)==='1'; }

  function ensureVendorToggle(){
    if(role()!=='vendor') return;
    const root=$('vendorOrders');
    if(!root || $('vendorDisplayOptions')) return;
    const panel=document.createElement('div');
    panel.id='vendorDisplayOptions'; panel.className='vendor-display-options';
    panel.innerHTML=`
      <label class="vendor-display-toggle">
        <input type="checkbox" id="vendorShowShipped">
        <span>顯示已出貨訂單／商品</span>
      </label>
      <span id="vendorHiddenSummary" class="vendor-hidden-summary"></span>`;
    root.parentElement?.insertBefore(panel,root);
    const cb=$('vendorShowShipped');
    cb.checked=getShowShipped();
    cb.addEventListener('change',()=>{
      localStorage.setItem(PREF_KEY,cb.checked?'1':'0');
      applyVendorFilter();
    });
  }

  let applying=false;
  function applyVendorFilter(){
    if(applying || role()!=='vendor') return;
    const root=$('vendorOrders');
    if(!root) return;
    applying=true;
    try{
      ensureVendorToggle();
      const show=$('vendorShowShipped')?.checked ?? getShowShipped();
      let hiddenItems=0, hiddenOrders=0;
      root.querySelectorAll('.order-card').forEach(card=>{
        const rows=[...card.querySelectorAll('.item-pick-row')];
        if(!rows.length){
          card.classList.remove('vendor-hide-completed-order');
          return;
        }
        rows.forEach(row=>{
          const shipped=row.classList.contains('is-shipped');
          row.classList.toggle('vendor-hide-shipped-item',!show&&shipped);
          if(!show&&shipped) hiddenItems++;
        });
        const allShipped=rows.every(row=>row.classList.contains('is-shipped'));
        card.classList.toggle('vendor-hide-completed-order',!show&&allShipped);
        if(!show&&allShipped) hiddenOrders++;
      });
      const summary=$('vendorHiddenSummary');
      if(summary){
        summary.textContent=show ? '目前顯示全部訂單與商品' : `已隱藏 ${hiddenItems} 項已出貨商品${hiddenOrders?`，其中 ${hiddenOrders} 張訂單已全部出貨`:''}`;
      }
    }finally{applying=false;}
  }

  let timer=null;
  function schedule(){ clearTimeout(timer); timer=setTimeout(applyVendorFilter,80); }

  function install(){
    injectStyles();
    addVersionBadges();
    ensureVendorToggle();
    const root=$('vendorOrders');
    if(root && !root.dataset.vendorDisplayObserver){
      root.dataset.vendorDisplayObserver='1';
      new MutationObserver(schedule).observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    }
    setTimeout(()=>{addVersionBadges();ensureVendorToggle();applyVendorFilter();},250);
    setTimeout(()=>{addVersionBadges();ensureVendorToggle();applyVendorFilter();},900);
    document.addEventListener('click',e=>{
      if(e.target.closest?.('#vendorReloadBtn')) setTimeout(applyVendorFilter,350);
    });
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();