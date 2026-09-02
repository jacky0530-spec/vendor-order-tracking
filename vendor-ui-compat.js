(() => {
  'use strict';

  const VERSION = 'V2.16';

  function getRole(){
    try{
      const s=JSON.parse(localStorage.getItem('vendor_order_session')||'null');
      const token=s?.access_token||'';
      const p=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      const pad=p.length%4?'='.repeat(4-p.length%4):'';
      return JSON.parse(decodeURIComponent(escape(atob(p+pad)))).app_metadata?.role||'';
    }catch{return '';}
  }

  function injectStyle(){
    if(document.getElementById('vendorUiCompatStyles')) return;
    const st=document.createElement('style');
    st.id='vendorUiCompatStyles';
    st.textContent=`
      #vendorOrders .vendor-order .form-grid,
      #vendorOrders .vendor-order > [data-vsave],
      #vendorOrders .vendor-order > [data-vendor-save]{display:none!important}
      #vendorOrders .order-products{margin-top:10px}
      #vendorOrders .order-products .item-pick-row{display:flex}
    `;
    document.head.appendChild(st);
  }

  function setVersion(){
    document.querySelectorAll('.system-version-chip').forEach(el=>el.textContent=`系統版本 ${VERSION}`);
    const footer=document.querySelector('footer');
    if(footer) footer.textContent=`Vendor Order Tracking ${VERSION}`;
  }

  function normalizeVendorDom(){
    if(getRole()!=='vendor') { setVersion(); return; }
    injectStyle();
    const root=document.getElementById('vendorOrders');
    if(!root) return;

    root.querySelectorAll('.vendor-order').forEach(card=>{
      card.classList.add('order-card');

      const box=card.querySelector('.item-box');
      if(box) box.classList.add('order-products');

      const save=card.querySelector('[data-vsave]');
      if(save){
        save.dataset.vendorSave=save.dataset.vsave||'';
        save.classList.add('legacy-order-shipping');
      }

      card.querySelectorAll('.form-grid').forEach(el=>el.classList.add('legacy-order-shipping'));
    });

    setVersion();
  }

  function install(){
    injectStyle();
    setVersion();
    const root=document.getElementById('vendorOrders');
    if(root && !root.dataset.vendorUiCompatObserver){
      root.dataset.vendorUiCompatObserver='1';
      const observer=new MutationObserver(()=>normalizeVendorDom());
      observer.observe(root,{childList:true,subtree:true});
    }
    normalizeVendorDom();
    setTimeout(normalizeVendorDom,50);
    setTimeout(normalizeVendorDom,250);
    setTimeout(normalizeVendorDom,700);
    setTimeout(normalizeVendorDom,1300);
    document.getElementById('vendorReloadBtn')?.addEventListener('click',()=>{
      setTimeout(normalizeVendorDom,50);
      setTimeout(normalizeVendorDom,350);
    });
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();