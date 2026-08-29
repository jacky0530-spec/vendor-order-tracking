(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const SB = CFG.SUPABASE_URL;
  const KEY = CFG.SUPABASE_PUBLISHABLE_KEY;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function session(){ try { return JSON.parse(localStorage.getItem('vendor_order_session') || 'null'); } catch { return null; } }
  function jwt(token=''){
    try {
      const p = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      const pad = p.length % 4 ? '='.repeat(4 - p.length % 4) : '';
      return JSON.parse(decodeURIComponent(escape(atob(p + pad))));
    } catch { return {}; }
  }
  function role(){ return jwt(session()?.access_token || '').app_metadata?.role || ''; }

  async function rest(path){
    const s = session();
    if(!s?.access_token) throw new Error('登入已過期');
    const r = await fetch(`${SB}/rest/v1/${path}`, { headers:{ apikey:KEY, Authorization:`Bearer ${s.access_token}` } });
    const t = await r.text();
    if(!r.ok) throw new Error(t || `HTTP ${r.status}`);
    return t ? JSON.parse(t) : null;
  }

  function header(bodyId, after){
    const table = $(bodyId)?.closest('table');
    const tr = table?.querySelector('thead tr');
    if(!tr || [...tr.children].some(x => x.textContent.trim() === '出貨箱數')) return;
    const cells = [...tr.children];
    const idx = cells.findIndex(x => x.textContent.trim() === after);
    const th = document.createElement('th');
    th.textContent = '出貨箱數';
    if(idx >= 0 && cells[idx].nextSibling) tr.insertBefore(th, cells[idx].nextSibling);
    else tr.appendChild(th);
  }

  function drillButton(label, count, vendorId, vendorCode, vendorName, mode, extraClass=''){
    const disabled = Number(count || 0) === 0;
    return `<button type="button" class="report-drill-link ${extraClass}" data-report-drill="${esc(mode)}" data-vendor-id="${esc(vendorId)}" data-vendor-code="${esc(vendorCode)}" data-vendor-name="${esc(vendorName)}" ${disabled?'disabled':''}>${label}</button>`;
  }

  function ensureDrillPanel(){
    if($('vendorReportDrilldown')) return $('vendorReportDrilldown');
    const reportPanel = $('tab-report');
    const firstCard = reportPanel?.querySelector('.card.section-card');
    if(!reportPanel || !firstCard) return null;
    const panel = document.createElement('div');
    panel.id = 'vendorReportDrilldown';
    panel.className = 'card section-card report-drill-panel hidden';
    panel.innerHTML = `
      <div class="section-head report-drill-head">
        <div>
          <h2 id="reportDrillTitle">廠商商品明細</h2>
          <p id="reportDrillSubtitle" class="muted"></p>
        </div>
        <button type="button" class="btn ghost" id="closeReportDrill">關閉明細</button>
      </div>
      <div id="reportDrillFilters" class="report-drill-filters"></div>
      <div id="reportDrillContent" class="report-drill-content"><div class="muted">請點選上方廠商或數字。</div></div>`;
    firstCard.insertAdjacentElement('afterend', panel);
    return panel;
  }

  function injectStyles(){
    if($('reportDrillStyles')) return;
    const st = document.createElement('style');
    st.id = 'reportDrillStyles';
    st.textContent = `
      .report-drill-link{appearance:none;border:0;background:transparent;padding:4px 6px;margin:-4px -6px;border-radius:7px;color:#0f766e;font:inherit;font-weight:800;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
      .report-drill-link:hover{background:#ecfdf3}.report-drill-link:disabled{color:#667085;text-decoration:none;cursor:default;background:transparent;font-weight:500}
      .report-drill-link.is-danger{color:#b42318}.report-drill-link.is-warn{color:#b54708}.report-drill-link.is-shipped{color:#175cd3}
      .report-drill-panel{margin-top:16px;border:2px solid #d1e9ff}.report-drill-head{align-items:flex-start}
      .report-drill-filters{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}.report-drill-filter{min-height:38px}
      .report-drill-filter.active{background:#0f766e;color:#fff;border-color:#0f766e}
      .report-detail-product{min-width:260px}.report-detail-product b{color:#0f766e}.report-detail-order{font-weight:800;white-space:nowrap}
      .report-overdue-badge{display:inline-flex;padding:3px 8px;border-radius:999px;background:#fee4e2;color:#b42318;font-weight:800;white-space:nowrap}
      .report-soon-badge{display:inline-flex;padding:3px 8px;border-radius:999px;background:#fef0c7;color:#b54708;font-weight:800;white-space:nowrap}
      .report-pending-badge{display:inline-flex;padding:3px 8px;border-radius:999px;background:#f2f4f7;color:#344054;font-weight:700;white-space:nowrap}
      .report-shipped-badge{display:inline-flex;padding:3px 8px;border-radius:999px;background:#dcfae6;color:#067647;font-weight:800;white-space:nowrap}
      .report-ship-info{line-height:1.6;min-width:240px}.report-batch{font-weight:800;color:#175cd3}.report-delay{color:#b42318;font-weight:800}
      @media(max-width:760px){
        .report-drill-panel{padding:14px!important}.report-drill-head{gap:10px}.report-drill-head .btn{width:auto!important;min-width:90px}
        .report-drill-filters{display:grid;grid-template-columns:1fr 1fr}.report-drill-filter{width:100%}
        #reportDrillContent .responsive-table tbody tr{margin-bottom:12px;border:1px solid #d0d5dd;border-radius:12px;background:#fff;padding:8px}
        .report-detail-product,.report-ship-info{min-width:0}
      }
    `;
    document.head.appendChild(st);
  }

  function taipeiToday(){ return new Date().toLocaleDateString('en-CA', {timeZone:'Asia/Taipei'}); }
  function addDays(dateStr, n){
    const d = new Date(`${dateStr}T00:00:00+08:00`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toLocaleDateString('en-CA', {timeZone:'Asia/Taipei'});
  }

  function filterDetails(rows, mode){
    const today = taipeiToday();
    const soon = addDays(today, 3);
    if(mode === 'shipped') return rows.filter(x => x.actual_ship_date);
    if(mode === 'overdue') return rows.filter(x => !x.actual_ship_date && Number(x.overdue_days || 0) > 0);
    if(mode === 'due_soon') return rows.filter(x => !x.actual_ship_date && x.due_date && x.due_date >= today && x.due_date <= soon);
    return rows.filter(x => !x.actual_ship_date);
  }

  function modeTitle(mode){
    return ({pending:'尚未出貨商品', overdue:'逾期未出貨商品', due_soon:'3 天內到期商品', shipped:'已出貨商品'})[mode] || '商品明細';
  }

  function statusHtml(x){
    if(x.actual_ship_date){
      const delay = Number(x.shipment_delay_days || 0);
      return `<span class="report-shipped-badge">已出貨</span>${delay>0?`<br><span class="report-delay">延遲 ${delay} 天</span>`:''}`;
    }
    const overdue = Number(x.overdue_days || 0);
    if(overdue > 0) return `<span class="report-overdue-badge">逾期 ${overdue} 天</span>`;
    const today = taipeiToday();
    const soon = addDays(today,3);
    if(x.due_date && x.due_date >= today && x.due_date <= soon) return `<span class="report-soon-badge">3 天內到期</span>`;
    return `<span class="report-pending-badge">待出貨</span>`;
  }

  function shipInfoHtml(x){
    if(!x.actual_ship_date) return '<span class="muted">尚無出貨資料</span>';
    const batch = x.shipment_batch_no ? `<span class="report-batch">${esc(x.shipment_batch_no)}</span><br>` : '';
    const boxes = x.shipping_box_count == null ? '—' : `${Number(x.shipping_box_count)} 箱`;
    const logistics = [x.carrier, x.tracking_no].filter(Boolean).map(esc).join('／');
    return `<div class="report-ship-info">${batch}預計：${esc(x.promised_ship_date || '—')}<br>實際：${esc(x.actual_ship_date)}<br>本批總箱數：<b>${boxes}</b>${logistics?`<br>物流：${logistics}`:''}${x.note?`<br>備註：${esc(x.note)}`:''}</div>`;
  }

  function renderDetailTable(rows){
    if(!rows.length) return '<div class="notice">目前沒有符合條件的商品。</div>';
    return `<div class="table-wrap"><table class="responsive-table report-detail-table">
      <thead><tr><th>訂單</th><th>商品</th><th>收貨人</th><th>原交期</th><th>狀態／超過天數</th><th>出貨資訊</th></tr></thead>
      <tbody>${rows.map(x => `<tr>
        <td data-label="訂單"><span class="report-detail-order">${esc(x.order_no)}</span><br><span class="muted">${esc(x.order_date || '')}</span></td>
        <td data-label="商品" class="report-detail-product"><b>${esc(x.product_code || '')}</b> ${esc(x.product_name || '')}${x.variant?`｜${esc(x.variant)}`:''}${x.quantity!=null?` × ${esc(x.quantity)}${esc(x.quantity_unit||'')}`:''}</td>
        <td data-label="收貨人">${esc(x.receiver || '—')}${x.receiver_phone?`<br><span class="muted">${esc(x.receiver_phone)}</span>`:''}</td>
        <td data-label="原交期">${esc(x.due_date || '—')}${x.lead_time_text?`<br><span class="muted">${esc(x.lead_time_text)}</span>`:''}</td>
        <td data-label="狀態／超過天數">${statusHtml(x)}</td>
        <td data-label="出貨資訊">${shipInfoHtml(x)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }

  async function openDrill(button){
    const vendorId = button.dataset.vendorId;
    const vendorCode = button.dataset.vendorCode;
    const vendorName = button.dataset.vendorName;
    const mode = button.dataset.reportDrill || 'pending';
    const panel = ensureDrillPanel();
    if(!panel || !vendorId) return;
    panel.classList.remove('hidden');
    $('reportDrillTitle').textContent = `${vendorCode} ${vendorName}｜${modeTitle(mode)}`;
    $('reportDrillSubtitle').textContent = '點選不同分類可快速查看未出貨、逾期、即將到期與已出貨商品明細。';
    $('reportDrillContent').innerHTML = '<div class="muted">載入商品明細中…</div>';
    $('reportDrillFilters').innerHTML = ['pending','overdue','due_soon','shipped'].map(m => `<button type="button" class="btn ghost report-drill-filter ${m===mode?'active':''}" data-panel-mode="${m}" data-vendor-id="${esc(vendorId)}" data-vendor-code="${esc(vendorCode)}" data-vendor-name="${esc(vendorName)}">${modeTitle(m)}</button>`).join('');
    try {
      const rows = await rest(`vendor_product_shipping_detail?select=*&vendor_id=eq.${encodeURIComponent(vendorId)}&order=order_no.asc,sort_order.asc`);
      const filtered = filterDetails(rows || [], mode);
      $('reportDrillTitle').textContent = `${vendorCode} ${vendorName}｜${modeTitle(mode)}（${filtered.length} 項）`;
      $('reportDrillContent').innerHTML = renderDetailTable(filtered);
      panel.scrollIntoView({behavior:'smooth', block:'start'});
    } catch(e){
      $('reportDrillContent').innerHTML = `<div class="message error">明細載入失敗：${esc(e.message)}</div>`;
    }
  }

  async function render(){
    if(!['admin','employee'].includes(role())) return;
    injectStyles();
    ensureDrillPanel();
    try {
      const [s,m] = await Promise.all([
        rest('vendor_shipping_summary?select=*&order=vendor_code.asc'),
        rest('monthly_shipping_summary?select=*&order=month.desc,vendor_code.asc')
      ]);
      header('vendorReportRows','已出貨');
      header('monthlyReportRows','已出貨');

      if($('vendorReportRows')) $('vendorReportRows').innerHTML = (s || []).map(x => `<tr data-report-vendor="${esc(x.vendor_id)}">
        <td>${drillButton(`${esc(x.vendor_code)} ${esc(x.vendor_name)}`, x.total_orders, x.vendor_id, x.vendor_code, x.vendor_name, 'pending')}</td>
        <td>${Number(x.total_orders||0)}</td>
        <td>${drillButton(String(Number(x.open_orders||0)), x.open_orders, x.vendor_id, x.vendor_code, x.vendor_name, 'pending')}</td>
        <td class="${Number(x.overdue_orders)>0?'kpi-bad':''}">${drillButton(String(Number(x.overdue_orders||0)), x.overdue_orders, x.vendor_id, x.vendor_code, x.vendor_name, 'overdue','is-danger')}</td>
        <td class="${Number(x.due_soon_orders)>0?'kpi-warn':''}">${drillButton(String(Number(x.due_soon_orders||0)), x.due_soon_orders, x.vendor_id, x.vendor_code, x.vendor_name, 'due_soon','is-warn')}</td>
        <td>${drillButton(String(Number(x.shipped_orders||0)), x.shipped_orders, x.vendor_id, x.vendor_code, x.vendor_name, 'shipped','is-shipped')}</td>
        <td>${drillButton(`${Number(x.shipped_boxes||0)} 箱`, x.shipped_boxes, x.vendor_id, x.vendor_code, x.vendor_name, 'shipped','is-shipped')}</td>
        <td class="${Number(x.on_time_rate)>=90?'kpi-good':''}">${x.on_time_rate==null?'—':`${x.on_time_rate}%`}</td>
        <td>${x.avg_delay_days==null?'—':`${x.avg_delay_days} 天`}</td>
      </tr>`).join('') || '<tr><td colspan="9">尚無資料</td></tr>';

      if($('monthlyReportRows')) $('monthlyReportRows').innerHTML = (m || []).map(x => `<tr>
        <td>${esc(x.month)}</td><td>${esc(x.vendor_code)} ${esc(x.vendor_name)}</td><td>${Number(x.orders||0)}</td><td>${Number(x.shipped||0)}</td><td><b>${Number(x.shipped_boxes||0)} 箱</b></td><td>${Number(x.pending||0)}</td><td>${Number(x.on_time||0)}</td><td class="${Number(x.late)>0?'kpi-bad':''}">${Number(x.late||0)}</td><td>${x.on_time_rate==null?'—':`${x.on_time_rate}%`}</td>
      </tr>`).join('') || '<tr><td colspan="9">尚無資料</td></tr>';
    } catch(e){ console.warn('shipping report enhancement failed', e.message); }
  }

  window.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    document.addEventListener('click', e => {
      if(e.target.closest?.('.tab[data-tab="report"]')){
        setTimeout(render,250); setTimeout(render,700);
        return;
      }
      const drill = e.target.closest?.('[data-report-drill]');
      if(drill){ openDrill(drill); return; }
      const filter = e.target.closest?.('[data-panel-mode]');
      if(filter){
        openDrill({dataset:{reportDrill:filter.dataset.panelMode,vendorId:filter.dataset.vendorId,vendorCode:filter.dataset.vendorCode,vendorName:filter.dataset.vendorName}});
        return;
      }
      if(e.target.closest?.('#closeReportDrill')) $('vendorReportDrilldown')?.classList.add('hidden');
    });
  });
})();
