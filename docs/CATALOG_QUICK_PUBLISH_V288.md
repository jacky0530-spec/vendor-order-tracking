# 宜羿 B2B V2.88｜商品卡片快速上架／下架

更新日期：2026-11-26

## 需求
在「批發商城 → 商品管理」直接點商品卡片即可上架或下架，不必進入編輯商品視窗。原本商品編輯視窗的「立即上架」勾選仍保留，且與外層按鈕共用資料庫欄位 published / active。

## 操作規則
- 草稿、未上架：商品卡片顯示「立即上架」。
- 正常已上架商品：商品卡片顯示「下架商品」。
- 已結單但 published=true：顯示「重新上架」。如結單時間已過，確認後會清除舊結單日期。
- 已設定未來開賣：顯示「立即上架」。確認後會把未來開賣時間改為現在。
- 已刪除 archived_at 不為 null 的商品：不顯示快速上架，可從「已刪除」還原為草稿。
- 上架時確保 active=true, published=true；下架時只更新 published=false，避免變更商品啟用及其他欄位。
- 成功後重新載入商品清單，盡量保留當前搜尋與篩選。
- 不修改價格、圖片、規格、客戶權限、歷史訂單、採購單。

## 程式
- `catalog-v231.js`：`renderAdminProducts(view)` 商品卡片按鈕 `data-cat-quick-publish` 與事件處理。
- `catalog-v230.css`：`cat-quick-publish-row`、`cat-publish-on`、`cat-publish-off`。
- `admin-tools-v228.js`：V2.88 顯示版本。
- `index.html`：V2.88 標題／頁尾與 JS/CSS cache build=288-quick-publish。
- Supabase RPC：`public.catalog_quick_set_publication(p_product_id uuid,p_publish boolean,p_override_schedule boolean DEFAULT false)`。
  - SECURITY INVOKER，使用原本 `catalog_products` 的 manager RLS。
  - 確認 `auth.uid()` 非 null 並符合 `public.catalog_is_manager()`。
  - 使用 `FOR UPDATE` 鎖住商品，防止並發上架操作覆蓋。
  - 防止 archived 商品直接上架；檢查產品編號、名稱、有效廠商及批發價。
  - 若排程衝突且尚未同意 override，回傳 `{ok:false,reason:"schedule_conflict"}`，不修改資料。
  - 同意 override 再呼叫一次，以調整未來開始日期或過期結單日期。
  - `anon` 無 RPC EXECUTE 權限，`authenticated` 擁有 EXECUTE，但仍由函式及 RLS 判斷是否管理員。

## 驗證
1. Supabase 以完整管理員 JWT 身分，在 BEGIN/ROLLBACK 交易中測試：草稿上架、下架、結單排程提醒、覆蓋排程、封存商品拒絕上架，全部通過。
2. 模擬客戶 JWT，呼叫 RPC 預期拒絕，通過。
3. 確認 anon 無 EXECUTE，authenticated 有 EXECUTE， SECURITY INVOKER。
4. 檢查交易回滾後原商品 2514、5812、9126-02、9331 的狀態沒有變化。
5. JavaScript 語法、外層卡片按鈕、狀態分支、UI 版本及快取引用檢查通過。
6. **仍需管理者登入正式 GitHub Pages 進行真實瀏覽器點擊及 iPad 操作測試。**
