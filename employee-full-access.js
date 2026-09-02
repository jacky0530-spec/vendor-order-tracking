(() => {
  'use strict';

  const VERSION = 'V2.20';
  const CFG = window.APP_CONFIG || {};
  const SB = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_PUBLISHABLE_KEY;
  const PORTAL = CFG.ADMIN_API_URL;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));

  let cachedRole = null;
  let lastUid = null;

  function session(){
    try { return JSON.parse(localStorage.getItem('vendor_order_session') || 'null'); }
    catch { return null; }
  }

  async function rest(path, opt = {}){
    const s = session();
    if(!s?.access_token) throw new Error('登入已過期，請重新登入');
    const r = await fetch(`${SB}/rest/v1/${path}`, {
      ...opt,
      headers:{
        apikey:KEY,
        Authorization:`Bearer ${s.access_token}`,
        'Content-Type':'application/json',
        ...(opt.headers || {})
      }
    });
    const t = await r.text();
    if(!r.ok){
      let m=t;
      try{const d=JSON.parse(t);m=d.message||d.hint||d.details||t}catch{}
      throw new Error(m||`HTTP ${r.status}`);
    }
    if(!t) return null;
    try{return JSON.parse(t)}catch{return t}
  }

  async function portal(body){
    const s=session(); if(!s?.access_token) throw new Error('登入已過期，請重新登入');
    const r=await fetch(PORTAL,{method:'POST',headers:{Authorization:`Bearer ${s.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error||d.message||`HTTP ${r.status}`);
    return d;
  }

  async function adminOrders(action, ids=[]){
    const s=session(); if(!s?.access_token) throw new Error('登入已過期，請重新登入');
    const r=await fetch(`${SB}/functions/v1/admin-orders`,{method:'POST',headers:{Authorization:`Bearer ${s.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({action,order_ids:ids})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.ok) throw new Error(d.error||`HTTP ${r.status}`);
    return d;
  }

  async function vendorBulk(){
    const s=session(); if(!s?.access_token) throw new Error('登入已過期，請重新登入');
    const r=await fetch(`${SB}/functions/v1/vendor-bulk`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${s.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'create_missing_vendor_accounts'})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error||`HTTP ${r.status}`);
    return d;
  }

  async function role(force=false){
    const s=session(); const uid=s?.user?.id;
    if(!uid){cachedRole=null;lastUid=null;return null;}
    if(!force && uid===lastUid && cachedRole) return cachedRole;
    const rows=await rest(`user_profiles?select=role,active&user_id=eq.${encodeURIComponent(uid)}`);
    const p=rows?.[0];
    lastUid=uid; cachedRole=p?.active===false?null:(p?.role||null);
    return cachedRole;
  }

  function injectStyle(){
    if($('employeeFullAccessStyles')) return;
    const st=document.createElement('style');
    st.id='employeeFullAccessStyles';
    st.textContent=`
      body.role-employee #adminView .tabs .tab[data-tab="vendors"],
      body.role-employee #adminView .tabs .tab[data-tab="history"],
      body.role-employee #adminView .tabs .tab[data-tab="review"],
      body.role-employee #adminView .tabs .tab[data-tab="employees"],
      body.role-employee #adminView .tabs .tab[data-tab="recycle"]{display:inline-flex!important}
      body.role-employee .delete-btn{display:inline-flex!important}
      body.role-employee .order-select-cell,body.role-employee .order-select-head{display:table-cell!important}
      body.role-employee #employeeFullBulkBar{display:flex!important}
      .employee-full-admin-note{padding:8px 11px;border-radius:9px;background:#ecfdf3;color:#027a48;font-size:12px;font-weight:800;margin:8px 0}
      .employee-full-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}
      .employee-full-box{border:1px solid #e4e7ec;border-radius:13px;background:#fff;padding:13px}
      .employee-full-box h3{margin:0 0 8px}.employee-full-row{display:grid;grid-template-columns:1fr 1fr;gap:9px}
      .employee-full-password{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:800;background:#f2f4f7;padding:3px 7px;border-radius:6px}
      #employeeFullBulkBar{align-items:center;gap:9px;flex-wrap:wrap;margin:8px 0;padding:8px 10px;border:1px solid #fedf89;background:#fffaeb;border-radius:10px}
      .employee-full-vendor-controls{margin:10px 0;padding:12px;border:1px solid #b2ddff;background:#eff8ff;border-radius:12px}
      .employee-full-vendor-credential{margin-top:10px;padding:9px;border:1px solid #d0d5dd;background:#f9fafb;border-radius:9px;font-size:12px}
      .employee-full-recycle-grid{display:grid;gap:10px}.employee-full-recycle-card{border:1px solid #e4e7ec;border-radius:12px;padding:12px;background:#fff}
      .employee-full-recycle-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}
      @media(max-width:760px){.employee-full-grid,.employee-full-row{grid-template-columns:1fr}}
    `;
    document.head.appendChild(st);
  }

  function setVersion(){
    document.querySelectorAll('.system-version-chip').forEach(x=>x.textContent=`系統版本 ${VERSION}`);
    const footer=document.querySelector('footer'); if(footer) footer.textContent=`Vendor Order Tracking ${VERSION}`;
  }

  function switchTab(tabName){
    document.querySelectorAll('#adminView .tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===tabName));
    document.querySelectorAll('#adminView .tab-panel').forEach(x=>x.classList.add('hidden'));
    $(`tab-${tabName}`)?.classList.remove('hidden');
  }

  function restoreBaseTabs(){
    ['tracking','report','vendors','history','review','employees','recycle'].forEach(name=>{
      const t=document.querySelector(`#adminView .tab[data-tab="${name}"]`);
      if(t){t.classList.remove('hidden');t.style.removeProperty('display');}
    });
  }

  async function getSettings(){
    const rows=await rest('app_settings?select=key,value&key=in.(vendor_initial_password,employee_initial_password)');
    const m=new Map((rows||[]).map(x=>[x.key,x.value?.password||'']));
    return {vendor:m.get('vendor_initial_password')||'Vendor@2026!',employee:m.get('employee_initial_password')||'Staff@2026!'};
  }

  async function saveSetting(key,password){
    if(String(password||'').length<8) throw new Error('初始密碼至少 8 碼');
    await rest(`app_settings?key=eq.${encodeURIComponent(key)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({value:{password},updated_at:new Date().toISOString()})});
  }

  function ensureEmployeeTab(){
    const nav=document.querySelector('#adminView .tabs'); if(!nav)return;
    let tab=document.querySelector('#adminView .tab[data-tab="employees"]');
    if(!tab){
      tab=document.createElement('button');tab.className='tab';tab.dataset.tab='employees';tab.textContent='員工帳號';
      document.querySelector('#adminView .tab[data-tab="vendors"]')?.insertAdjacentElement('afterend',tab);
    }
    tab.classList.remove('hidden');
    if(!$('tab-employees')){
      const p=document.createElement('div');p.id='tab-employees';p.className='tab-panel hidden';
      p.innerHTML=`<div class="card section-card">
        <div class="section-head"><div><h2>員工帳號管理</h2><p class="muted">員工已開放完整管理權限，可建立、重設、啟停其他員工帳號。</p></div><button id="employeeFullReload" class="btn ghost">重新整理</button></div>
        <div class="employee-full-admin-note">員工權限 = ADMIN 操作權限（首次建立 ADMIN 功能除外）</div>
        <div class="employee-full-box"><h3>員工統一初始密碼</h3><div class="employee-full-row"><input id="employeeFullDefaultPassword" type="text"><button id="employeeFullSaveDefault" class="btn secondary">儲存初始密碼</button></div></div>
        <div class="employee-full-box" style="margin-top:12px"><h3>建立員工</h3><div class="employee-full-row"><label>員工姓名<input id="employeeFullName"></label><label>登入帳號<input id="employeeFullLogin" placeholder="STAFF01"></label></div><label>初始密碼<input id="employeeFullCreatePassword" type="text"></label><button id="employeeFullCreateBtn" class="btn primary">建立員工帳號</button><div id="employeeFullCreateResult"></div></div>
        <div id="employeeFullList" class="employee-full-grid"></div>
      </div>`;
      $('adminView')?.appendChild(p);
      $('employeeFullReload')?.addEventListener('click',loadEmployees);
      $('employeeFullSaveDefault')?.addEventListener('click',async()=>{try{await saveSetting('employee_initial_password',$('employeeFullDefaultPassword').value);alert('員工初始密碼已更新。')}catch(e){alert(e.message)}});
      $('employeeFullCreateBtn')?.addEventListener('click',createEmployee);
    }
    if(tab.dataset.fullBound!=='1'){
      tab.dataset.fullBound='1';tab.addEventListener('click',e=>{e.preventDefault();switchTab('employees');loadEmployees();});
    }
  }

  async function loadEmployees(){
    const box=$('employeeFullList'); if(!box)return;
    box.innerHTML='<div class="muted">載入中…</div>';
    try{
      const [settings,profiles,creds]=await Promise.all([
        getSettings(),
        rest('user_profiles?select=user_id,display_name,login_name,active,must_change_password,created_at&role=eq.employee&order=created_at.asc'),
        rest('account_credentials?select=user_id,issued_password,password_kind,issued_at,changed_at')
      ]);
      $('employeeFullDefaultPassword').value=settings.employee;
      if(!$('employeeFullCreatePassword').value)$('employeeFullCreatePassword').value=settings.employee;
      const cm=new Map((creds||[]).map(x=>[x.user_id,x]));
      box.innerHTML=(profiles||[]).map(p=>{
        const c=cm.get(p.user_id);const pw=c?.issued_password?`<span class="employee-full-password">${esc(c.issued_password)}</span>`:'<span class="muted">已自行修改，無明碼</span>';
        return `<div class="employee-full-box"><h3>${esc(p.display_name||p.login_name)}</h3><div>帳號：<b>${esc(p.login_name)}</b></div><div style="margin-top:6px">系統發放密碼：${pw}</div><div class="muted" style="margin-top:6px">${p.active?'啟用':'停用'}｜${p.must_change_password?'待首次改密碼':'已完成密碼設定'}</div><div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:9px"><button class="btn small secondary" data-full-reset="${esc(p.user_id)}" data-login="${esc(p.login_name)}" data-name="${esc(p.display_name||p.login_name)}">重設密碼</button><button class="btn small ghost" data-full-toggle="${esc(p.user_id)}" data-active="${p.active?'1':'0'}">${p.active?'停用帳號':'啟用帳號'}</button></div></div>`;
      }).join('')||'<div class="muted">尚無員工。</div>';
      box.querySelectorAll('[data-full-reset]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm(`重設 ${b.dataset.login} 密碼？`))return;try{const d=await portal({action:'employee_account',login_name:b.dataset.login,display_name:b.dataset.name,password:settings.employee});alert(`已重設 ${d.username}\n密碼：${d.password}`);loadEmployees()}catch(e){alert(e.message)}}));
      box.querySelectorAll('[data-full-toggle]').forEach(b=>b.addEventListener('click',async()=>{const next=b.dataset.active!=='1';if(!confirm(`確定${next?'啟用':'停用'}此員工？`))return;try{await portal({action:'employee_active',user_id:b.dataset.fullToggle,active:next});loadEmployees()}catch(e){alert(e.message)}}));
    }catch(e){box.innerHTML=`<div class="message error">載入失敗：${esc(e.message)}</div>`}
  }

  async function createEmployee(){
    try{
      const d=await portal({action:'employee_account',display_name:$('employeeFullName').value.trim(),login_name:$('employeeFullLogin').value.trim(),password:$('employeeFullCreatePassword').value});
      $('employeeFullCreateResult').innerHTML=`<div class="employee-full-admin-note">已建立 ${esc(d.username)}｜初始密碼 ${esc(d.password)}</div>`;
      $('employeeFullName').value='';$('employeeFullLogin').value='';loadEmployees();
    }catch(e){alert(e.message)}
  }

  function ensureVendorExtras(){
    const panel=$('tab-vendors'); const credential=$('credentialBox'); if(!panel||!credential)return;
    if(!$('employeeFullVendorControls')){
      const d=document.createElement('div');d.id='employeeFullVendorControls';d.className='employee-full-vendor-controls';
      d.innerHTML=`<b>廠商帳號完整管理</b><div class="employee-full-row" style="margin-top:8px"><input id="employeeFullVendorPassword" type="text"><button id="employeeFullSaveVendorPassword" class="btn secondary">儲存廠商初始密碼</button></div><div style="margin-top:8px"><button id="employeeFullBulkVendors" class="btn primary">一鍵建立所有未建立廠商帳號</button></div><div id="employeeFullVendorResult" class="muted" style="margin-top:7px"></div>`;
      credential.insertAdjacentElement('beforebegin',d);
      $('employeeFullSaveVendorPassword').addEventListener('click',async()=>{try{await saveSetting('vendor_initial_password',$('employeeFullVendorPassword').value);alert('廠商初始密碼已更新。');loadVendorAdminExtras()}catch(e){alert(e.message)}});
      $('employeeFullBulkVendors').addEventListener('click',async()=>{if(!confirm('建立所有尚未建立帳號的廠商？'))return;const b=$('employeeFullBulkVendors');b.disabled=true;b.textContent='建立中…';try{const d=await vendorBulk();$('employeeFullVendorResult').textContent=`新建立 ${d.created?.length||0} 家，略過 ${d.skipped?.length||0} 家，失敗 ${d.failed?.length||0} 家。`;setTimeout(()=>location.reload(),700)}catch(e){alert(e.message);b.disabled=false;b.textContent='一鍵建立所有未建立廠商帳號'}});
    }
    const tab=document.querySelector('#adminView .tab[data-tab="vendors"]');
    if(tab&&tab.dataset.fullVendorBound!=='1'){tab.dataset.fullVendorBound='1';tab.addEventListener('click',()=>setTimeout(loadVendorAdminExtras,150));}
  }

  async function loadVendorAdminExtras(){
    if(!$('employeeFullVendorControls'))return;
    try{
      const [settings,profiles,creds]=await Promise.all([getSettings(),rest('user_profiles?select=user_id,login_name,active,must_change_password&role=eq.vendor'),rest('account_credentials?select=user_id,issued_password,password_kind,changed_at')]);
      $('employeeFullVendorPassword').value=settings.vendor;
      const pm=new Map((profiles||[]).map(x=>[String(x.login_name||'').toUpperCase(),x]));const cm=new Map((creds||[]).map(x=>[x.user_id,x]));
      document.querySelectorAll('#vendorCards .vendor-card').forEach(card=>{
        card.querySelector('.employee-full-vendor-credential')?.remove();
        const code=(card.querySelector('h3')?.textContent||'').trim().split(/\s+/)[0].toUpperCase();if(!/^V\d{4}$/.test(code))return;
        const p=pm.get(code),c=p?cm.get(p.user_id):null;const line=document.createElement('div');line.className='employee-full-vendor-credential';
        if(!p) line.innerHTML=`帳號：<b>${esc(code)}</b><br>建立後初始密碼：<span class="employee-full-password">${esc(settings.vendor)}</span>`;
        else if(c?.issued_password) line.innerHTML=`帳號：<b>${esc(code)}</b><br>目前系統發放密碼：<span class="employee-full-password">${esc(c.issued_password)}</span>`;
        else line.innerHTML=`帳號：<b>${esc(code)}</b><br><span class="muted">已自行修改密碼，系統不保存私人新密碼。</span>`;
        card.appendChild(line);
      });
    }catch(e){console.error('vendor extras',e)}
  }

  function orderIdFromRow(row){return row?.querySelector('[data-save-status]')?.dataset.saveStatus||row?.querySelector('[data-delete-order]')?.dataset.deleteOrder||''}
  function selectedOrderIds(){return [...document.querySelectorAll('#orderRows .employee-full-order-check:checked')].map(x=>x.dataset.id).filter(Boolean)}
  function updateBulk(){const ids=selectedOrderIds();if($('employeeFullBulkCount'))$('employeeFullBulkCount').textContent=`已選 ${ids.length} 筆`;if($('employeeFullBulkRecycle'))$('employeeFullBulkRecycle').disabled=!ids.length}

  function enhanceBulkDelete(){
    const body=$('orderRows');if(!body)return;
    const table=body.closest('table');const head=table?.querySelector('thead tr');
    if(head&&!head.querySelector('.order-select-head')){const th=document.createElement('th');th.className='order-select-head';th.innerHTML='<input id="employeeFullSelectAll" type="checkbox">';head.insertBefore(th,head.firstChild);th.querySelector('input').addEventListener('change',e=>{body.querySelectorAll('.employee-full-order-check').forEach(c=>{if(getComputedStyle(c.closest('tr')).display!=='none')c.checked=e.target.checked});updateBulk()})}
    body.querySelectorAll('tr').forEach(row=>{const id=orderIdFromRow(row);if(!id)return;let td=row.querySelector('.order-select-cell');if(!td){td=document.createElement('td');td.className='order-select-cell';row.insertBefore(td,row.firstChild)}if(!td.querySelector('.employee-full-order-check')){td.innerHTML=`<input type="checkbox" class="employee-full-order-check" data-id="${esc(id)}">`;td.querySelector('input').addEventListener('change',updateBulk)}const del=row.querySelector('[data-delete-order]');if(del){del.textContent='移到回收桶';del.title='可從回收桶還原'}});
  }

  function ensureBulkDelete(){
    const filters=document.querySelector('#tab-tracking .filters');if(!filters)return;
    if(!$('employeeFullBulkBar')){const b=document.createElement('div');b.id='employeeFullBulkBar';b.innerHTML='<b id="employeeFullBulkCount">已選 0 筆</b><button id="employeeFullSelectVisible" class="btn ghost">全選目前顯示</button><button id="employeeFullClear" class="btn ghost">取消全選</button><button id="employeeFullBulkRecycle" class="btn secondary" disabled>移到回收桶</button>';filters.insertAdjacentElement('afterend',b);$('employeeFullSelectVisible').addEventListener('click',()=>{document.querySelectorAll('#orderRows .employee-full-order-check').forEach(c=>{if(getComputedStyle(c.closest('tr')).display!=='none')c.checked=true});updateBulk()});$('employeeFullClear').addEventListener('click',()=>{document.querySelectorAll('#orderRows .employee-full-order-check').forEach(c=>c.checked=false);updateBulk()});$('employeeFullBulkRecycle').addEventListener('click',async()=>{const ids=selectedOrderIds();if(!ids.length||!confirm(`將 ${ids.length} 筆訂單移到回收桶？`))return;try{await adminOrders('recycle_orders',ids);location.reload()}catch(e){alert(e.message)}})}
    enhanceBulkDelete();
    if(!$('orderRows').dataset.employeeFullBulkObserved){$('orderRows').dataset.employeeFullBulkObserved='1';new MutationObserver(()=>setTimeout(enhanceBulkDelete,30)).observe($('orderRows'),{childList:true,subtree:true})}
  }

  function installDeleteIntercept(){
    if(document.documentElement.dataset.employeeFullDeleteIntercept==='1')return;
    document.documentElement.dataset.employeeFullDeleteIntercept='1';
    document.addEventListener('click',async e=>{
      if(cachedRole!=='employee')return;
      const btn=e.target.closest?.('[data-delete-order]');if(!btn)return;
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      const id=btn.dataset.deleteOrder;if(!id)return;
      if(!confirm('確定將此訂單移到回收桶？'))return;
      try{btn.disabled=true;await adminOrders('recycle_orders',[id]);location.reload()}catch(err){btn.disabled=false;alert(`移動失敗：${err.message}`)}
    },true);
  }

  function ensureRecycleTab(){
    const nav=document.querySelector('#adminView .tabs');if(!nav)return;
    let tab=document.querySelector('#adminView .tab[data-tab="recycle"]');
    if(!tab){tab=document.createElement('button');tab.className='tab';tab.dataset.tab='recycle';tab.textContent='🗑️ 回收桶';nav.appendChild(tab)}
    tab.classList.remove('hidden');
    if(!$('tab-recycle')){const p=document.createElement('div');p.id='tab-recycle';p.className='tab-panel hidden';p.innerHTML=`<div class="card section-card"><div class="section-head"><div><h2>回收桶</h2><p class="muted">可還原或永久刪除訂單。</p></div><div><button id="employeeFullRecycleReload" class="btn ghost">重新整理</button> <button id="employeeFullEmptyRecycle" class="btn danger-outline">清空回收桶</button></div></div><div id="employeeFullRecycleList" class="employee-full-recycle-grid"></div></div>`;$('adminView').appendChild(p);$('employeeFullRecycleReload').addEventListener('click',loadRecycle);$('employeeFullEmptyRecycle').addEventListener('click',emptyRecycle)}
    if(tab.dataset.employeeFullBound!=='1'){tab.dataset.employeeFullBound='1';tab.addEventListener('click',e=>{e.preventDefault();switchTab('recycle');loadRecycle()})}
  }

  async function loadRecycle(){
    const box=$('employeeFullRecycleList');if(!box)return;box.innerHTML='<div class="muted">載入中…</div>';
    try{const rows=await rest('recycle_bin_orders?select=id,order_no,order_date,buyer,receiver,vendor_name,deleted_at,deleted_reason&order=deleted_at.desc&limit=500');box.innerHTML=(rows||[]).map(r=>`<div class="employee-full-recycle-card"><b>${esc(r.order_no)}</b>｜${esc(r.vendor_name||'—')}<div class="muted">訂購日 ${esc(r.order_date||'—')}｜訂貨人 ${esc(r.buyer||'—')}｜收貨人 ${esc(r.receiver||'—')}</div><div class="muted">刪除時間 ${esc(r.deleted_at||'—')}${r.deleted_reason?`｜${esc(r.deleted_reason)}`:''}</div><div class="employee-full-recycle-actions"><button class="btn secondary" data-full-restore="${esc(r.id)}">還原</button><button class="btn danger-outline" data-full-purge="${esc(r.id)}">永久刪除</button></div></div>`).join('')||'<div class="muted">回收桶目前是空的。</div>';box.querySelectorAll('[data-full-restore]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('還原此訂單？'))return;try{await adminOrders('restore_orders',[b.dataset.fullRestore]);loadRecycle()}catch(e){alert(e.message)}}));box.querySelectorAll('[data-full-purge]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('永久刪除此訂單？此動作無法還原。'))return;if(!confirm('再次確認永久刪除？'))return;try{await adminOrders('purge_orders',[b.dataset.fullPurge]);loadRecycle()}catch(e){alert(e.message)}}))}catch(e){box.innerHTML=`<div class="message error">載入失敗：${esc(e.message)}</div>`}
  }
  async function emptyRecycle(){if(!confirm('確定清空回收桶？永久刪除後無法還原。'))return;const w=prompt('請輸入「永久刪除」確認：');if(w!=='永久刪除')return;try{await adminOrders('empty_recycle_bin',[]);loadRecycle()}catch(e){alert(e.message)}}

  async function activate(force=false){
    injectStyle();setVersion();
    const r=await role(force).catch(()=>null);if(r!=='employee')return;
    document.body.classList.add('role-employee','role-employee-full');
    restoreBaseTabs();
    ensureEmployeeTab();ensureVendorExtras();ensureRecycleTab();ensureBulkDelete();installDeleteIntercept();
    setTimeout(()=>{restoreBaseTabs();loadVendorAdminExtras()},250);
  }

  function install(){
    injectStyle();setVersion();installDeleteIntercept();
    activate();
    $('loginBtn')?.addEventListener('click',()=>{cachedRole=null;lastUid=null;setTimeout(()=>activate(true),500);setTimeout(()=>activate(true),1200)});
    const nav=document.querySelector('#adminView .tabs');if(nav)new MutationObserver(()=>{if(cachedRole==='employee')restoreBaseTabs()}).observe(nav,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});
    setInterval(()=>{setVersion();if(cachedRole==='employee'){restoreBaseTabs();ensureEmployeeTab();ensureRecycleTab();ensureVendorExtras();ensureBulkDelete()}},1800);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
