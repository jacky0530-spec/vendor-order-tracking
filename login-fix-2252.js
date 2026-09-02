(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const SB = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_PUBLISHABLE_KEY;
  let busy = false;

  const $ = id => document.getElementById(id);

  function loginEmail(name) {
    const n = String(name || '').trim().toLowerCase();
    return n === 'admin' ? 'admin@vendor.invalid' : `${n}@vendor.invalid`;
  }

  function setMsg(text, kind = '') {
    const el = $('loginMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'message' + (kind ? ` ${kind}` : '');
  }

  function cleanupLoggedOutUi() {
    const login = $('loginView');
    if (!login || login.classList.contains('hidden')) return;
    $('employeePasswordBtn')?.remove();
    document.body.classList.remove('role-employee', 'role-employee-full');
  }

  function enterStableApp() {
    try {
      const base = new URL(window.top.location.href);
      const parts = base.pathname.split('/');
      parts[parts.length - 1] = 'app-v227.html';
      base.pathname = parts.join('/');
      base.search = '?build=227&login=ok';
      base.hash = '';
      window.top.location.replace(base.href);
    } catch {
      window.location.replace('./app-v227.html?build=227&login=ok');
    }
  }

  async function performLogin(event) {
    const button = $('loginBtn');
    if (!button || busy) return;

    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();

    const name = String($('loginName')?.value || '').trim();
    const password = String($('loginPassword')?.value || '');
    if (!name || !password) {
      setMsg('請輸入帳號與密碼。', 'error');
      return;
    }
    if (!SB || !KEY) {
      setMsg('系統登入設定不完整，請聯絡管理者。', 'error');
      return;
    }

    busy = true;
    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = '登入中…';
    setMsg('正在驗證帳號…');

    localStorage.removeItem('vendor_order_session');
    cleanupLoggedOutUi();

    try {
      const res = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail(name), password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error_description || data.msg || data.message || '帳號或密碼錯誤');
      }
      if (!data?.access_token || !data?.user?.id) throw new Error('登入回傳資料不完整');

      localStorage.setItem('vendor_order_session', JSON.stringify(data));
      setMsg('登入成功，正在進入系統…', 'success');
      enterStableApp();
    } catch (err) {
      localStorage.removeItem('vendor_order_session');
      setMsg(err?.message || '登入失敗，請再試一次。', 'error');
      busy = false;
      button.disabled = false;
      button.textContent = oldText || '登入';
    }
  }

  document.addEventListener('click', event => {
    const btn = event.target?.closest?.('#loginBtn');
    if (!btn) return;
    performLogin(event);
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    if (event.target?.id !== 'loginPassword' && event.target?.id !== 'loginName') return;
    event.preventDefault();
    performLogin(event);
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cleanupLoggedOutUi, { once: true });
  } else {
    cleanupLoggedOutUi();
  }
  setTimeout(cleanupLoggedOutUi, 250);
  setTimeout(cleanupLoggedOutUi, 900);
})();