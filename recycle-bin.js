(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const SB = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_PUBLISHABLE_KEY;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function session(){ try{return JSON.parse(localStorage.getItem('vendor_order_session')||'null')}catch{return null} }
  function jwt(){
    try{const t=session()?.access_token||'';const p=t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');const pad=p.length%4?'='.repeat(4-p.length%4):'';return JSON.parse(decodeURIComponent(escape(atob(p+pad))))}catch{return {}}
  }
  function isAdmin(){ return jwt()?.app_metadata?.role === 'admin'; }

  async function rest(path){
    const s=session(); if(!s?.access_token) throw new Error('登入已過期，請重新登入');
    const r=await fetch(`${SB}/rest/v1/${path}`,{headers:{apikey:KEY,Authorization:`Bearer ${s.access_token}`}});
    const text=await r.text(); if(!r.ok) throw new Error(text||`HTTP ${r.status}`);
    return text?JSON.parse(text):[];
  }

  async function action(action, ids=[]){
    const s=session(); if(!s?.access_token) throw new Error('登入已過期，請重新登入');
    const r=await fetch(`${SB}/functions/v1/admin-orders`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${s.access_token}`},body:JSON.stringify({action,order_ids:ids})});
    const d=await r.json().catch(()=>({})); if(!r.ok||!d.ok) throw new Error(d.error||`HTTP ${r.status}`); return d;
  }

  function fmt(v){
    if(!v)return '—';
    try{return new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v))}catch{return v}
  }

  function installPanel(){
    if(!isAdmin() || $('tab-recycle')) return;
    const nav=document.querySelector('#adminView .tabs'); if(!nav)return;
    const tab=document.createElement('button');
    tab.className='tab'; tab.dataset.tab='recycle'; tab.textContent='🗑️ 回收桶'; nav.appendChild(tab);

    const panel=document.createElement('div');
    panel.id='tab-recycle'; panel.className='tab-panel hidden';
    panel.innerHTML=`
      <div class="card section-card recycle-section">
        <div class="section-head">
          <div><h2>回收桶</h2><p class="muted">一般刪除只會移到這裡，可隨時還原。只有「永久刪除」才會真正移除資料。</p></div>
          <div class="recycle-head-actions"><button id="recycleReloadBtn" class="btn ghost">重新整理</button><button id="emptyRecycleBtn" class="btn danger-outline">清空回收桶</button></div>
        </div>
        <div class="recycle-toolbar">
          <label class="recycle-check"><input type="checkbox" id="recycleSelectAll"> 全選</label>
          <span id="recycleCount" class="muted">0 筆</span>
          <button id="restoreSelectedBtn" class="btn secondary" disabled>還原已選</button>
          <button id="purgeSelectedBtn" class="btn danger-outline" disabled>永久刪除已選</button>
        </div>
        <div id="recycleList" class="recycle-grid"><div class="muted">載入中…</div></div>
      </div>`;
    $('adminView').appendChild(panel);

    tab.addEventListener('click',()=>{
      document.querySelectorAll('#adminView .tab').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('#adminView .tab-panel').forEach(x=>x.classList.add('hidden'));
      tab.classList.add('active'); panel.classList.remove('hidden'); load();
    });
    $('recycleReloadBtn').addEventListener('click',load);
    $('recycleSelectAll').addEventListener('change',e=>{document.querySelectorAll('.recycle-item-check').forEach(x=>x.checked=e.target.checked);updateButtons()});
    $('restoreSelectedBtn').addEventListener('click',()=>restore(selectedIds()));
    $('purgeSelectedBtn').addEventListener('click',()=>purge(selectedIds()));
    $('emptyRecycleBtn').addEventListener('click',emptyAll);
  }

  function selectedIds(){ return [...document.querySelectorAll('.recycle-item-check:checked')].map(x=>x.dataset.id).filter(Boolean); }
  function updateButtons(){
    const n=selectedIds().length;
    if($('restoreSelectedBtn')) $('restoreSelectedBtn').disabled=!n;
    if($('purgeSelectedBtn')) $('purgeSelectedBtn').disabled=!n;
    const all=[...document.querySelectorAll('.recycle-item-check')];
    if($('recycleSelectAll')){ $('recycleSelectAll').checked=all.length>0&&n===all.length; $('recycleSelectAll').indeterminate=n>0&&n<all.length; }
  }

  async function load(){
    const box=$('recycleList'); if(!box)return;
    box.innerHTML='<div class="muted">載入中…</div>';
    try{
      const rows=await rest('recycle_bin_orders?select=id,tracking_id,order_no,order_date,buyer,receiver,receiver_phone,receiver_address,vendor_code,vendor_name,status,deleted_at,deleted_reason,original_message&order=deleted_at.desc&limit=500');
      $('recycleCount').textContent=`${rows.length} 筆`;
      $('recycleSelectAll').checked=false;
      box.innerHTML=rows.map(r=>`
        <article class="recycle-card" data-id="${esc(r.id)}">
          <div class="recycle-card-top">
            <label class="recycle-check"><input class="recycle-item-check" data-id="${esc(r.id)}" type="checkbox"> 選取</label>
            <span class="badge unknown">${esc(fmt(r.deleted_at))}</span>
          </div>
          <div class="recycle-order-no">${esc(r.order_no||`ORD-${String(r.tracking_id).padStart(6,'0')}`)}</div>
          <div class="recycle-info">
            <div><span>廠商</span><b>${esc(r.vendor_name||'—')}</b></div>
            <div><span>訂購日</span><b>${esc(r.order_date||'—')}</b></div>
            <div><span>收貨人</span><b>${esc(r.receiver||'—')}</b></div>
            <div><span>電話</span><b>${esc(r.receiver_phone||'—')}</b></div>
          </div>
          ${r.receiver_address?`<div class="recycle-address">${esc(r.receiver_address)}</div>`:''}
          ${r.deleted_reason?`<div class="muted recycle-reason">原因：${esc(r.deleted_reason)}</div>`:''}
          <details><summary>查看原始訂單內容</summary><pre>${esc(r.original_message||'')}</pre></details>
          <div class="recycle-actions"><button class="btn secondary" data-restore="${esc(r.id)}">還原</button><button class="btn danger-outline" data-purge="${esc(r.id)}">永久刪除</button></div>
        </article>`).join('') || '<div class="empty-state">回收桶目前是空的。</div>';
      box.querySelectorAll('.recycle-item-check').forEach(x=>x.addEventListener('change',updateButtons));
      box.querySelectorAll('[data-restore]').forEach(x=>x.addEventListener('click',()=>restore([x.dataset.restore])));
      box.querySelectorAll('[data-purge]').forEach(x=>x.addEventListener('click',()=>purge([x.dataset.purge])));
      updateButtons();
    }catch(e){ box.innerHTML=`<div class="message error">回收桶載入失敗：${esc(e.message)}</div>`; }
  }

  async function restore(ids){
    if(!ids.length)return;
    if(!confirm(`確定還原 ${ids.length} 筆訂單？`))return;
    try{const d=await action('restore_orders',ids);alert(`已還原 ${d.restored_count||0} 筆訂單。`);await load();$('reloadBtn')?.click();}catch(e){alert(`還原失敗：${e.message}`)}
  }

  async function purge(ids){
    if(!ids.length)return;
    if(!confirm(`確定永久刪除 ${ids.length} 筆訂單？\n此動作無法還原。`))return;
    if(!confirm('再次確認：真的要永久刪除？'))return;
    try{const d=await action('purge_orders',ids);alert(`已永久刪除 ${d.purged_count||0} 筆。`);await load();}catch(e){alert(`永久刪除失敗：${e.message}`)}
  }

  async function emptyAll(){
    const count=document.querySelectorAll('.recycle-card').length;
    if(!count){alert('回收桶目前是空的。');return;}
    if(!confirm(`確定清空回收桶？\n目前畫面有 ${count} 筆，清空後無法還原。`))return;
    const word=prompt('請輸入「永久刪除」確認清空回收桶：');
    if(word!=='永久刪除'){alert('已取消。');return;}
    try{const d=await action('empty_recycle_bin',[]);alert(`已永久刪除 ${d.purged_count||0} 筆。`);await load();}catch(e){alert(`清空失敗：${e.message}`)}
  }

  function boot(){ if(!isAdmin())return; installPanel(); }
  window.addEventListener('DOMContentLoaded',()=>{
    setTimeout(boot,200); setTimeout(boot,800); setTimeout(boot,1600);
    $('loginBtn')?.addEventListener('click',()=>{setTimeout(boot,400);setTimeout(boot,1000)});
    window.addEventListener('recycle-bin-changed',()=>{ if(!$('tab-recycle')?.classList.contains('hidden')) load(); });
  });
})();
