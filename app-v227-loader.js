(() => {
  'use strict';

  const frame = document.getElementById('appFrame');
  const boot = document.getElementById('bootView');
  const msg = document.getElementById('bootMsg');
  const stamp = '227';

  function fail(err) {
    if (msg) msg.textContent = `載入失敗：${err?.message || err}，請重新整理一次。`;
  }

  async function fetchLatest() {
    const sources = [
      `https://raw.githubusercontent.com/jacky0530-spec/vendor-order-tracking/main/index.html?build=${stamp}&t=${Date.now()}`,
      `./index.html?build=${stamp}&t=${Date.now()}`
    ];
    let lastErr = null;
    for (const url of sources) {
      try {
        const r = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const text = await r.text();
        if (text.includes('id="loginBtn"')) return text;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('無法取得最新版頁面');
  }

  function rewrite(html) {
    // 全部靜態資源使用同一個 build key，避免舊快取。
    html = html.replace(/(\.css|\.js)\?[^"']+/g, `$1?build=${stamp}`);
    html = html.replace(`./login-fix.js?build=${stamp}`, `./login-fix-2252.js?build=${stamp}`);
    html = html.replace(`./version-authority.js?build=${stamp}`, `./version-authority-227.js?build=${stamp}`);
    html = html.replace(/Vendor Order Tracking V2\.\d+/g, 'Vendor Order Tracking V2.27');
    html = html.replace('</body>', `<script src="./stable-order-editor-v227.js?build=${stamp}"></` + `script></body>`);
    return html;
  }

  async function start() {
    try {
      const html = rewrite(await fetchLatest());
      frame.addEventListener('load', () => {
        boot.hidden = true;
        frame.hidden = false;
      }, { once: true });
      frame.srcdoc = html;
    } catch (e) {
      fail(e);
    }
  }

  start();
})();
