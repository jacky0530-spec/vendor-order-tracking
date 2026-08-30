(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const SB = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_PUBLISHABLE_KEY;
  const ADMIN_API = CFG.ADMIN_API_URL;

  let session = null;
  let profile = null;
  let orders = [];
  let items = [];
  let vendors = [];
  let vendorProfiles = [];

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = (value) => value || '—';
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

  function setMessage(id, text, kind = '') {
    const el = $(id);
    if (!el) return;
    el.textContent = text || '';
    el.className = 'message' + (kind ? ` ${kind}` : '');
  }

  function loginEmail(name) {
    const n = String(name || '').trim().toLowerCase();
    return n === 'admin' ? 'admin@vendor.invalid' : `${n}@vendor.invalid`;
  }

  async function login(name, password) {
    const res = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginEmail(name), password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error_description || data.msg || data.message || '登入失敗');
    return data;
  }

  async function refreshSession() {
    if (!session?.refresh_token) throw new Error('登入已過期');
    const res = await fetch(`${SB}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('登入已過期');
    session = data;
    saveSession();
  }

  function saveSession() {
    localStorage.setItem('vendor_order_session', JSON.stringify(session));
  }

  function clearSession() {
    localStorage.removeItem('vendor_order_session');
    session = null;
    profile = null;
  }

  async function authFetch(url, options = {}, retry = true) {
    const headers = {
      apikey: KEY,
      Authorization: `Bearer ${session?.access_token || ''}`,
      ...(options.headers || {})
    };
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401 && retry && session?.refresh_token) {
      await refreshSession();
      return authFetch(url, options, false);
    }
    return res;
  }

  async function rest(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const res = await authFetch(`${SB}/rest/v1/${path}`, { ...options, headers });
    const text = await res.text();
    if (!res.ok) throw new Error(parseApiError(text) || `HTTP ${res.status}`);
    return text ? JSON.parse(text) : null;
  }

  function parseApiError(text) {
    try {
      const d = JSON.parse(text);
      return d.message || d.hint || d.details || text;
    } catch {
      return text;
    }
  }

  async function edgeApi(body, needAuth = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (needAuth && session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    let res = await fetch(ADMIN_API, { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.status === 401 && needAuth && session?.refresh_token) {
      await refreshSession();
      headers.Authorization = `Bearer ${session.access_token}`;
      res = await fetch(ADMIN_API, { method: 'POST', headers, body: JSON.stringify(body) });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
    return data;
  }

  async function loadProfile() {
    const uid = session?.user?.id;
    if (!uid) throw new Error('登入資料不完整');
    const rows = await rest(`user_profiles?select=*&user_id=eq.${encodeURIComponent(uid)}`);
    if (!rows?.length) throw new Error('此帳號尚未建立權限資料');
    profile = rows[0];
    if (profile.active === false) throw new Error('此帳號已停用');
  }

  function showLoggedOut() {
    $('loginView').classList.remove('hidden');
    $('adminView').classList.add('hidden');
    $('vendorView').classList.add('hidden');
    $('logoutBtn').classList.add('hidden');
    $('identity').textContent = '';
  }

  async function showLoggedIn() {
    $('loginView').classList.add('hidden');
    $('logoutBtn').classList.remove('hidden');
    $('identity').textContent = `${profile.display_name || profile.login_name} · ${profile.role === 'admin' ? '管理員' : '廠商'}`;
    if (profile.role === 'admin') {
      $('adminView').classList.remove('hidden');
      $('vendorView').classList.add('hidden');
      await loadAdmin();
    } else {
      $('adminView').classList.add('hidden');
      $('vendorView').classList.remove('hidden');
      await loadVendor();
    }
  }

  function alertBadge(level, overdueDays = 0) {
    if (level === 'overdue') return `<span class="badge overdue">逾期 ${Number(overdueDays || 0)} 天</span>`;
    if (level === 'due_soon') return '<span class="badge due_soon">3 天內到期</span>';
    if (level === 'completed') return '<span class="badge completed">完成</span>';
    if (level === 'normal') return '<span class="badge normal">正常</span>';
    return '<span class="badge unknown">待確認</span>';
  }

  function statusText(status) {
    return ({
      new:'新訂單', vendor_unconfirmed:'待廠商確認', vendor_confirmed:'廠商已確認', preparing:'備貨中',
      shipped:'已出貨', completed:'已完成', cancelled:'已取消', out_of_stock:'缺貨', delayed:'延後'
    })[status] || status || '—';
  }

  function productLines(orderId) {
    const list = items.filter((x) => x.order_id === orderId);
    if (!list.length) return '<span class="muted">無商品明細</span>';
    return list.map((x) => {
      const qty = x.quantity != null ? ` × ${esc(x.quantity)}${esc(x.quantity_unit || '')}` : '';
      const variant = x.variant ? `｜${esc(x.variant)}` : '';
      return `<span class="product-line"><b>${esc(x.product_code || '')}</b> ${esc(x.product_name || '')}${variant}${qty}</span>`;
    }).join('');
  }

  function searchProductText(orderId) {
    return items.filter((x) => x.order_id === orderId)
      .map((x) => `${x.product_code || ''} ${x.product_name || ''} ${x.variant || ''} ${x.quantity || ''}`)
      .join(' ');
  }

  async function loadAdmin() {
    try {
      [orders, items, vendors, vendorProfiles] = await Promise.all([
        rest('order_tracking_overview?select=*'),
        rest('order_items?select=*&order=sort_order.asc'),
        rest('vendors?select=*&active=eq.true&order=vendor_code.asc'),
        rest('user_profiles?select=user_id,vendor_id,login_name,active,role&role=eq.vendor')
      ]);
      const priority = { overdue:0, due_soon:1, normal:2, unknown:3, completed:4 };
      orders.sort((a,b) => (priority[a.alert_level] ?? 9) - (priority[b.alert_level] ?? 9) || String(a.effective_due_date || '9999').localeCompare(String(b.effective_due_date || '9999')));
      renderAdminMetrics();
      renderVendorFilter();
      renderOrders();
      renderVendorCards();
    } catch (e) {
      alert(`管理資料載入失敗：${e.message}`);
    }
  }

  function renderAdminMetrics() {
    $('metricOpen').textContent = orders.filter((o) => !['completed','cancelled'].includes(o.status) && !o.actual_ship_date).length;
    $('metricSoon').textContent = orders.filter((o) => o.alert_level === 'due_soon').length;
    $('metricLate').textContent = orders.filter((o) => o.alert_level === 'overdue').length;
    $('metricDone').textContent = orders.filter((o) => o.alert_level === 'completed' || o.actual_ship_date || ['shipped','completed'].includes(o.status)).length;
  }

  function renderVendorFilter() {
    const old = $('vendorFilter').value;
    $('vendorFilter').innerHTML = '<option value="">全部廠商</option>' + vendors.map((v) => `<option value="${esc(v.id)}">${esc(v.vendor_code)} ${esc(v.name)}</option>`).join('');
    $('vendorFilter').value = old;
  }

  function renderOrders() {
    const q = $('searchInput').value.trim().toLowerCase();
    const vendorId = $('vendorFilter').value;
    const alert = $('alertFilter').value;
    const rows = orders.filter((o) => {
      const hay = `${o.order_no} ${o.vendor_name} ${o.receiver || ''} ${o.receiver_phone || ''} ${searchProductText(o.id)}`.toLowerCase();
      return (!q || hay.includes(q)) && (!vendorId || o.vendor_id === vendorId) && (!alert || o.alert_level === alert);
    });
    $('orderRows').innerHTML = rows.map((o) => `
      <tr>
        <td>${alertBadge(o.alert_level, o.overdue_days)}</td>
        <td><b>${esc(o.order_no)}</b><br><span class="muted">${esc(o.order_date)}</span></td>
        <td>${productLines(o.id)}</td>
        <td><b>${esc(o.vendor_code)}</b><br>${esc(o.vendor_name)}</td>
        <td>${esc(o.receiver || '—')}<br><span class="muted">${esc(o.receiver_phone || '')}</span></td>
        <td>${esc(fmt(o.expected_from))}${o.expected_deadline && o.expected_deadline !== o.expected_from ? ` ～ ${esc(o.expected_deadline)}` : ''}<br><span class="muted">${esc(o.lead_time_text || '')}</span></td>
        <td>${esc(fmt(o.promised_ship_date))}<br><span class="muted">${esc(o.vendor_status ? statusText(o.vendor_status) : '')} ${esc(o.vendor_note || '')}</span></td>
        <td>
          <select id="status-${esc(o.id)}">
            ${['new','vendor_unconfirmed','vendor_confirmed','preparing','shipped','completed','cancelled','out_of_stock','delayed'].map((s) => `<option value="${s}" ${o.status===s?'selected':''}>${statusText(s)}</option>`).join('')}
          </select>
        </td>
        <td><button class="btn small primary" data-save-status="${esc(o.id)}">儲存</button></td>
      </tr>`).join('') || '<tr><td colspan="9" class="muted">沒有符合條件的訂單。</td></tr>';

    document.querySelectorAll('[data-save-status]').forEach((btn) => btn.addEventListener('click', () => saveOrderStatus(btn.dataset.saveStatus)));
  }

  async function saveOrderStatus(orderId) {
    try {
      const status = $(`status-${orderId}`).value;
      await rest(`orders?id=eq.${encodeURIComponent(orderId)}`, {
        method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ status })
      });
      await loadAdmin();
    } catch (e) { alert(`儲存失敗：${e.message}`); }
  }

  function renderVendorCards() {
    const profileMap = new Map(vendorProfiles.map((p) => [p.vendor_id, p]));
    $('vendorCards').innerHTML = vendors.map((v) => {
      const p = profileMap.get(v.id);
      return `<div class="vendor-card">
        <h3>${esc(v.vendor_code)} ${esc(v.name)}</h3>
        <div class="muted">${p?.active ? '帳號：已建立' : '帳號：尚未建立'}</div>
        <div class="row">
          <label>預設交期（天）<input id="lead-${esc(v.id)}" type="number" min="0" max="365" value="${Number(v.default_lead_days ?? 14)}"></label>
          <button class="btn small ghost" data-save-lead="${esc(v.id)}">儲存</button>
        </div>
        <button class="btn primary wide" data-account="${esc(v.id)}">${p ? '重設廠商密碼' : '建立廠商帳號'}</button>
      </div>`;
    }).join('');
    document.querySelectorAll('[data-save-lead]').forEach((b) => b.addEventListener('click', () => saveLeadDays(b.dataset.saveLead)));
    document.querySelectorAll('[data-account]').forEach((b) => b.addEventListener('click', () => makeVendorAccount(b.dataset.account)));
  }

  async function saveLeadDays(vendorId) {
    const days = Number($(`lead-${vendorId}`).value);
    if (!Number.isFinite(days) || days < 0 || days > 365) return alert('請輸入 0～365 天。');
    try {
      await rest(`vendors?id=eq.${encodeURIComponent(vendorId)}`, {
        method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ default_lead_days: days })
      });
      alert('預設交期已更新。');
      await loadAdmin();
    } catch (e) { alert(`更新失敗：${e.message}`); }
  }

  async function makeVendorAccount(vendorId) {
    if (!confirm('建立或重設後會產生新的臨時密碼，確定繼續？')) return;
    try {
      const data = await edgeApi({ action:'vendor_account', vendor_id:vendorId }, true);
      $('credentialBox').innerHTML = `<div class="credential">
        <b>${esc(data.vendor_name)} 帳號已建立／重設</b><br>
        帳號：<code>${esc(data.username)}</code><br>
        臨時密碼：<code>${esc(data.password)}</code><br>
        <span class="muted">請現在複製給廠商。明碼密碼不會保存在資料表。</span>
      </div>`;
      await loadAdmin();
    } catch (e) { alert(`帳號處理失敗：${e.message}`); }
  }

  async function loadReports() {
    try {
      const [summary, monthly] = await Promise.all([
        rest('vendor_shipping_summary?select=*&order=vendor_code.asc'),
        rest('monthly_shipping_summary?select=*&order=month.desc,vendor_code.asc')
      ]);
      $('vendorReportRows').innerHTML = (summary || []).map((r) => `<tr><td><b>${esc(r.vendor_code)}</b> ${esc(r.vendor_name)}</td><td>${r.total_orders}</td><td>${r.open_orders}</td><td>${r.overdue_orders}</td><td>${r.due_soon_orders}</td><td>${r.shipped_orders}</td><td>${r.on_time_rate == null ? '—' : `${r.on_time_rate}%`}</td><td>${r.avg_delay_days == null ? '—' : `${r.avg_delay_days} 天`}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">尚無資料。</td></tr>';
      $('monthlyReportRows').innerHTML = (monthly || []).map((r) => `<tr><td>${esc(r.month)}</td><td>${esc(r.vendor_code)} ${esc(r.vendor_name)}</td><td>${r.total_orders}</td><td>${r.shipped_orders}</td><td>${r.pending_orders}</td><td>${r.on_time_orders}</td><td>${r.delayed_orders}</td><td>${r.on_time_rate == null ? '—' : `${r.on_time_rate}%`}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">尚無資料。</td></tr>';
    } catch (e) { alert(`報表載入失敗：${e.message}`); }
  }

  async function loadReviewQueue() {
    try {
      const rows = await rest('line_review_queue?select=*&order=received_at.desc');
      $('reviewList').innerHTML = (rows || []).map((r) => `<div class="review-card"><div><b>${esc(r.received_at)}</b> · ${esc(r.parse_error || '')}</div><pre>${esc(r.raw_text)}</pre></div>`).join('') || '<p class="muted">目前沒有待人工確認的 LINE 訊息。</p>';
    } catch (e) { alert(`LINE 異常載入失敗：${e.message}`); }
  }

  async function loadVendor() {
    if (!profile.vendor_id) throw new Error('此廠商帳號尚未綁定廠商');
    const [vendorRows, ownOrders, ownItems, updates] = await Promise.all([
      rest(`vendors?select=*&id=eq.${encodeURIComponent(profile.vendor_id)}`),
      rest(`order_tracking_overview?select=*&vendor_id=eq.${encodeURIComponent(profile.vendor_id)}`),
      rest(`order_items?select=*&order=sort_order.asc`),
      rest(`vendor_updates?select=*&vendor_id=eq.${encodeURIComponent(profile.vendor_id)}`)
    ]);
    const vendor = vendorRows?.[0];
    const updateMap = new Map((updates || []).map((x) => [x.order_id, x]));
    $('vendorTitle').textContent = `${vendor?.vendor_code || ''} ${vendor?.name || ''}｜我的訂單`;
    $('passwordNotice').classList.toggle('hidden', !profile.must_change_password);
    const sorted = (ownOrders || []).sort((a,b) => String(a.effective_due_date || '9999').localeCompare(String(b.effective_due_date || '9999')));
    $('vendorOrders').innerHTML = sorted.map((o) => {
      const u = updateMap.get(o.id) || {};
      const oi = (ownItems || []).filter((x) => x.order_id === o.id);
      return `<div class="vendor-order ${o.alert_level === 'overdue' ? 'overdue-card' : ''}">
        <div class="vendor-order-head"><div><h3>${esc(o.order_no)}</h3><span class="muted">訂購日 ${esc(o.order_date)}</span></div>${alertBadge(o.alert_level,o.overdue_days)}</div>
        <div class="item-box">${oi.map((x) => `<div><b>${esc(x.product_code || '')}</b> ${esc(x.product_name || '')}${x.variant ? `｜${esc(x.variant)}` : ''}${x.quantity != null ? ` × ${esc(x.quantity)}${esc(x.quantity_unit || '')}` : ''}</div>`).join('')}</div>
        <div class="vendor-meta">收貨人：<b>${esc(o.receiver || '—')}</b>　原交期：${esc(fmt(o.expected_deadline))}</div>
        <div class="form-grid">
          <label>目前狀態<select id="v-status-${esc(o.id)}">${['confirmed','preparing','shipped','out_of_stock','delayed'].map((s) => `<option value="${s}" ${u.vendor_status===s?'selected':''}>${({confirmed:'廠商已確認',preparing:'備貨中',shipped:'已出貨',out_of_stock:'缺貨',delayed:'延後'})[s]}</option>`).join('')}</select></label>
          <label>預計出貨日<input id="v-promised-${esc(o.id)}" type="date" value="${esc(u.promised_ship_date || '')}"></label>
          <label>實際出貨日<input id="v-actual-${esc(o.id)}" type="date" value="${esc(u.actual_ship_date || '')}"></label>
          <label>物流公司<input id="v-carrier-${esc(o.id)}" value="${esc(u.carrier || '')}" placeholder="黑貓／新竹物流…"></label>
          <label>物流單號<input id="v-track-${esc(o.id)}" value="${esc(u.tracking_no || '')}"></label>
          <label class="full">備註<textarea id="v-note-${esc(o.id)}">${esc(u.note || '')}</textarea></label>
        </div>
        <button class="btn primary" data-vsave="${esc(o.id)}" data-vendor="${esc(profile.vendor_id)}">儲存出貨回覆</button>
      </div>`;
    }).join('') || '<p class="muted">目前沒有待處理訂單。</p>';
    document.querySelectorAll('[data-vsave]').forEach((b) => b.addEventListener('click', () => saveVendorUpdate(b.dataset.vsave, b.dataset.vendor)));
  }

  async function saveVendorUpdate(orderId, vendorId) {
    try {
      let vendorStatus = $(`v-status-${orderId}`).value;
      let actual = $(`v-actual-${orderId}`).value || null;
      if (vendorStatus === 'shipped' && !actual) actual = today();
      const payload = {
        order_id: orderId,
        vendor_id: vendorId,
        promised_ship_date: $(`v-promised-${orderId}`).value || null,
        actual_ship_date: actual,
        carrier: $(`v-carrier-${orderId}`).value.trim() || null,
        tracking_no: $(`v-track-${orderId}`).value.trim() || null,
        vendor_status: vendorStatus,
        note: $(`v-note-${orderId}`).value.trim() || null,
        created_by: session.user.id
      };
      await rest('vendor_updates?on_conflict=order_id,vendor_id', {
        method:'POST', headers:{ Prefer:'resolution=merge-duplicates,return=representation' }, body:JSON.stringify(payload)
      });
      alert('出貨資訊已儲存。');
      await loadVendor();
    } catch (e) { alert(`儲存失敗：${e.message}`); }
  }

  async function changePassword() {
    const p1 = $('newPassword').value;
    const p2 = $('newPassword2').value;
    if (p1.length < 8) return setMessage('passwordMsg','新密碼至少 8 碼。','error');
    if (p1 !== p2) return setMessage('passwordMsg','兩次密碼不一致。','error');
    try {
      setMessage('passwordMsg','更新中…');
      const res = await authFetch(`${SB}/auth/v1/user`, {
        method:'PUT', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ password:p1 })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.msg || data.message || '密碼更新失敗');
      // 後端權限旗標若尚未同步，不影響新密碼立即生效。
      setMessage('passwordMsg','新密碼已生效。請妥善保存。','success');
      $('passwordNotice').classList.add('hidden');
      $('passwordPanel').classList.add('hidden');
    } catch (e) { setMessage('passwordMsg',e.message,'error'); }
  }

  function bindTabs() {
    document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', async () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === tab));
      document.querySelectorAll('.tab-panel').forEach((x) => x.classList.add('hidden'));
      $(`tab-${tab.dataset.tab}`).classList.remove('hidden');
      if (tab.dataset.tab === 'report') await loadReports();
      if (tab.dataset.tab === 'review') await loadReviewQueue();
    }));
  }

  function bindEvents() {
    $('loginBtn').addEventListener('click', async () => {
      try {
        setMessage('loginMsg','登入中…');
        session = await login($('loginName').value, $('loginPassword').value);
        saveSession();
        await loadProfile();
        setMessage('loginMsg','');
        await showLoggedIn();
      } catch (e) {
        clearSession();
        setMessage('loginMsg', e.message, 'error');
      }
    });
    $('loginPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('loginBtn').click(); });
    $('logoutBtn').addEventListener('click', () => { clearSession(); location.reload(); });
    $('setupBtn').addEventListener('click', async () => {
      const password = $('setupPassword').value;
      if (password.length < 8) return setMessage('setupMsg','管理員密碼至少 8 碼。','error');
      try {
        setMessage('setupMsg','建立中…');
        const d = await edgeApi({ action:'bootstrap_admin', setup_code:$('setupCode').value.trim(), password }, false);
        setMessage('setupMsg',`建立完成。請用 ${d.username || 'ADMIN'} 登入。`,'success');
        $('loginName').value = 'ADMIN';
      } catch (e) { setMessage('setupMsg',e.message,'error'); }
    });
    $('searchInput').addEventListener('input', renderOrders);
    $('vendorFilter').addEventListener('change', renderOrders);
    $('alertFilter').addEventListener('change', renderOrders);
    // Keep the system refresh button identical to a browser page refresh.
    // The authenticated session is stored in localStorage, so a full reload
    // re-runs every UI enhancement module without logging the user out.
    $('reloadBtn').addEventListener('click', () => location.reload());
    $('reloadReviewBtn').addEventListener('click', loadReviewQueue);
    $('vendorReloadBtn').addEventListener('click', loadVendor);
    $('showPasswordBtn').addEventListener('click', () => $('passwordPanel').classList.toggle('hidden'));
    $('changePasswordBtn').addEventListener('click', changePassword);
    bindTabs();
  }

  async function init() {
    if (!SB || !KEY || !ADMIN_API) {
      document.body.innerHTML = '<main style="padding:30px;font-family:sans-serif"><h2>系統設定不完整</h2><p>請檢查 config.js。</p></main>';
      return;
    }
    bindEvents();
    showLoggedOut();
    try {
      const saved = JSON.parse(localStorage.getItem('vendor_order_session') || 'null');
      if (saved?.access_token && saved?.user?.id) {
        session = saved;
        await loadProfile();
        await showLoggedIn();
      }
    } catch (e) {
      clearSession();
      showLoggedOut();
    }
  }

  init();
})();