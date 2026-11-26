# 宜羿 B2B 批發商城 V2.91｜LINE 新品合成 DM 排程推播

更新：2026-11-26

## 功能目標與範圍
管理員在「批發商城 → LINE 新品推播」選擇 1～6 件已上架新商品，
由瀏覽器合成單張 DM（商品首圖、商品編號、名稱、一般批發價），
設定私人 LINE 群組與台灣時間（UTC+8），後端定時發送：
1. 一則圖片訊息（完整 DM，另帶 LINE 小尺寸預覽圖）
2. 一則純文字訊息（說明、商品名稱及可點擊的商城 URL）

使用固定商城網址：
https://jacky0530-spec.github.io/vendor-order-tracking/

**此版本不操作 LINE 記事本、不修改訂單／採購單邏輯，也不自動發送任何舊商品。**

## 既有架構
- GitHub：`jacky0530-spec/vendor-order-tracking`，GitHub Pages 靜態網站。
- Supabase 專案：`qibeuakrryqjaiwbcorg`。
- LINE 官方機器人沿用現有 `line-webhook` 頻道與環境變數 `LINE_CHANNEL_ACCESS_TOKEN`。
- LINE 已有的訂單 Webhook 及 `line-worker` 保留，不新建第二個競爭的 Webhook URL。
- Supabase Cron（pg_cron、pg_net）每分鐘喚醒新的 Edge Function。

## GitHub 修改清單
- `catalog-v231.js`：管理導覽新增「LINE 新品推播」，僅 manager/employee 可見。
- `catalog-line-dm-v291.js`：獨立管理模組，讀取已標記的新商品、LINE 群組及近期排程；Canvas 生成完整 PNG DM 及小尺寸 JPEG 預覽；管理者排程、取消及查詢歷史。
- `catalog-v230.css`：管理頁、選品、群組、DM 預覽及行動裝置排版。
- `index.html`、`admin-tools-v228.js`：統一 V2.91 顯示版號及 JS/CSS 快取參數。
- `supabase/functions/line-webhook/index.ts`：原訂單 Webhook 保留，額外處理 LINE 簽章驗證後的群組 join/message/leave 事件，新增群組一律 `active=false`，由管理者自行啟用；離群自動停用。
- `supabase/functions/catalog-line-dispatch/index.ts`：獨立排程發送器，沒有前端可用的 service key。

## Supabase 資料庫
已部署 migrations：
- `catalog_line_dm_groups_jobs_secure_schedule_v291`
- `catalog_line_dm_regex_literal_png_fix_v291`
- `catalog_line_dm_cron_every_minute_v291`
- `catalog_line_dm_separate_preview_image_under_1mb`

### 商品主檔
`public.catalog_products` 增加：
- `line_published_at timestamptz`：新商品首次變成 active＋published 時由資料庫 trigger 自動記錄。
- `line_announced_at timestamptz`：有成功發送後紀錄最近推播時間；重新上架時重設。

不回填舊已上架商品，避免未經授權的大量推播。選品還需符合：
`active=true`、`published=true`、`archived_at is null`、
`visibility_mode='all'`，且開賣日期已到、尚未結單。

### 群組
`public.catalog_line_groups`：
- `line_group_id` 為從 LINE 簽章驗證 webhook 取得的 C... 群組 ID，不讓前端隨意猜測群組。
- `group_name`、`connected`、`active`、`last_seen_at`。
- 新登錄群組預設 `active=false`；管理者須在後台啟用後才可選擇推播。

### 排程
`public.catalog_line_push_jobs`：
- 群組、商品 UUID 陣列及商品快照、`dm_storage_path`、`preview_storage_path`。
- `intro`、`mall_url`、`scheduled_at`（帶時區）、狀態 pending/processing/sent/failed/cancelled、
  失敗原因、LINE 請求識別碼、created_by 及時間資訊。
- `public.catalog_line_schedule_push`：管理者權限、群組啟用、商品合法性、時間範圍、URL 白名單檢核。
- `public.catalog_line_cancel_push`：只能取消尚未發送的 pending。
- 排程狀態更新僅由 Edge Function 的 service-role 進行。

