# 宜羿 B2B V2.95：系統版本顯示不同步修正

日期：2026-11-27

## 問題
- 管理員截圖的右上版本標籤仍顯示 V2.93，但 GitHub `main` 分支的 `index.html` 與 `admin-tools-v228.js` 已更新到 V2.94。
- 連接的瀏覽器頁籤中，既有網站內容的右上標籤及頁尾仍為 V2.93；瀏覽器的頁籤標題還有更早版號。這表示正在使用的頁籤尚未載入相符的新版資源。
- 無法直接經 API 取得用戶頁籤的 HTTP Cache-Control / CDN 詳細狀態，因此無法斷言一定是瀏覽器快取、Pages 發布延遲或服務工作者造成；不能僅靠修改 GitHub `main` 宣稱已在使用者已開頁面生效。

## V2.95 變更
- `admin-tools-v228.js`
  - 本機版號改為 `V2.95`。
  - `setVersion()` 會同時更新右上 `.system-version-chip`、文件 `document.title` 與 `footer`，不再留下舊頁籤標題。
  - 新增 `checkLatestVersion()`：初次載入時和重新切回頁籤時，使用 `fetch('./app-version.json?check=<timestamp>',{cache:'no-store'})` 查最新版本。
  - 現在載入的 JS 版號仍是 V2.94 而 manifest 是 V2.95 時，**不會假稱已載入 V2.95**，改顯示「系統版本 V2.94｜新版 V2.95（點擊更新）」。
  - 點擊新版提示會在網站網址加 `build` 和 `refresh` 參數，重新開啟當前頁面；保留原有的管理員登入及訂單資料流程。
  - 使用者也可以點右上版本標籤主動檢查更新；Enter / Space 可使用鍵盤操作。
  - 取得版本 manifest 失敗（離線、Pages CDN 尚未更新）時，維持真實已載入程式版號，不阻擋正常使用。
- `app-version.json`（新檔）: `{"version":"V2.95","build":"295-version-sync",...}`。
- `index.html`：標題、meta version、footer V2.95；`admin-tools-v228.js?build=295-version-sync` 更新快取參數。

## 驗證
- GitHub 三檔皆已提交 `main`，內容的 V2.95 顯示一致。
- 最新 `admin-tools-v228.js` 通過 JavaScript 語法測試。
- 使用模擬 DOM / fetch 測試：載入 V2.95 時標籤、頁籤標題、頁尾為 V2.95；載入 V2.94 且最新 manifest 為 V2.95 時會顯示更新提示，而不是錯誤顯示已更新；點擊後 URL 會加入 build 及 refresh；全部通過。
- **受限於工具，無法刷新用戶已開啟的頁籤，亦無法從公開頁面連線驗證 GitHub Pages CDN 是否已供應新版 HTML**。需使用者在網站頁面按 Ctrl+Shift+R（Windows）強制重新載入一次。
- 如重整仍舊版，需檢查 GitHub 專案 Settings → Pages 的發布來源與 GitHub Actions Pages 部署狀態；避免修改無關商品、訂單及 LINE 後端功能。

## 本次沒有修改的內容
- Supabase table / Edge Functions / LINE bot secrets / 訂單
- 商品管理、LINE 群組收合與商品推播表單操作
