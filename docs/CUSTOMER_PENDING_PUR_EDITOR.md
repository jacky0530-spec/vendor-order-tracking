# V2.84｜客戶修改待審核採購單（PUR）交接文件

更新日期：2026-11-26

## 需求與介面
在「客戶採購中心 → 我的採購」展開「等待確認」狀態的 PUR 後，顯示「修改訂購單（尚未審核）」。

客戶可修改：
- 原訂購商品的規格及數量（規格目前可購買才允許調整；已下架商品可減量或移除）
- 新增可購買的商品（含規格）、移除商品
- 收貨資料：選擇自己的既有地址或本次填寫收件人／電話／地址
- 備註
- 前端顯示預估金額，**最終總價由資料庫核算**，不接受前端提供單價

已審核（approved）或退回（rejected）的 PUR 不會顯示修改按鈕；後端再次檢查 status 與 customer_id，不可靠前端判斷代替授權。

## 主要程式

- `catalog-v231.js`
  - `renderPurchases()`：待審核採購單展開後出現修改按鈕
  - `openCustomerPurchaseEditor(requestId)`：讀取最新的採購單與明細、客戶地址、可購買商品、規格，提供編輯彈窗
  - 儲存呼叫 `rpc('catalog_customer_update_pending_purchase', {...})`
  - 儲存成功刷新「我的採購」；若提交前已被審核，顯示 DB 錯誤
- `catalog-v230.css`：`#catPurchaseEditModal` 的電腦、平板及手機響應式樣式
- `index.html`：V2.84，`build=284-pending-purchase-edit` 破除舊版快取
- `admin-tools-v228.js`：版本標籤 V2.84

## Supabase
專案 `qibeuakrryqjaiwbcorg`，migration:
- `catalog_customer_edit_pending_purchase_20261126`
- `catalog_customer_edit_fix_ambiguous_product_alias_20261126`

RPC `public.catalog_customer_update_pending_purchase(`
`p_request_id uuid, p_lines jsonb, p_customer_address_id uuid,`
`p_receiver text, p_phone text, p_address text, p_note text)`

`p_lines` 為完整欲保留的明細清單，每筆含：
```json
[
  {
    "id": "既有採購明細UUID；新商品為null",
    "product_id": "商品UUID",
    "variant_id": "規格UUID或null",
    "quantity": 2
  }
]
```

### RPC 安全與交易
- 依 `catalog_current_customer_id()` 取得已登入客戶；拒絕管理員／其他客戶及匿名使用者
- 鎖住 `customer_purchase_requests` 的指定列：`FOR UPDATE`；必須 `customer_id` 相符且 `status='pending'`
- 同一交易內依 `p_lines` 更新原明細、插入新增明細、刪除未保留明細，最後重新計算 `total` 與更新收件資訊。任何例外會回滾，不會產生部分更新
- 只有本客戶的啟用中收件資料能被指定
- 不接受前端自行指定價格、出貨廠商或總額；既有同規格只改數量時保留原單價，新商品或更換規格由 Supabase 重新估價
- 新增、換規格或增量時檢查商品上架／期限／可見權限、廠商狀態、規格、最低量
- 重新檢查客戶等級最低結帳總額、商品總量上限；最少保留 1 個品項；同商品同規格不可重複
- RPC 只授權 `authenticated`，撤銷 `PUBLIC`／`anon` 執行權限。函式使用 `SECURITY DEFINER`，內部必須保留明確的使用者及歸屬檢查。
- 審核時原有 `catalog_review_purchase` 也鎖住採購單，所以併發審核與修改不會同時寫入同一採購單

## 測試完成
- 對原 PUR 原樣儲存、重新核算：成功
- 在交易內移除一筆舊商品、重新計算：成功
- 交易中暫時調整 5812 上架日期並新增規格商品：成功
- 已核准 PUR 呼叫編輯 RPC：正確拒絕
- 管理員冒用客戶編輯入口：正確拒絕
- 使用 `BEGIN...ROLLBACK` 測試，正式採購單及商品上架時間沒有被修改
- JavaScript 語法、UI 入口、版本與 CSS 引用檢查通過

## 後續整合測試
**尚未完成登入實際客戶帳號的瀏覽器端整合測試。**
請在正式站驗證：選擇一張待審核 PUR → 新增/移除品項 → 改規格/數量 → 改收件資料/備註 → 儲存後重新整理 → 管理員看到相同資料；再檢查核准後客戶無法再次修改。
