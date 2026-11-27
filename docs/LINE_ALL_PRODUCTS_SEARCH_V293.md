# 宜羿 B2B 商城 V2.93｜LINE 商品推播：搜尋並選取所有已上架可販售商品

日期：2026-11-27

## 需求
V2.92 的 LINE 商品推播只列出 `line_published_at IS NOT NULL` 的「新上架」商品，導致已上架舊商品（例：2514 保暖襪）找不到，無法合成 DM。

V2.93 改為可選擇 **任何當前已上架、已啟用、公開販售且可購買的商品**，不必先下架再上架；增加商品編號及商品名稱的搜尋；單張 DM 仍最多 6 件。保留 DM Canvas 合成、原圖 PNG + LINE JPEG 預覽、群組權限、台灣時間排程、發送歷史、重送鍵與排程取消功能。

## 前端修改
- `catalog-line-dm-v291.js`
  - `readyProduct(p,at)`：移除 `p.line_published_at!=null` 條件；仍要求 `active`、`published`、未封存、`visibility_mode==='all'`，開始日期已到、結單日期未過。
  - `reload()`：商品查詢改以 `updated_at.desc,id.desc` 排序並保留 `line_announced_at`（可顯示已曾推播），不再限定 `line_published_at`。
  - `apiPaged()`：逐頁抓取，每頁 500 筆，避免原 `limit=250` 截斷商品；圖片也同樣分頁。
  - `renderProducts()`：新增搜尋商品編號／名稱；字串轉 NFKC 後不分大小寫搜尋。結果顯示「目前可販售 N 件｜搜尋符合 M 件」。搜尋時保留已選的商品，未出現在搜尋結果中的已選商品仍維持選取。
  - 加上「清除已選」按鈕，勾選修改後隱藏舊的 DM 預覽，避免誤以為預覽仍反映最新選取。
  - 超過 6 件顯示提示並拒絕勾選第 7 件。未上傳照片的商品仍在列表顯示，但提醒不可合成 DM。
  - 客戶端與原商品管理、價格顯示、採購單和訂單資料不受影響。
  - 前端仍會在建立排程時，檢查商品於預定發送時間是否有效。
- `catalog-v230.css`：搜尋列、搜尋框、清除已選按鈕的桌面與手機響應式 CSS。
- `catalog-v231.js`：管理選單文案從「LINE 新品推播」改為「LINE 商品推播」。
- `admin-tools-v228.js`、`index.html`：統一 V2.93；相關腳本及樣式更新 `?build=293-line-all-products-search`，避免快取影響。

## 後端調整（均已執行）
- Supabase migration：`catalog_line_allow_existing_on_sale_products_v293`
- GitHub SQL：`supabase/migrations/20261127_catalog_line_allow_existing_products_v293.sql`
- `public.catalog_line_schedule_push(uuid,uuid[],timestamptz,text,text,text,text)`
  - 取消商品必須有 `line_published_at` 標記的限制。
  - 仍要求公開販售、未下架／未封存、**目前**可購買，且於**預定發送時間**也可購買。
  - 不變：有效群組、管理員權限、商品無重複且最多 6 件、DM PNG 與 JPEG 檔名驗證、固定商城 https URL。
  - 不修改商品原始 `published`、`active`、`sale_start_at`、`sale_end_at`、價格、歷史訂單。
- `supabase/functions/catalog-line-dispatch/index.ts` 已部署新版（Edge Function V6）
  - `isAvailable()` 移除 `line_published_at!=null`。
  - 發送時再次檢查商品仍在販售，且代碼、名稱與批發價沒有變化；不再阻擋舊商品。
  - LINE 通道仍只使用 `LINE_CATALOG_CHANNEL_ACCESS_TOKEN`；既有 LINE 訂單機器人完全不更動。
  - LINE 圖片＋文字兩則訊息、X-Line-Retry-Key、失敗紀錄維持原本機制。

## 使用方式
1. 登入 https://jacky0530-spec.github.io/vendor-order-tracking/?build=293-line-all-products-search
2. 選「批發商城 → LINE 商品推播」。
3. 在「選擇已上架商品」的搜尋框輸入編號（例 `2514`）或名稱，勾選商品；可搜尋下一組並勾選，總數至多 6 件。
4. 「預覽合成 DM」確認圖片；選擇已啟用 LINE 群組、發送時間（台灣時間）、訊息文字。
5. 點「建立 LINE 發送排程」；發送時間前可取消，送出結果可在歷史紀錄查看。

## 驗證
- 實際商品 2514：`published=true`、`active=true`、`archived_at=null`、`visibility_mode=all`、開賣時間有效；`line_published_at=null`。有 7 張商品圖片，符合本次新規則。
- 使用正式 Supabase 但 **SQL BEGIN / ROLLBACK 測試**：管理員可將商品 2514 建立排程，已封存 9331 / 已結單 5812 均遭拒絕；7 件超過上限遭拒絕。客戶 JWT 無法建立排程。
- 原有群組「宜羿新品」已確認 connected=true、active=true，但未真的發送訊息；測試後沒有多出正式排程。
- 最新 GitHub JavaScript 語法檢查；搜尋商品編號 2514 可找到舊商品；已選商品在更改搜尋關鍵字後仍保留；網頁版號和快取引用檢查通過。
- 原功能保留，但 **尚未以管理者帳號在正式網頁上實測實際操作、DM Canvas 圖片合成與 LINE 群組送達**，需要手動端對端確認。

## 邊界條件
- 僅對所有客戶可見的公開販售商品；`visibility_mode != 'all'` 不出現在群組推播清單，避免向群組公開特定客戶商品。
- 已結單、未開賣、已停用、已封存商品不能選或建立排程。
- 曾推播過的商品仍可再次選取，`line_announced_at` 僅提供提示。
- 商品沒有首圖，無法合成 DM，請先至商品管理補上照片。
- 在建立排程後到發送前，若商品被下架、結單或更改商品名稱／批發價，發送器會拒絕發送過期 DM 並記錄失敗原因。
