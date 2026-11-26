# 宜羿 B2B 商城 V2.89｜浮動新增商品與客戶數字直接輸入

更新日期：2026-11-26

## 使用需求
1. 管理端「批發商城 → 商品管理」的 `＋新增商品` 要固定在畫面右上方，滑動長清單時不必回到頁首。
2. 客戶端訂購商品的數量欄位（商品詳細視窗、待審核 PUR 採購單修改）要採與 V2.87 管理商品數字一致的直覺操作：點入全選舊值、直接輸入新值，iPad 可開數字鍵盤。

## 程式與行為
- `catalog-v231.js`
  - `ensureAdminTab()`：`#tab-catalog` 初始帶 `cat-products-active`；切換商品管理／其他子頁籤時切換 class。
  - `positionFloatingAddButton()`：讀取 `header.topbar` 的高度，設定 `--cat-float-top`。ResizeObserver 和 window resize 處理導航列高度變化。
  - 新增商品仍呼叫原 `openProductEditor(null)`，不改建立商品及儲存流程。
  - `openStoreDetail()`：`setupProductNumericInputs($('catStoreDetail'))` 適用 `catBuyQty`，按「加入購物車」先呼叫 `validateProductNumericInput`；空白、錯誤格式或低於最低量不送出 RPC。
  - 當 `catBuyVariant` 改變時，更新 `catBuyQty.dataset.catNumericMin` 和 DOM 的 min 屬性，保持規格最低量驗證一致。
  - `openCustomerPurchaseEditor()` 的 `renderRows()`：每次重繪數量輸入框都初始化全選與數字鍵盤；`oninput` 更新預估金額；按儲存前從目前輸入框再次解析與驗證，避免空白變為 0 或文字轉成 NaN。
  - 使用 V2.87 已有 `setupProductNumericInputs`、`normalizeProductNumberText`、`validateProductNumericInput`，支援全形數字、千分位、合法小數輸入。
- `catalog-v230.css`：
  - `#tab-catalog #catNewProduct` position:fixed、右上、z-index:100、陰影；modal z-index 150000，避免蓋住編輯視窗。
  - 當 `#tab-catalog` / `#adminView` hidden，或非 `cat-products-active` 時，浮動按鈕隱藏。
  - `#catStoreModal`、`#catPurchaseEditModal` 的數字輸入欄位加入手機適用的字級、觸控高度、焦點及錯誤樣式。
- `index.html` 更新標題、頁尾至 V2.89，JS/CSS build=`289-floating-add-direct-qty`。
- `admin-tools-v228.js` 版本標籤 V2.89。

## 範圍與限制
- **無 Supabase schema 或 RPC 修改**，原本的購物車和 PUR 待審核修改 RPC 仍是最後授權與限量驗證。
- 購物車「清單頁」本來只有數量顯示，沒有數量編輯欄位；本次沒有額外建立新的購物車數量修改 API。
- 客戶的電話、地址等文字欄位不應改成可全選數字輸入框。
- 保留客戶品項規格、最低數量、金額估算、下單權限等原規則。

## 驗證
- 使用最新 main 的 `catalog-v231.js` 進行 JavaScript 語法測試。
- 驗證空白、負數、文字、低於最低量被拒絕，合法小數、全形數字、千分位可辨識。
- 確認兩個客戶訂購視窗已接上數字初始化與儲存前驗證。
- 確認浮動按鈕在其他管理子頁籤、其他頂層頁籤隱藏；確認系統版本與快取參數。
- **尚未使用正式登入帳號在 PC/iPad Safari 執行拖動捲動及實際下單整合測試。**
