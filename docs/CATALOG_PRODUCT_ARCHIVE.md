# 商品刪除（可還原）開發備註 — V2.80

## 目的
在「批發商城 → 商品管理」提供刪除與還原。這是**軟刪除**，不是 SQL DELETE：既有 ORD、PUR、規格、價格、圖片、歷史交易資料均保留。

## 位置
- 前端：`catalog-v231.js` → `renderAdminProducts(view)`
- 靜態入口：`index.html`，務必更新 `catalog-v231.js?build=...` 防快取
- 顯示版本：`admin-tools-v228.js` 的 `VERSION`
- 資料庫：Supabase 專案 `qibeuakrryqjaiwbcorg` 的 `public.catalog_products`
- 資料庫 migration：`catalog_reversible_product_archive_20261126`（已部署 2026-11-26）

## 新增欄位
```sql
ALTER TABLE public.catalog_products
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;
```
另有資料庫 constraint：`catalog_products_archive_visibility_ck`，禁止已封存商品處於啟用或上架狀態。

## RPC
`public.catalog_archive_product(p_product_id uuid, p_restore boolean DEFAULT false)`

- `p_restore=false`：要求 `catalog_is_manager()`；鎖住商品列；`archived_at=now()`、`archived_by=auth.uid()`、`active=false`、`published=false`
- `p_restore=true`：清空 archive 欄位；`active=true`、`published=false`，**還原為未上架草稿，不自動重新銷售**
- RPC 僅授予 `authenticated` EXECUTE，並撤銷 `anon`、`PUBLIC` 執行權限；執行時仍檢查現行 manager/employee 權限。
- 回傳 JSONB，含 `ok`、`state`、`product_code`；連續執行同一操作採冪等回應。

## UI
- 一般商品卡片：「編輯」＋「刪除」
- 已刪除商品：「還原為草稿」
- 篩選新增「一般商品／已刪除（數量）」
- 刪除前二次確認，明確說明歷史紀錄保留。
- 透過 `rpc('catalog_archive_product',{p_product_id:id,p_restore:false})` 執行；完成後重載商品清單。
- 保留圖片及規格的資料列與 Storage 物件；**不要**呼叫圖片刪除邏輯。
- 購物車若先前有商品，結帳時既有後端校驗 `active`／`published` 會阻止下架商品完成結帳；應讓客戶移除該品項。

## 注意事項
- 不要用 `DELETE FROM catalog_products` 代替軟刪除：商品可能被 `order_items`、`customer_purchase_request_items`、`catalog_variants` 等引用。
- 請勿清除歷史訂單或採購單以便刪除商品。
- 不要將「已停用」當作「已刪除」；以 `archived_at IS NOT NULL` 為準。
- Supabase `catalog_storefront` view 仍可包含產品列，但客戶可見性/購買檢核依 `active` 與 `published` 篩選；請維持軟刪除時兩者為 false。
- 後續修改此功能應同步更新 GitHub、資料庫變更記錄與入口版本參數。

## 測試
已確認前端 JavaScript 可被編譯解析；資料庫欄位、RPC、角色 EXECUTE 權限存在；以單一商品進行交易式刪除／還原檢查後 ROLLBACK，資料庫 4 筆商品維持不變。

正式 GitHub Pages 的使用者端實際操作仍需在已登入管理員的瀏覽器驗證。

## V2.85 客戶端顯示過濾修正（2026-11-26）
### 問題
V2.84 的 `catalog_storefront` 檢視未限定 `active`、`published`、`archived_at`，且客戶端 `paintStore` 沒有二次過濾，造成已刪除商品 9331、9605 仍在客戶商品清單；9126-02 雖尚未上架也被顯示。

### 修正
- Supabase migration：`catalog_storefront_hide_archived_unpublished_products_20261126`
- `catalog_storefront` 加入 `WHERE p.active IS TRUE AND p.published IS TRUE AND p.archived_at IS NULL AND public.catalog_can_view_product(p.id)`
- 客戶 `catalog-v231.js`：`loadStorefront()` 的 API 查詢加上 `active=eq.true&published=eq.true`，載入後、`paintStore()`、`openStoreDetail()` 三處增加保護。
- `index.html`、`admin-tools-v228.js` 更新至 V2.85，快取參數 `285-hide-archived-products`
- `sale_end_at` 已截止但仍上架之商品，仍可顯示但不可加入購物車；沒有因為結單而自動封存。

### 驗證
- Supabase 客戶身分查詢 `catalog_storefront`，修正後僅 1 件符合顯示條件，未上架／停用 0 件。
- GitHub V2.85 `catalog-v231.js` JavaScript 語法檢查通過。
- 已刪除商品不再透過客戶商城檢視讀取；歷史採購單及還原流程維持不變。
- 正式 iPad Safari 使用者端重新載入及手動測試尚未驗證。
