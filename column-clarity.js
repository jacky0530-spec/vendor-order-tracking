(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function injectStyles(){
    if ($('columnClarityStyles')) return;
    const st = document.createElement('style');
    st.id = 'columnClarityStyles';
    st.textContent = `
      .clarity-product-line{display:grid!important;grid-template-columns:104px minmax(180px,1fr);gap:8px;align-items:start;padding:5px 0;margin:0!important}
      .clarity-product-line+.clarity-product-line{border-top:1px dashed #e4e7ec}
      .clarity-field{display:flex;flex-direction:column;gap:2px;min-width:0}
      .clarity-label{font-size:10px;line-height:1.2;color:#667085;font-weight:700;white-space:nowrap}
      .clarity-code{display:inline-flex;width:max-content;max-width:100%;align-items:center;border-radius:6px;padding:2px 7px;font-weight:800;line-height:1.4;white-space:nowrap}
      .clarity-code.product{background:#ecfdf3;color:#067647;border:1px solid #abefc6}
      .clarity-code.vendor{background:#eff8ff;color:#175cd3;border:1px solid #b2ddff}
      .clarity-name{font-weight:650;color:#18212f;line-height:1.45;word-break:break-word}
      .clarity-vendor{display:grid;gap:7px;min-width:120px}
      #orderRows th.product-col-head,#orderRows th.vendor-col-head{white-space:normal}
      @media(max-width:760px){
        .clarity-product-line{grid-template-columns:1fr!important;gap:5px;padding:8px 0}
        .clarity-field{display:grid;grid-template-columns:78px 1fr;align-items:start;gap:8px}
        .clarity-label{padding-top:4px}
        .clarity-vendor .clarity-field{grid-template-columns:78px 1fr}
      }
    `;
    document.head.appendChild(st);
  }

  function getColumnIndexes(table){
    const heads=[...table.querySelectorAll('thead th')];
    let product=-1, vendor=-1;
    heads.forEach((th,i)=>{
      const t=th.textContent.trim();
      if(t==='商品' || t==='商品編號／商品名稱') product=i;
      if(t==='廠商' || t==='廠商編號／廠商名稱') vendor=i;
    });
    return {heads,product,vendor};
  }

  function enhanceProductCell(td){
    if(!td || td.dataset.clarityProduct==='1') return;
    const lines=[...td.querySelectorAll('.product-line')];
    if(!lines.length) return;
    lines.forEach(line=>{
      const codeEl=line.querySelector('b');
      if(!codeEl) return;
      const code=codeEl.textContent.trim();
      const full=line.textContent.trim();
      const name=full.startsWith(code) ? full.slice(code.length).trim() : full.replace(code,'').trim();
      line.classList.add('clarity-product-line');
      line.innerHTML=`
        <span class="clarity-field">
          <span class="clarity-label">商品編號</span>
          <span class="clarity-code product">${esc(code)}</span>
        </span>
        <span class="clarity-field">
          <span class="clarity-label">商品名稱／規格／數量</span>
          <span class="clarity-name">${esc(name || '—')}</span>
        </span>`;
    });
    td.dataset.clarityProduct='1';
    td.dataset.label='商品編號／商品名稱';
  }

  function enhanceVendorCell(td){
    if(!td || td.dataset.clarityVendor==='1') return;
    const codeEl=td.querySelector('b');
    if(!codeEl) return;
    const code=codeEl.textContent.trim();
    if(!/^V\d+/i.test(code)) return;
    const full=td.textContent.replace(/\s+/g,' ').trim();
    const name=full.startsWith(code) ? full.slice(code.length).trim() : full.replace(code,'').trim();
    td.innerHTML=`<div class="clarity-vendor">
      <div class="clarity-field">
        <span class="clarity-label">廠商編號</span>
        <span class="clarity-code vendor">${esc(code)}</span>
      </div>
      <div class="clarity-field">
        <span class="clarity-label">廠商名稱</span>
        <span class="clarity-name">${esc(name || '—')}</span>
      </div>
    </div>`;
    td.dataset.clarityVendor='1';
    td.dataset.label='廠商編號／廠商名稱';
  }

  function scan(){
    injectStyles();
    const body=$('orderRows');
    const table=body?.closest('table');
    if(!body || !table) return;
    const {heads,product,vendor}=getColumnIndexes(table);
    if(product>=0){
      heads[product].textContent='商品編號／商品名稱';
      heads[product].classList.add('product-col-head');
    }
    if(vendor>=0){
      heads[vendor].textContent='廠商編號／廠商名稱';
      heads[vendor].classList.add('vendor-col-head');
    }
    [...body.querySelectorAll('tr')].forEach(row=>{
      if(product>=0) enhanceProductCell(row.children[product]);
      if(vendor>=0) enhanceVendorCell(row.children[vendor]);
    });
  }

  window.addEventListener('DOMContentLoaded',()=>{
    scan();
    setTimeout(scan,300);setTimeout(scan,900);setTimeout(scan,1600);
    const root=$('orderRows');
    if(root){
      let timer;
      new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(scan,25);}).observe(root,{childList:true,subtree:true});
    }
    $('loginBtn')?.addEventListener('click',()=>{setTimeout(scan,500);setTimeout(scan,1200);});
    $('reloadBtn')?.addEventListener('click',()=>setTimeout(scan,250));
  });
})();
