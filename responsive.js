(() => {
  'use strict';
  function labelTable(table){
    if(!table)return;
    table.classList.add('responsive-table');
    const heads=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim()||'選取');
    table.querySelectorAll('tbody tr').forEach(row=>{
      [...row.children].forEach((td,i)=>{
        if(td.tagName==='TD') td.dataset.label=heads[i]||'';
      });
    });
  }
  function scan(){document.querySelectorAll('.table-wrap table').forEach(labelTable)}
  window.addEventListener('DOMContentLoaded',()=>{
    scan();
    const root=document.querySelector('main')||document.body;
    new MutationObserver(()=>requestAnimationFrame(scan)).observe(root,{childList:true,subtree:true});
  });
})();
