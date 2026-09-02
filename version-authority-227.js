(() => {
  'use strict';
  const VERSION='V2.27';
  window.APP_VERSION=VERSION;
  function apply(){
    document.querySelectorAll('.system-version-chip').forEach(el=>{el.textContent=`系統版本 ${VERSION}`;});
    const footer=document.querySelector('footer');
    if(footer) footer.textContent=`Vendor Order Tracking ${VERSION}`;
  }
  apply();
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',apply,{once:true});
  setTimeout(apply,250);
  setTimeout(apply,1200);
})();
