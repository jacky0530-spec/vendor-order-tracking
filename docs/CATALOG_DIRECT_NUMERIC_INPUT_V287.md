# 宜羿 B2B 商城 V2.87：商品編輯數字欄位輸入體驗

更新：2026-11-26

## 需求
「批發商城 → 商品管理 → 新增／編輯商品」的價格、上限、最低量、等級價、客戶專屬價、規格加價等欄位，原本用瀏覽器 `type=number`，點進去常要手動刪除原數字或 0，iPad Safari 又不保證 `.select()` 支援原生 number 輸入。因此改為直接點入全選、輸入即可覆蓋既有值。

## 檔案與實作
- `catalog-v231.js`：
  - `setupProductNumericInputs(scope)`：只針對商品編輯器內的數字欄位，將 `type=number` 轉成 `type=text` 與 `inputmode=decimal`，確保 Safari 的全選可用，且不顯示上下調整數字箭頭。
  - 在 `focus` 自動全選，首次 `pointerup` 防止解除選取，後續可正常調整游標。
  - `validateProductNumericInputs(scope)`、`validateProductNumericInput(input)`：把原本的 `min`、`max`、`step` 保留於 data 屬性，儲存前驗證數字及邊界；金額 step=0.01 只允許到兩位小數。空白的選填價格／上限仍維持原有意義。
  - `normalizeProductNumberText(value)`：支援貼上千分位數字（例如 1,200.50）及全形數字、全形小數點。
  - `openProductEditor()` 初始化欄位，`renderVariantRows()` 及客戶專屬價的動態增加也重新套用。
  - `saveProduct()` 在寫入 Supabase 前檢查，無效的內容顯示錯誤、不儲存。
- `catalog-v230.css`：直接輸入欄位外觀、焦點和錯誤狀態、精簡說明文字。
- `admin-tools-v228.js`：畫面版號 V2.87。
- `index.html`：標題及頁尾版號 V2.87，JS/CSS 快取參數 `287-direct-numeric`。

## 原有資料規則不變
- 原本的價格、最低量和規格加價值不會自動被改動。
- 不動資料庫表、產品價格計算公式、日期欄位。
- 訂單、採購、客戶視角及出貨頁的數字欄位**不在此次修改範圍內**。
- `catPBase` 的 0 值允許，`catPMin` 的原本 min=0.01、總量上限的 min=1、規格的加價可為負值都維持。

## 檢查
- 以 GitHub 最新 `catalog-v231.js` 進行 JavaScript 語法檢查。
- 已使用 60、24.5、1,200.50、６０．５、0、空白以及無效字元與超精度的數值做解析單元測試。
- 檢查主要價格、動態規格及專屬價格欄位的初始化與儲存前驗證，以及 V2.87 版本和引用。
- **尚未在正式網站使用 iPad Safari 和管理者登入實際測試選取與儲存**。
