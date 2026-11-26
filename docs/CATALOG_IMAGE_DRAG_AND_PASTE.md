# 批發商城商品圖片拖曳、LINE 貼上 — V2.82

## 前端檔案
- `catalog-v231.js`：`openProductEditor`、`bindProductImageInput`、`addPendingProductImages`、`productImageFromDragHtml`、`handleProductImagePaste`、`saveProduct`、`uploadImage`
- `catalog-v230.css`：`cat-image-dropzone`、`cat-pending-image-grid` 樣式
- `index.html`：V2.82 版本與 `build=282-line-photo-drop` 快取更新
- `admin-tools-v228.js`：版本標籤 V2.82

## 功能
管理者/員工在「批發商城 → 商品管理 → 新增／編輯商品 → 商品圖片」：
1. 點選選擇圖片（可多檔）；
2. 從桌面檔案總管或電腦版 LINE 群組將圖片**拖曳到上傳區**；
3. 若 LINE 提供的是拖曳 HTML 圖片或直接圖片 URL，嘗試由瀏覽器取得圖片，僅允許 JPG/PNG/WEBP/GIF，最多 20MB；
4. 若拖曳來源不提供瀏覽器可讀取的圖片（例如 file://、跨來源 CORS 阻擋），請將圖片複製後在商品編輯器按 Ctrl+V 貼上，或下載到電腦後拖入；
5. 貼上事件僅在商品編輯器顯示時攔截**圖片檔**，一般文字貼上保持原有操作。

## 待上傳狀態
- 選取、拖入、貼上後先加入 `pendingProductImages`，透過 Object URL 即時預覽。
- 每張可按「移除」；未按「儲存商品」前，不會寫入 Supabase。
- 儲存時依序呼叫原 `uploadImage` 將圖片寫入 `catalog-images` storage + `catalog_product_images` 資料表，成功一張就從待上傳清單移除，降低儲存失敗重試造成的重複上傳。
- 修改商品不動既有圖片；既有「原圖」、「刪除」仍照舊。
- 原本每張 20MB 限制維持，待上傳最多 80 張。
- 若新增商品已成功建檔而後續上傳失敗，保存 `state.currentProduct.id`，再次儲存時不會重新新增一筆商品。

## 安全與限制
- 僅允許 image/jpeg、image/png、image/webp、image/gif 或相應副檔名。
- 外部 HTML/URL 來源需要使用者主動拖曳，取圖使用 `fetch(..., {mode:'cors',credentials:'omit'})`；瀏覽器跨來源政策不可繞過。
- 不支援直接讀取其他桌面軟體未交出來的本機路徑（如 `file://`），不能保證所有 LINE 版本都能直接拖入，請以複製貼上作備援。
- 前端須保留登入與 RLS 管理權限；請勿在 GitHub 前端加入 Supabase Service Role 密鑰。

## 測試
- GitHub 已提交 V2.82；對 `catalog-v231.js` 進行 JavaScript 語法檢查。
- 已檢查拖曳、檔案選擇、貼上、待上傳、移除、儲存 loop 與版本快取欄位。
- **尚待實際登入網站**用 Windows 電腦版 LINE、Chrome/Edge 測試圖片拖入，以及 Supabase Storage 寫入與重新整理後圖片顯示。