### DM 圖片與 LINE 規格
公開 storage bucket：`catalog-line-dm`，管理者才能在自己的 user UUID 資料夾新增檔案。
- 完整 DM：PNG，最多 5MB。
- LINE 預覽圖：JPEG，目標小於 900KB，符合官方圖片訊息 previewImageUrl **最多 1MB**。
- 兩張圖在建立排程時一次儲存到 Storage，不需要到發送時間才打開管理者電腦。
- 使用 `image` message 的 `originalContentUrl` + `previewImageUrl`，再送出含商城網址的 `text` message。

## 定時發送及安全
- Edge Function：`catalog-line-dispatch`，部署 `verify_jwt=false`，但任何呼叫都必須提供 `X-Cron-Key`。
- Cron 金鑰在 Supabase Vault 中隨機產生，透過 service-role-only 的
  `public.catalog_line_verify_cron(text)` 檢驗，不公開在 HTML / GitHub。
- Cron Job：`catalog_line_dm_every_minute`，每分鐘以 Vault token 呼叫 Edge Function。
- Edge Function 使用 service-role 從資料庫索取到期 pending、以原子 PATCH pending→processing 搶占；
  逐筆確認群組已啟用、商品仍販售、商品名稱及價格和排程快照一致。
- LINE push 同次請求送 2 個 message objects，使用穩定的 `X-Line-Retry-Key=job UUID` 以降低重送風險。
- 成功標記 sent、sent_at、LINE request ID，並更新商品 line_announced_at；失敗記錄原因，不自動反覆發送，避免重複廣告。
- **不得**將 LINE Channel Secret、Access Token、service-role key 或 Vault token 提交到 GitHub。

## 啟用步驟
1. LINE Developers 針對現有的 LINE 官方帳號啟用 `Allow bot to join group chats`，確保 Webhook URL 仍為既有 `line-webhook`。
2. 邀請現有官方帳號機器人加入測試私人群組；若機器人已在群內，請群組成員傳送一則訊息以觸發群組登錄。
3. 進入管理員「批發商城 → LINE 新品推播」，點選「啟用推播」（預設不啟用）。
4. 新增或上架一件公開販售商品並上傳商品照片；在新品清單選取商品。
5. 選擇已啟用的群組，輸入說明文字與台灣時間，預覽合成 DM 後建立排程。
6. 到排程時間後，由 Cron 自動將 DM 圖及含商城連結的文字發到群組。
7. 在後台「最近 30 筆」查結果；失敗先看錯誤原因，不隨意重送。

## 已完成驗證
- Supabase 資料表、RPC、Storage bucket、cron 與 Vault 驗證權限建立完成。
- 在 SQL BEGIN/ROLLBACK 內使用管理員 JWT 測試：新上架商品觸發標記、排程建立成功；正式商品未變動。
- 客戶 JWT 測試無法看見 LINE 群組，也無法排程。
- Cron job 逐分鐘執行，`net._http_response` 已回報 HTTP 200，`{"ok":true,"processed":0}`。
- 最新 GitHub 前端 JS 語法、導覽、按鈕事件、版本與快取引用檢查成功。
- 目前正式資料庫沒有群組、沒有新品標記、沒有排程，因此 **尚未執行實際 LINE 群組發送**；LINE Webhook 群組登錄、iPad 上圖片拖曳／Canvas 合成、實際使用者端上傳仍需真實登入測試。

## 已知限制與後續
- 群組名稱從加入事件取得；若只透過訊息首次登錄，可能先顯示「LINE 群組 + 尾碼」。
- 固定商城網址點擊後進入商城首頁／登入，並非商品獨立深度連結。
- 目前每張 DM 限 6 件新品且一次對一個 LINE 群組排程；不同群組可建立不同排程。
- 只推播 `visibility_mode='all'` 的一般批發價；客戶專屬價格不能發送到未經授權的群組。
- 正式 LINE push 會按群組接收者人數計算官方訊息額度。
- 上傳圖片的品質與尺寸須在 Windows、iPad 實測，若超過 LINE 預覽限制前端會拒絕建立排程。
