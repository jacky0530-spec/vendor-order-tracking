(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const SB = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_PUBLISHABLE_KEY;
  const ADMIN_API = CFG.ADMIN_API_URL;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function getSession() {
    try { return JSON.parse(localStorage.getItem('vendor_order_session') || 'null'); }
    catch { return null; }
  }

  function decodeJwtPayload(token) {
    try {
      const p = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      const pad = p.length % 4 ? '='.repeat(4 - (p.length % 4)) : '';
      return JSON.parse(decodeURIComponent(escape(atob(p + pad))));
    } catch { return {}; }
  }

  function currentRole() {
    const s = getSession();
    return decodeJwtPayload(s?.access_token || '').app_metadata?.role || '';
  }

  async function api(path, options = {}) {
    const s = getSession();
    if (!s?.access_token) throw new Error('請重新登入');
    const res = await fetch(`${SB}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${s.access_token}`,
        'Content-Type':'application/json',
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }

  async function edge(body) {
    const s = getSession();
    if (!s?.access_token) throw new Error('請重新登入');
    const res = await fetch(ADMIN_API, {
      method:'POST',
      headers:{'Content-Type':'application/json', Authorization:`Bearer ${s.access_token}`},
      body:JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
    return data;
  }

  async function ownProfile() {
    const s = getSession();
    if (!s?.user?.id) return null;
    const rows = await api(`user_profiles?select=*&user_id=eq.${encodeURIComponent(s.user.id)}`);
    return rows?.[0] || null;
  }

  function injectStyles() {
    if ($('accountAdminStyles')) return;
    const st = document.createElement('style');
    st.id = 'accountAdminStyles';
    st.textContent = `
      .account-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:14px}
      .account-box{border:1px solid #e4e7ec;border-radius:14px;padding:14px;background:#fff}
      .account-box h3{margin:0 0 8px}.account-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .password-code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:800;font-size:15px;background:#f2f4f7;padding:3px 7px;border-radius:6px}
      .account-note{font-size:12px;color:#667085;margin-top:6px}.credential-admin{margin:12px 0;padding:14px;border:1px solid #b2ddff;background:#eff8ff;border-radius:12px}
      .force-pass-overlay{position:fixed;inset:0;background:#101828cc;z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px}
      .force-pass-card{width:min(460px,100%);background:#fff;border-radius:16px;padding:22px;box-shadow:0 18px 60px #0006}.force-pass-card h2{margin-top:0}
      body.role-employee .delete-btn{display:none!important}
      @media(max-width:760px){.account-grid,.account-row{grid-template-columns:1fr}}
    `;
    document.head.appendChild(st);
  }

  async function getPasswordSettings() {
    const rows = await api('app_settings?select=key,value&key=in.(vendor_initial_password,employee_initial_password)');
    const map = new Map((rows || []).map(x => [x.key, x.value?.password || '']));
    return {
      vendor: map.get('vendor_initial_password') || 'Vendor@2026!',
      employee: map.get('employee_initial_password') || 'Staff@2026!'
    };
  }

  async function savePasswordSetting(key, value) {
    if (String(value || '').length < 8) throw new Error('初始密碼至少 8 碼');
    await api(`app_settings?key=eq.${encodeURIComponent(key)}`, {
      method:'PATCH', headers:{Prefer:'return=minimal'},
      body:JSON.stringify({value:{password:value},updated_at:new Date().toISOString()})
    });
  }

  function ensureAdminPanels() {
    if (currentRole() !== 'admin') return;
    const tabs = document.querySelector('#adminView .tabs');
    if (!tabs) return;

    if (!document.querySelector('.tab[data-tab="employees"]')) {
      const btn = document.createElement('button');
      btn.className = 'tab';
      btn.dataset.tab = 'employees';
      btn.textContent = '員工帳號';
      const vendorTab = document.querySelector('.tab[data-tab="vendors"]');
      vendorTab?.insertAdjacentElement('afterend', btn);
      btn.addEventListener('click', async () => {
        document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(x => x.classList.add('hidden'));
        btn.classList.add('active');
        $('tab-employees')?.classList.remove('hidden');
        await loadEmployees();
      });
    }

    if (!$('tab-employees')) {
      const panel = document.createElement('div');
      panel.id = 'tab-employees';
      panel.className = 'tab-panel hidden';
      panel.innerHTML = `
        <div class="card section-card">
          <div class="section-head"><div><h2>員工帳號管理</h2><p class="muted">員工可操作全部訂單與查看報表，但不能刪除訂單或管理帳號。</p></div><button id="reloadEmployees" class="btn ghost">重新整理</button></div>
          <div class="credential-admin">
            <b>員工統一初始密碼</b>
            <div class="account-row" style="margin-top:8px"><input id="employeeDefaultPassword" type="text"><button id="saveEmployeeDefaultPassword" class="btn secondary">儲存初始密碼</button></div>
            <div class="account-note">建立或重設員工帳號時會套用此密碼；首次登入後強制修改。</div>
          </div>
          <div class="account-box">
            <h3>建立員工</h3>
            <div class="account-row"><label>員工姓名<input id="employeeDisplayName" placeholder="例如：王小明"></label><label>登入帳號<input id="employeeLoginName" placeholder="例如：STAFF01"></label></div>
            <label>初始密碼<input id="employeeCreatePassword" type="text"></label>
            <button id="createEmployeeBtn" class="btn primary">建立員工帳號</button>
            <div id="employeeCreateResult"></div>
          </div>
          <div id="employeeList" class="account-grid"></div>
        </div>`;
      $('adminView')?.appendChild(panel);
      $('reloadEmployees')?.addEventListener('click', loadEmployees);
      $('saveEmployeeDefaultPassword')?.addEventListener('click', async () => {
        try { await savePasswordSetting('employee_initial_password',$('employeeDefaultPassword').value); alert('員工統一初始密碼已更新。'); }
        catch(e){ alert(e.message); }
      });
      $('createEmployeeBtn')?.addEventListener('click', createEmployee);
    }

    ensureVendorPasswordPanel();
  }

  function ensureVendorPasswordPanel() {
    if (currentRole() !== 'admin' || $('vendorPasswordAdmin')) return;
    const box = $('credentialBox');
    if (!box) return;
    const div = document.createElement('div');
    div.id = 'vendorPasswordAdmin';
    div.className = 'credential-admin';
    div.innerHTML = `
      <b>廠商統一初始密碼</b>
      <div class="account-row" style="margin-top:8px"><input id="vendorDefaultPassword" type="text"><button id="saveVendorDefaultPassword" class="btn secondary">儲存初始密碼</button></div>
      <div class="account-note">建立或重設廠商帳號時會使用此固定密碼；廠商首次登入後必須自行修改。</div>`;
    box.insertAdjacentElement('beforebegin', div);
    $('saveVendorDefaultPassword')?.addEventListener('click', async () => {
      try { await savePasswordSetting('vendor_initial_password',$('vendorDefaultPassword').value); alert('廠商統一初始密碼已更新。'); await loadVendorCredentials(); }
      catch(e){ alert(e.message); }
    });
  }

  async function loadVendorCredentials() {
    if (currentRole() !== 'admin') return;
    ensureAdminPanels();
    try {
      const [settings, profiles, creds] = await Promise.all([
        getPasswordSettings(),
        api('user_profiles?select=user_id,login_name,active,must_change_password&role=eq.vendor'),
        api('account_credentials?select=user_id,login_name,issued_password,password_kind,issued_at,changed_at')
      ]);
      if ($('vendorDefaultPassword')) $('vendorDefaultPassword').value = settings.vendor;
      const pm = new Map((profiles || []).map(x => [String(x.login_name || '').toUpperCase(), x]));
      const cm = new Map((creds || []).map(x => [x.user_id, x]));
      document.querySelectorAll('#vendorCards .vendor-card').forEach(card => {
        card.querySelector('.vendor-password-line')?.remove();
        const code = (card.querySelector('h3')?.textContent || '').trim().split(/\s+/)[0].toUpperCase();
        if (!/^V\d{4}$/.test(code)) return;
        const p = pm.get(code);
        const c = p ? cm.get(p.user_id) : null;
        const line = document.createElement('div');
        line.className = 'vendor-password-line credential-admin';
        if (!p) {
          line.innerHTML = `登入帳號：<b>${esc(code)}</b><br>建立帳號後初始密碼：<span class="password-code">${esc(settings.vendor)}</span>`;
        } else if (c?.issued_password) {
          line.innerHTML = `登入帳號：<b>${esc(code)}</b><br>目前系統發放密碼：<span class="password-code">${esc(c.issued_password)}</span><div class="account-note">${p.must_change_password?'首次登入尚未修改':'最近一次由 ADMIN 重設'}</div>`;
        } else {
          line.innerHTML = `登入帳號：<b>${esc(code)}</b><br><span class="muted">使用者已自行修改密碼；新密碼不保存明碼。如忘記請按「重設廠商密碼」。</span>`;
        }
        card.appendChild(line);
      });
    } catch(e) { console.error('load vendor credentials', e); }
  }

  async function loadEmployees() {
    if (currentRole() !== 'admin') return;
    try {
      const [settings, profiles, creds] = await Promise.all([
        getPasswordSettings(),
        api('user_profiles?select=user_id,display_name,login_name,active,must_change_password,created_at&role=eq.employee&order=created_at.asc'),
        api('account_credentials?select=user_id,login_name,issued_password,password_kind,issued_at,changed_at')
      ]);
      if ($('employeeDefaultPassword')) $('employeeDefaultPassword').value = settings.employee;
      if ($('employeeCreatePassword') && !$('employeeCreatePassword').value) $('employeeCreatePassword').value = settings.employee;
      const cm = new Map((creds || []).map(x => [x.user_id,x]));
      $('employeeList').innerHTML = (profiles || []).map(p => {
        const c = cm.get(p.user_id);
        const pw = c?.issued_password ? `<span class="password-code">${esc(c.issued_password)}</span>` : '<span class="muted">已自行修改，無明碼紀錄</span>';
        return `<div class="account-box">
          <h3>${esc(p.display_name || p.login_name)}</h3>
          <div>帳號：<b>${esc(p.login_name)}</b></div>
          <div style="margin-top:6px">系統發放密碼：${pw}</div>
          <div class="account-note">狀態：${p.active?'<span class="kpi-good">啟用</span>':'<span class="kpi-bad">停用</span>'}　${p.must_change_password?'首次登入待改密碼':'已完成密碼設定'}</div>
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn small secondary" data-reset-employee="${esc(p.user_id)}" data-login="${esc(p.login_name)}" data-name="${esc(p.display_name || p.login_name)}">重設密碼</button>
            <button class="btn small ${p.active?'ghost':'primary'}" data-toggle-employee="${esc(p.user_id)}" data-active="${p.active?'1':'0'}">${p.active?'停用帳號':'啟用帳號'}</button>
          </div>
        </div>`;
      }).join('') || '<p class="muted">尚未建立員工帳號。</p>';
      document.querySelectorAll('[data-reset-employee]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm(`確定重設 ${b.dataset.login} 的密碼？`)) return;
        try {
          const d = await edge({action:'employee_account',user_id:b.dataset.resetEmployee,login_name:b.dataset.login,display_name:b.dataset.name,password:settings.employee});
          alert(`已重設 ${d.username}\n初始密碼：${d.password}`); await loadEmployees();
        } catch(e){ alert(e.message); }
      }));
      document.querySelectorAll('[data-toggle-employee]').forEach(b => b.addEventListener('click', async () => {
        const next = b.dataset.active !== '1';
        if (!confirm(`確定要${next?'啟用':'停用'}此員工帳號？`)) return;
        try { await edge({action:'employee_active',user_id:b.dataset.toggleEmployee,active:next}); await loadEmployees(); }
        catch(e){ alert(e.message); }
      }));
    } catch(e) {
      if ($('employeeList')) $('employeeList').innerHTML = `<p class="kpi-bad">員工資料載入失敗：${esc(e.message)}</p>`;
    }
  }

  async function createEmployee() {
    try {
      const display = $('employeeDisplayName').value.trim();
      const login = $('employeeLoginName').value.trim();
      const password = $('employeeCreatePassword').value;
      const d = await edge({action:'employee_account',display_name:display,login_name:login,password});
      $('employeeCreateResult').innerHTML = `<div class="credential"><b>${esc(d.display_name)} 已建立</b><br>帳號：<span class="password-code">${esc(d.username)}</span><br>初始密碼：<span class="password-code">${esc(d.password)}</span><div class="account-note">首次登入會強制修改密碼。</div></div>`;
      $('employeeDisplayName').value='';$('employeeLoginName').value='';
      await loadEmployees();
    } catch(e){ alert(e.message); }
  }

  function routeEmployee() {
    if (currentRole() !== 'employee') return;
    document.body.classList.add('role-employee');
    $('loginView')?.classList.add('hidden');
    $('vendorView')?.classList.add('hidden');
    $('adminView')?.classList.remove('hidden');
    if ($('identity')) $('identity').textContent = '員工 · 訂單操作';
    document.querySelector('.tab[data-tab="vendors"]')?.classList.add('hidden');
    document.querySelector('.tab[data-tab="review"]')?.classList.add('hidden');
    document.querySelector('.tab[data-tab="employees"]')?.classList.add('hidden');
    const tracking = document.querySelector('.tab[data-tab="tracking"]');
    if (tracking && !tracking.classList.contains('active')) tracking.click();
    setTimeout(() => $('reloadBtn')?.click(), 80);
  }

  async function changePasswordWithEdge(password) {
    if (password.length < 8) throw new Error('新密碼至少 8 碼');
    await edge({action:'change_password',password});
  }

  function showForcedPassword(profile) {
    if (!profile?.must_change_password || profile.role === 'admin' || $('forcePasswordOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id='forcePasswordOverlay';
    overlay.className='force-pass-overlay';
    overlay.innerHTML=`<div class="force-pass-card"><h2>首次登入請先修改密碼</h2><p class="muted">目前使用的是系統發放的初始密碼。完成修改後才能進入系統。</p><label>新密碼<input id="forcePass1" type="password" placeholder="至少 8 碼"></label><label>再次輸入<input id="forcePass2" type="password"></label><button id="forcePassSave" class="btn primary wide">儲存新密碼並進入系統</button><div id="forcePassMsg" class="message"></div></div>`;
    document.body.appendChild(overlay);
    $('forcePassSave').addEventListener('click', async () => {
      const a=$('forcePass1').value,b=$('forcePass2').value;
      if(a!==b){$('forcePassMsg').textContent='兩次密碼不一致';$('forcePassMsg').className='message error';return;}
      try{$('forcePassMsg').textContent='更新中…';await changePasswordWithEdge(a);overlay.remove();$('passwordNotice')?.classList.add('hidden');if(profile.role==='employee')routeEmployee();}
      catch(e){$('forcePassMsg').textContent=e.message;$('forcePassMsg').className='message error';}
    });
  }

  async function syncRoleUI() {
    const s=getSession();if(!s?.access_token)return;
    try {
      const p=await ownProfile();if(!p)return;
      document.body.classList.toggle('role-employee',p.role==='employee');
      if(p.role==='admin'){
        ensureAdminPanels();
        setTimeout(loadVendorCredentials,150);
      } else if(p.role==='employee') {
        routeEmployee();
      }
      showForcedPassword(p);
    } catch(e){ console.error('role sync',e); }
  }

  function interceptPasswordChange() {
    const btn=$('changePasswordBtn');if(!btn)return;
    btn.addEventListener('click',async(e)=>{
      e.preventDefault();e.stopImmediatePropagation();
      const a=$('newPassword')?.value||'',b=$('newPassword2')?.value||'';
      if(a!==b){const m=$('passwordMsg');if(m){m.textContent='兩次密碼不一致。';m.className='message error';}return;}
      try{await changePasswordWithEdge(a);const m=$('passwordMsg');if(m){m.textContent='新密碼已生效。';m.className='message success';}$('passwordNotice')?.classList.add('hidden');$('passwordPanel')?.classList.add('hidden');}
      catch(err){const m=$('passwordMsg');if(m){m.textContent=err.message;m.className='message error';}}
    },true);
  }

  function bindAdminRefreshes() {
    document.querySelector('.tab[data-tab="vendors"]')?.addEventListener('click',()=>setTimeout(loadVendorCredentials,120));
    $('reloadBtn')?.addEventListener('click',()=>{if(currentRole()==='admin')setTimeout(loadVendorCredentials,180);});
  }

  injectStyles();
  window.addEventListener('DOMContentLoaded',()=>{
    interceptPasswordChange();
    bindAdminRefreshes();
    setTimeout(syncRoleUI,100);
    setTimeout(syncRoleUI,700);
    $('loginBtn')?.addEventListener('click',()=>{setTimeout(syncRoleUI,250);setTimeout(syncRoleUI,900);});
  });
})();
