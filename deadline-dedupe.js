(() => {
  'use strict';
  const id = 'deadlineDedupeStyle';
  if (document.getElementById(id)) return;
  const st = document.createElement('style');
  st.id = id;
  st.textContent = '.profile-item-deadline{display:none!important}';
  document.head.appendChild(st);
})();
