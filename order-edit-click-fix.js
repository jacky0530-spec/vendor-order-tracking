(() => {
  'use strict';

  // V2.24：只保留緊湊版面樣式。
  // 編輯訂單事件由 employee-order-tools.js 單一處理，
  // 不再使用 setInterval / pointerdown 接管，避免反覆掃描與多套事件互相干擾。
  const st = document.createElement('style');
  st.id = 'stableCompactAdminStyles';
  st.textContent = `
    .topbar{position:sticky!important;top:0!important;z-index:10000!important}
    #adminView{padding-top:4px!important}
    #adminView .tabs{gap:6px!important;margin:2px 0 8px!important}
    #adminView .tabs .tab{padding:8px 14px!important;min-height:36px!important;font-size:14px!important}
    #tab-tracking .metrics{gap:10px!important;margin:0 0 10px!important}
    #tab-tracking .metric.card{padding:10px 15px!important;min-height:68px!important;border-radius:12px!important}
    #tab-tracking .metric span{font-size:11px!important;line-height:1.1!important}
    #tab-tracking .metric strong{font-size:27px!important;line-height:1!important;margin-top:4px!important}
    #tab-tracking .section-card{padding:12px 14px!important;border-radius:14px!important}
    #tab-tracking .section-head{margin-bottom:7px!important;gap:8px!important}
    #tab-tracking .section-head h2{font-size:18px!important;line-height:1.15!important;margin:0 0 2px!important}
    #tab-tracking .section-head .muted{font-size:10px!important;line-height:1.2!important;margin:0!important}
    #tab-tracking .section-head .btn{padding:7px 12px!important;min-height:34px!important}
    #tab-tracking .filters{gap:7px!important;margin:0 0 7px!important}
    #tab-tracking .filters input,#tab-tracking .filters select{min-height:36px!important;height:36px!important;padding-top:6px!important;padding-bottom:6px!important;font-size:13px!important}
    #tab-tracking .table-wrap{max-height:calc(100vh - 355px)!important;min-height:360px!important;overflow:auto!important;overscroll-behavior:contain!important}
    #tab-tracking .table-wrap thead th{position:sticky!important;top:0!important;z-index:30!important;background:#f8fafc!important;box-shadow:0 1px 0 #e4e7ec!important}
    #orderRows button[data-employee-edit]{pointer-events:auto!important;cursor:pointer!important;touch-action:manipulation!important}
    .system-version-chip{font-size:0!important}
    .system-version-chip::after{content:'系統版本 V2.24';font-size:10px!important}
    footer{font-size:0!important}
    footer::after{content:'Vendor Order Tracking V2.24';font-size:12px!important}
    @media(max-height:800px){#tab-tracking .table-wrap{max-height:calc(100vh - 320px)!important;min-height:300px!important}}
    @media(max-width:800px){
      #tab-tracking .metrics{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:6px!important}
      #tab-tracking .metric.card{min-height:58px!important;padding:8px 10px!important}
      #tab-tracking .metric strong{font-size:23px!important}
      #tab-tracking .table-wrap{max-height:calc(100vh - 385px)!important;min-height:300px!important}
    }
  `;
  document.getElementById(st.id)?.remove();
  document.head.appendChild(st);
})();
