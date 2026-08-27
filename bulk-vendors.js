(() => {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const SB = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_PUBLISHABLE_KEY;
  const $ = (id) => document.getElementById(id);

  function session(){
    try { return JSON.parse(localStorage.getItem('vendor_order_session') || 'null'); }
    catch { return null; }
  }
  function role(){
    try {
      const t=session()?.access_token||'';
      const p=t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      const pad=p.length%4?'='.repeat(4-p.length%4):'';
      return JSON.parse(atob(p+pad)).app_metadata?.role||'';
    } catch { return ''; }
  }

  async function createMissing(){
    const s=session();
    if(!s?.access_token) throw new Error('請重新登入 ADMIN');
    const res=await fetch(`${SB}/functions/v1/vendor-bulk`,{
      method:'POST',
      headers:{
        apikey:KEY,
        Authorization:`Bearer ${s.access_token}`,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({action:'create_missing_vendor_accounts'})
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||`HTTP ${res.status}`);
    return data;
  }

  function install(){
    if(role()!=='admin') return;
    const target=$('credentialBox');
    if(!target || $('bulkVendorAccountBox')) return;
    const box=document.createElement('div');
    box.id='bulkVendorAccountBox';
    box.className='credential-admin';
    box.innerHTML=`
      <b>快速建立廠商登入帳號</b>
      <p class="muted" style="margin:6px 0 10px">只建立尚未有登入帳號的廠商；已存在帳號不會被重設。</p>
      <button id="bulkVendorAccountBtn" class="btn primary">一鍵建立所有未建立廠商帳號</button>
      <div id="bulkVendorAccountResult" style="margin-top:10px"></div>`;
    target.insertAdjacentElement('beforebegin',box);
    $('bulkVendorAccountBtn').addEventListener('click',async()=>{
      if(!confirm('確定要替所有尚未建立登入帳號的廠商建立帳號？')) return;
      const btn=$('bulkVendorAccountBtn');
      const out=$('bulkVendorAccountResult');
      btn.disabled=true; btn.textContent='建立中…'; out.textContent='';
      try{
        const d=await createMissing();
        const created=d.created||[], skipped=d.skipped||[], failed=d.failed||[];
        out.innerHTML=`<div class="credential"><b>完成</b><br>新建立：${created.length} 家<br>已存在略過：${skipped.length} 家<br>失敗：${failed.length} 家<br>統一初始密碼：<code>${String(d.initial_password||'')}</code></div>`;
        if(created.length){
          alert(`已建立 ${created.length} 家廠商帳號。\n初始密碼：${d.initial_password}\n首次登入會強制修改密碼。`);
        }
        setTimeout(()=>location.reload(),800);
      }catch(e){
        out.innerHTML=`<div class="message error">建立失敗：${String(e.message||e)}</div>`;
        btn.disabled=false; btn.textContent='一鍵建立所有未建立廠商帳號';
      }
    });
  }

  window.addEventListener('DOMContentLoaded',()=>{
    setTimeout(install,500);
    setTimeout(install,1200);
    $('loginBtn')?.addEventListener('click',()=>{setTimeout(install,900);});
    document.querySelector('.tab[data-tab="vendors"]')?.addEventListener('click',()=>setTimeout(install,120));
  });
})();
