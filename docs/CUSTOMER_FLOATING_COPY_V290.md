# 宜羿 B2B 商城 V2.90｜客戶端懸浮複製商品文案

更新日期：2026-11-26

## 需求
客戶端「批發賣場 → 查看商品」的「複製商品文案」按鈕，原本位於商品文案旁，必須捲動才能按到；改為商品詳細視窗右上方的浮動固定操作，無論商品照片、規格及文案多長均可使用。全站管理／客戶頁的版本數字同步更新。

## 變更
- `catalog-v231.js`
  - `ensureStoreModal()` 的 `.catalog-modal-head` 新增 `#catCopyDescription` 按鈕，位於右側關閉按鈕旁；舊的文案區重複按鈕移除。
  - `#catCopyFeedback` 移到頂部，使用 `role=status` 與 `aria-live=polite`。
  - `openStoreDetail()` 保留原 Clipboard API / fallback 複製邏輯；切換商品重設按鈕與訊息。成功短暫顯示「✓ 已複製」，再還原「📋 複製商品文案」。
- `catalog-v230.css`
  - 客戶商品詳細視窗的頂部區設 `position:sticky;top:0;z-index:12`，捲動視窗內部仍固定在上方。
  - 複製按鈕位於頂部右側，採圓角、陰影，靠近關閉按鈕但不重疊；手機 / 平板微調字級與留白。
- `index.html`
  - HTML 標題與頁尾改 `V2.90`；相關三個 JS/CSS 引用改 `build=290-customer-copy-float` 破除瀏覽器快取。
- `admin-tools-v228.js` 系統版本常駐標籤改 `V2.90`。

## 不變事項
- 複製的文字仍為原商品 `description`，不改商品價格、規格、照片或訂購流程。
- 商品詳細頁的關閉按鈕、圖片選取／下載、數字欄位及加入購物車功能保留。
- 不修改 Supabase schema、RPC 或既有資料。

## 驗證
- 讀取最新 GitHub main 的四個檔案，`catalog-v231.js` 語法檢查通過。
- 檢查複製按鈕在視窗標題右側、只有一個按鈕、複製事件與狀態訊息存在、舊按鈕已移除、版號及快取參數一致。
- **尚未在登入狀態的正式網站或 iPad Safari 以真實操作驗證**。需在正式站測試：開啟長文案商品、向下捲動、按右上懸浮複製、貼到 LINE 驗證內容、關閉後開啟另一商品時按鈕重設。
