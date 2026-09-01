(() => {
  'use strict';

  const VERSION = 'V2.11';
  const $ = (id) => document.getElementById(id);

  function injectStyles(){
    if($('vendorSortAdminStatusStyles')) return;
    const st=document.createElement('style');
    st.id='vendorSortAdminStatusStyles';
    st.textContent=`
      /* 管理者：狀態欄不要被壓成只剩箭頭 */
      #orderRows select[id^="status-"]{
        min-width:132px!important;
        width:132px!important;
        font-size:14px!important;
        font-weight:700!important;
        padding:10px 34px 10px 12px!important;
        line-height:1.3!important;
        min-height:44px!important;
      }
      #orderRows tr>td:nth-last-child(2){min-width:145px!important;width:145px!important;white-space:nowrap}
      #orderRows tr>td:last-child{min-width:90px!important;width:90px!important}
      #orderRows [data-save-status]{font-size:13px!important;min-width:58px}
      @media(max-width:900px){
        #orderRows select[id^="status-"]{min-width:124px!important;width:124px!important;font-size:14px!important}
      }
      @media(max-width:720px){
        #orderRows tr>td:nth-last-child(2),#orderRows tr>td:last-child{min-width:0!important;width:auto!important;white-space:normal}
        #orderRows select[id^="status-"]{width:100%!important;min-width:0!important;font-size:16px!important;min-height:46px!important}
      }
    `;
    document.head.appendChild(st);
  }

  function extractOrderNo(card){
    const text=card.querySelector('h3')?.textContent||card.textContent||'';
    const m=text.match(/ORD-(\d+)/i);
    return m?Number(m[1]):Number.MAX_SAFE_INTEGER;
  }

  function extractOrderDate(card){
    const text=card.textContent||'';
    const m=text.match(/訂購日\s*[：:]?\s*(20\d{2}-\d{2}-\d{2})/);
    return m?m[1]:'9999-12-31';
  }

  function warningPriority(card){
    const badge=card.querySelector('.badge');
    const cls=badge?.className||'';
    const text=badge?.textContent||'';
    if(cls.includes('overdue')||/逾期/.test(text)) return 0;
    if(cls.includes('due_soon')||/3\s*天內到期|即將到期/.test(text)) return 1;
    return 2;
  }

  function sortVendorOrders(){
    const root=$('vendorOrders');
    if(!root || root.dataset.vendorSorting==='1') return;
    const cards=[...root.querySelectorAll('.vendor-order,.order-card')];
    if(cards.length<2) return;
    root.dataset.vendorSorting='1';
    cards.sort((a,b)=>{
      const pa=warningPriority(a),pb=warningPriority(b);
      if(pa!==pb) return pa-pb;
      const da=extractOrderDate(a),db=extractOrderDate(b);
      const dc=da.localeCompare(db);
      if(dc) return dc;
      return extractOrderNo(a)-extractOrderNo(b);
    });
    const frag=document.createDocumentFragment();
    cards.forEach(card=>frag.appendChild(card));
    root.appendChild(frag);
    delete root.dataset.vendorSorting;
  }

  function updateVersion(){
    document.querySelectorAll('.system-version-chip').forEach(el=>el.textContent=`系統版本 ${VERSION}`);
    const footer=document.querySelector('footer');
    if(footer) footer.textContent=`Vendor Order Tracking ${VERSION}`;
  }

  let timer;
  function schedule(){
    clearTimeout(timer);
    timer=setTimeout(()=>{sortVendorOrders();updateVersion();},90);
  }

  function install(){
    injectStyles();
    updateVersion();
    const root=$('vendorOrders');
    if(root && !root.dataset.vendorSortObserver){
      root.dataset.vendorSortObserver='1';
      new MutationObserver(schedule).observe(root,{childList:true,subtree:false});
    }
    setTimeout(sortVendorOrders,300);
    setTimeout(sortVendorOrders,900);
    $('vendorReloadBtn')?.addEventListener('click',()=>setTimeout(sortVendorOrders,500));
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();
