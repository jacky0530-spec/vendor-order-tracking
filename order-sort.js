(() => {
  'use strict';

  const STORAGE_KEY = 'vendor_order_sort_direction';
  const $ = (id) => document.getElementById(id);
  let sorting = false;
  let observer = null;
  let timer = null;

  function getDirection() {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'desc' ? 'desc' : 'asc';
  }

  function alertRank(row) {
    if (row.querySelector('.badge.overdue')) return 0;
    if (row.querySelector('.badge.due_soon')) return 1;
    return 2;
  }

  function orderNumber(row) {
    const text = row.textContent || '';
    const m = text.match(/ORD-\s*0*(\d+)/i);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  }

  function sortRows() {
    const body = $('orderRows');
    if (!body || sorting) return;
    const rows = [...body.querySelectorAll(':scope > tr')];
    if (rows.length < 2) return;

    const dir = $('orderSort')?.value || getDirection();
    const originalIndex = new Map(rows.map((row, index) => [row, index]));

    rows.sort((a, b) => {
      const ar = alertRank(a);
      const br = alertRank(b);
      if (ar !== br) return ar - br;

      // 警示訂單維持系統原本的到期優先順序，只負責置頂。
      if (ar < 2) return (originalIndex.get(a) || 0) - (originalIndex.get(b) || 0);

      const an = orderNumber(a);
      const bn = orderNumber(b);
      if (an !== bn) return dir === 'desc' ? bn - an : an - bn;
      return (originalIndex.get(a) || 0) - (originalIndex.get(b) || 0);
    });

    sorting = true;
    const frag = document.createDocumentFragment();
    rows.forEach(row => frag.appendChild(row));
    body.appendChild(frag);
    sorting = false;
  }

  function scheduleSort() {
    clearTimeout(timer);
    timer = setTimeout(sortRows, 35);
  }

  function ensureControl() {
    const filters = document.querySelector('#tab-tracking .filters');
    if (!filters || $('orderSort')) return;

    const select = document.createElement('select');
    select.id = 'orderSort';
    select.setAttribute('aria-label', '訂單編號排序');
    select.innerHTML = `
      <option value="asc">訂單編號：小 → 大</option>
      <option value="desc">訂單編號：大 → 小</option>`;
    select.value = getDirection();

    const hideToggle = $('hideShippedToggle')?.closest('.filter-toggle');
    if (hideToggle && hideToggle.parentElement === filters) {
      filters.insertBefore(select, hideToggle);
    } else {
      filters.appendChild(select);
    }

    select.addEventListener('change', () => {
      localStorage.setItem(STORAGE_KEY, select.value === 'desc' ? 'desc' : 'asc');
      sortRows();
    });
  }

  function installObserver() {
    const body = $('orderRows');
    if (!body || observer) return;
    observer = new MutationObserver(() => {
      if (!sorting) scheduleSort();
    });
    observer.observe(body, { childList: true });
  }

  function install() {
    ensureControl();
    installObserver();
    scheduleSort();
  }

  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(install, 120);
    setTimeout(install, 500);
    setTimeout(install, 1200);
    $('loginBtn')?.addEventListener('click', () => {
      setTimeout(install, 350);
      setTimeout(install, 900);
    });
    ['searchInput','vendorFilter','alertFilter','hideShippedToggle'].forEach(id => {
      $(id)?.addEventListener('input', scheduleSort);
      $(id)?.addEventListener('change', scheduleSort);
    });
  });
})();
