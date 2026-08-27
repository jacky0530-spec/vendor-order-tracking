(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const SB = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_PUBLISHABLE_KEY;

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function getSession() {
    try { return JSON.parse(localStorage.getItem('vendor_order_session') || 'null'); }
    catch { return null; }
  }

  async function api(path, options = {}) {
    const s = getSession();
    if (!s?.access_token) throw new Error('請重新登入');
    const res = await fetch(`${SB}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${s.access_token}`,
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }

  function dateFromText(text) {
    const m = String(text || '').match(/20\d{2}-\d{2}-\d{2}/);
    return m ? m[0] : '';
  }

  function rowPriority(row) {
    const badge = row.querySelector('td:first-child .badge');
    const cls = badge?.className || '';
    if (cls.includes('overdue')) return 0;
    if (cls.includes('due_soon')) return 1;
    return 2;
  }

  function overdueDays(row) {
    const m = row.cells?.[0]?.innerText.match(/逾期\s*(\d+)\s*天/);
    return m ? Number(m[1]) : 0;
  }

  function sortOrderRows() {
    const body = $('orderRows');
    if (!body || body.dataset.sorting === '1') return;
    const rows = [...body.querySelectorAll('tr')].filter(r => r.cells.length >= 2);
    if (rows.length < 2) return;
    body.dataset.sorting = '1';
    rows.sort((a, b) => {
      const pa = rowPriority(a), pb = rowPriority(b);
      if (pa !== pb) return pa - pb;
      if (pa === 0) {
        const d = overdueDays(b) - overdueDays(a);
        if (d) return d;
      }
      if (pa === 1) {
        const da = dateFromText(a.cells?.[5]?.innerText) || '9999-12-31';
        const db = dateFromText(b.cells?.[5]?.innerText) || '9999-12-31';
        const c = da.localeCompare(db);
        if (c) return c;
      }
      const oa = dateFromText(a.cells?.[1]?.innerText) || '0000-00-00';
      const ob = dateFromText(b.cells?.[1]?.innerText) || '0000-00-00';
      return ob.localeCompare(oa);
    });
    const frag = document.createDocumentFragment();
    rows.forEach(r => frag.appendChild(r));
    body.appendChild(frag);
    delete body.dataset.sorting;
  }

  function hideShippedEnabled() {
    const stored = localStorage.getItem('vendor_order_hide_shipped');
    return stored == null ? true : stored === '1';
  }

  function rowIsShipped(row) {
    const select = row.querySelector('select[id^="status-"]');
    const status = select?.value || '';
    const completedBadge = row.querySelector('td:first-child .badge.completed');
    return status === 'shipped' || status === 'completed' || Boolean(completedBadge);
  }

  function applyShippedVisibility() {
    const body = $('orderRows');
    if (!body) return;
    const hide = $('hideShippedToggle')?.checked ?? hideShippedEnabled();
    body.querySelectorAll('tr').forEach((row) => {
      if (row.cells.length < 2) return;
      row.classList.toggle('shipped-hidden', hide && rowIsShipped(row));
    });
  }

  async function deleteOrder(orderId, row) {
    const orderNo = (row?.cells?.[1]?.innerText || '此訂單').split('\n')[0].trim();
    const first = confirm(`確定要刪除 ${orderNo}？\n\n商品明細與廠商出貨回覆會一併刪除。`);
    if (!first) return;
    const second = confirm(`再次確認：永久刪除 ${orderNo}？\n此動作無法復原。`);
    if (!second) return;

    const btn = row?.querySelector(`[data-delete-order="${orderId}"]`);
    if (btn) {
      btn.disabled = true;
      btn.textContent = '刪除中…';
    }

    try {
      await api(`orders?id=eq.${encodeURIComponent(orderId)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' }
      });
      row?.remove();
      alert(`${orderNo} 已刪除。\n原始 LINE 匯入紀錄仍保留，用來防止同一訊息再次重複建立。`);
      if ($('reloadBtn')) $('reloadBtn').click();
    } catch (e) {
      alert(`刪除失敗：${e.message}`);
      if (btn) {
        btn.disabled = false;
        btn.textContent = '刪除';
      }
    }
  }

  function enhanceOrderRows() {
    const body = $('orderRows');
    if (!body || body.dataset.enhancing === '1') return;
    body.dataset.enhancing = '1';

    body.querySelectorAll('tr').forEach((row) => {
      const saveBtn = row.querySelector('[data-save-status]');
      if (!saveBtn) return;
      const orderId = saveBtn.dataset.saveStatus;
      if (!orderId || row.querySelector('[data-delete-order]')) return;

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn small delete-btn';
      del.dataset.deleteOrder = orderId;
      del.textContent = '刪除';
      del.addEventListener('click', () => deleteOrder(orderId, row));
      saveBtn.insertAdjacentElement('afterend', del);
    });

    applyShippedVisibility();
    sortOrderRows();
    delete body.dataset.enhancing;
  }

  function installTrackingControls() {
    const filters = document.querySelector('#tab-tracking .filters');
    if (filters && !$('hideShippedToggle')) {
      const label = document.createElement('label');
      label.className = 'filter-toggle';
      label.innerHTML = `<input id="hideShippedToggle" type="checkbox"> <span>隱藏已出貨／完成</span>`;
      filters.appendChild(label);
      const toggle = $('hideShippedToggle');
      toggle.checked = hideShippedEnabled();
      toggle.addEventListener('change', () => {
        localStorage.setItem('vendor_order_hide_shipped', toggle.checked ? '1' : '0');
        applyShippedVisibility();
      });
    }

    const body = $('orderRows');
    if (!body) return;
    let timer;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(enhanceOrderRows, 30);
    });
    observer.observe(body, { childList: true, subtree: true });
    setTimeout(enhanceOrderRows, 100);
  }

  function statusBadge(status) {
    const map = {
      parsed:['成功匯入','normal'],
      needs_review:['需確認','due_soon'],
      ignored:['已忽略','completed'],
      error:['錯誤','overdue'],
      pending:['處理中','unknown']
    };
    const [txt, cls] = map[status] || [status || '未知','unknown'];
    return `<span class="badge ${cls}">${esc(txt)}</span>`;
  }

  function fmtTaipei(value) {
    if (!value) return '—';
    try {
      return new Intl.DateTimeFormat('zh-TW', {
        timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit',
        hour:'2-digit', minute:'2-digit', hour12:false
      }).format(new Date(value));
    } catch { return value; }
  }

  let historyEvents = [];
  let orderMap = new Map();

  async function loadHistory() {
    const rows = $('historyRows');
    if (!rows) return;
    rows.innerHTML = '<tr><td colspan="5" class="muted">載入中…</td></tr>';
    try {
      const [events, orderIds] = await Promise.all([
        api('line_events?select=id,line_message_id,received_at,source_type,raw_text,parse_status,parse_error,parsed_payload,created_order_id&order=received_at.desc&limit=500'),
        api('orders?select=id,tracking_id')
      ]);
      historyEvents = events || [];
      orderMap = new Map((orderIds || []).map(o => [o.id, `ORD-${String(o.tracking_id).padStart(6,'0')}`]));
      renderHistory();
    } catch (e) {
      rows.innerHTML = `<tr><td colspan="5" class="muted">載入失敗：${esc(e.message)}</td></tr>`;
    }
  }

  function renderHistory() {
    const rows = $('historyRows');
    if (!rows) return;
    const q = ($('historySearch')?.value || '').trim().toLowerCase();
    const status = $('historyStatus')?.value || '';
    const filtered = historyEvents.filter(e => {
      const vendor = e.parsed_payload?.shipper || e.parsed_payload?.vendor_code || '';
      const ord = orderMap.get(e.created_order_id) || '';
      const hay = `${e.raw_text || ''} ${vendor} ${ord} ${e.parse_error || ''}`.toLowerCase();
      return (!q || hay.includes(q)) && (!status || e.parse_status === status);
    });
    $('historySummary').textContent = `共 ${historyEvents.length} 筆匯入事件，目前顯示 ${filtered.length} 筆。`;
    rows.innerHTML = filtered.map(e => {
      const vendor = e.parsed_payload?.shipper || '—';
      const ord = orderMap.get(e.created_order_id) || (e.parse_status === 'ignored' ? '不建立' : '—');
      const err = e.parse_error ? `<div class="muted">${esc(e.parse_error)}</div>` : '';
      return `<tr>
        <td>${esc(fmtTaipei(e.received_at))}<br><span class="muted">${esc(e.source_type || '')}</span></td>
        <td>${statusBadge(e.parse_status)}${err}</td>
        <td><b>${esc(ord)}</b></td>
        <td>${esc(vendor)}</td>
        <td><details><summary>查看原始訊息</summary><pre style="white-space:pre-wrap;max-width:560px;margin:8px 0 0">${esc(e.raw_text || '')}</pre></details></td>
      </tr>`;
    }).join('') || '<tr><td colspan="5" class="muted">沒有符合條件的匯入紀錄。</td></tr>';
  }

  function installHistoryTab() {
    const btn = document.querySelector('.tab[data-tab="history"]');
    if (!btn) return;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(x => x.classList.add('hidden'));
      btn.classList.add('active');
      $('tab-history')?.classList.remove('hidden');
      loadHistory();
    });
    $('reloadHistoryBtn')?.addEventListener('click', loadHistory);
    $('historySearch')?.addEventListener('input', renderHistory);
    $('historyStatus')?.addEventListener('change', renderHistory);
  }

  window.addEventListener('DOMContentLoaded', () => {
    installTrackingControls();
    installHistoryTab();
  });
})();
