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

  async function api(path) {
    const s = getSession();
    if (!s?.access_token) throw new Error('請重新登入');
    const res = await fetch(`${SB}/rest/v1/${path}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${s.access_token}` }
    });
    if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
    return res.json();
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

  function installOrderSorter() {
    const body = $('orderRows');
    if (!body) return;
    let timer;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(sortOrderRows, 30);
    });
    observer.observe(body, { childList: true, subtree: true });
    setTimeout(sortOrderRows, 100);
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
    installOrderSorter();
    installHistoryTab();
  });
})();
