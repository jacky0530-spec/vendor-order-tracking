# 宜羿 B2B 商城 V2.92｜建立專屬 LINE 新品通知機器人

更新日期：2026-11-27

## 目的與已完成狀態

商城 V2.91 已具有「選擇 1～6 件新上架商品 → 合成一張 DM（PNG 原圖、JPEG 預覽）→ 排程 → LINE 推送 DM＋說明＋商城連結」功能。

V2.92 將 LINE 新品通知**與既有 LINE 訂單匯入帳號完全分離**：

- 新增獨立 Webhook：\`catalog-line-webhook\`。
- 新機器人 Channel Secret 只讀 \`LINE_CATALOG_CHANNEL_SECRET\`。
- 新品排程發送只讀 \`LINE_CATALOG_CHANNEL_ACCESS_TOKEN\`。
- 舊機器人 \`line-webhook\` / \`line-worker\` 仍只用 \`LINE_CHANNEL_SECRET\`、\`LINE_CHANNEL_ACCESS_TOKEN\`，不能更改這兩個舊變數。
- 群組由新機器人 LINE 簽章事件登錄，新增一律 \`active=false\`，後台手動啟用後才能收推播。
- 沒有新機器人憑證時排程發送端不會送訊息。
- **LINE 官方帳號本身尚未建立**：LINE 身分驗證、帳號名稱及服務條款必須由帳號持有人透過 LINE 官方 UI 完成；GitHub / Supabase 部署不代表已註冊官方帳號。

## 第 1 步：在 LINE 建立官方帳號

1. 前往 https://manager.line.biz/ ，以你的 LINE 帳號或 LINE Business ID 登入。
2. 如尚無專用官方帳號，按「建立 LINE 官方帳號／建立新帳號」。
3. 建議顯示名稱 **宜羿新品通知**，所屬組織與聯絡資料以實際資料填寫，帳號圖片可用宜羿商城 Logo。
4. 確認新增的帳號出現在 LINE Official Account Manager。

**重要：** 自 2024-09 起，Messaging API Channel 不再允許從 LINE Developers Console 直接建立；要先建立官方帳號，再啟用 Messaging API。
LINE 官方建立指南：https://developers.line.biz/en/docs/messaging-api/getting-started/

## 第 2 步：啟用 Messaging API 並取得憑證

1. 在新建立的官方帳號後台找到「設定」→「Messaging API」→「啟用 Messaging API」。
2. 選擇你公司的 Provider；若已有相關 Provider 可沿用公司同一 Provider，注意 **Provider 一經選定不能隨意變更**。
3. 登入 https://developers.line.biz/console/ ，選擇剛產生的 Messaging API Channel。
4. 於新 Channel 取得 **Channel secret**（一般在 Basic settings）及 **Channel access token**（在 Messaging API）。
5. **不可**將上述兩個密鑰貼到 ChatGPT 聊天室、GitHub、HTML 或系統客戶端頁面。僅在 Supabase Dashboard 安全輸入。

## 第 3 步：將新機器人密鑰放到 Supabase Edge Function Secrets

Supabase project: \`qibeuakrryqjaiwbcorg\`
管理頁：https://supabase.com/dashboard/project/qibeuakrryqjaiwbcorg

在 Edge Functions → Secrets 新增（或覆寫）兩組專用環境變數：

| Variable name | Value |
|---|---|
| \`LINE_CATALOG_CHANNEL_SECRET\` | 新 LINE Messaging API Channel 的 **Channel secret** |
| \`LINE_CATALOG_CHANNEL_ACCESS_TOKEN\` | 新 LINE Messaging API Channel 的 **Channel access token** |

勿覆蓋系統原有 \`LINE_CHANNEL_SECRET\`、\`LINE_CHANNEL_ACCESS_TOKEN\`。
勿替換 \`SUPABASE_SERVICE_ROLE_KEY\` 或 Cron 專用 Vault 金鑰。

Supabase 機密參數官方說明：https://supabase.com/docs/guides/functions/secrets

## 第 4 步：LINE Developers 設定新機器人

在新的 Messaging API Channel（不是原本訂單匯入 Channel）：

- Webhook URL 使用以下**完整固定網址**：

  \`https://qibeuakrryqjaiwbcorg.supabase.co/functions/v1/catalog-line-webhook\`

- 按 Verify，確認 Success。
- 將 \`Use webhook\` 設為 Enabled。
- 將 \`Allow bot to join group chats\` 設為 Enabled（預設關閉）。
- 如不需要 LINE 自動文字回覆，建議關閉自動回覆訊息以免干擾。
- 將新機器人加為好友，以測試其 QR Code 或搜尋是否正常。

**Webhook URL 勿誤填為舊的 \`.../functions/v1/line-webhook\`**，那是訂單匯入的舊帳號專用。

LINE 官方文件：
- https://developers.line.biz/en/docs/messaging-api/building-bot/
- https://developers.line.biz/en/docs/messaging-api/group-chats/

## 第 5 步：加入私人群組並啟用新品通知

1. 在 LINE 建立一個私人測試群組或使用現有群組。
2. 邀請 **宜羿新品通知** 專用官方帳號機器人。
3. 請群組成員在群組送一則測試訊息。新 Webhook 從 LINE 簽章驗證的 groupId 自動登記到 \`catalog_line_groups\`。
4. 在商城管理員頁「批發商城 → LINE 新品推播」按「重新整理」。
5. 找到新群組，按「啟用推播」（新群組預設停用）。
6. 將新商品上架並上傳照片，選 1–6 件，預覽 DM、設定台灣時間、建立排程。
7. 由 \`catalog_line_dm_every_minute\` 每分鐘觸發 \`catalog-line-dispatch\`；成功後在群組收到 DM 圖片及商城連結。

**注意：** LINE 每個私人群組同時最多只能有一個 LINE 官方帳號機器人。若群內已有原訂單匯入官方帳號，應先建立獨立的新品通知群組，或明確移除原機器人後才邀請新機器人；不要讓原訂單匯入流程失效。

## 專案程式與安全重點

- \`supabase/functions/catalog-line-webhook/index.ts\`：需 LINE 正確 HMAC-SHA256 簽章；獨立的 \`LINE_CATALOG_CHANNEL_SECRET\` 未設時回 503。僅處理群組加入／訊息／離開事件。
- \`supabase/functions/catalog-line-dispatch/index.ts\`：使用 \`LINE_CATALOG_CHANNEL_ACCESS_TOKEN\`，無此變數則回 \`configured:false\`，絕不改用舊 token。排程仍透過 Vault \`X-Cron-Key\` 驗證。
- \`supabase/functions/line-webhook/index.ts\`：原訂單匯入功能保留，不再登錄新品通知群組。
- \`catalog-line-dm-v291.js\`、\`catalog-v230.css\`、\`index.html\`、\`admin-tools-v228.js\`：V2.92 的機器人建立提示、Webhook 複製與統一版號。
- 新群組不會自動啟用；後台 RLS 仍只允許已授權 manager/employee 管理發文。

## 驗收狀態

- Supabase 已部署 \`line-webhook\` V15、\`catalog-line-webhook\` V1、\`catalog-line-dispatch\` V3。
- 已檢查新增 Webhook 用獨立 secret 並驗簽、原機器人訂單 Webhook 不含新品群組登錄、排程只讀新 token、未配置新 token 時不發送。
- 商品網站已更新 V2.92，前端 JavaScript 語法及按鈕掛載檢查通過。
- 目前新品群組與排程均 0；**尚未註冊新 LINE 官方帳號、尚未寫入新 Channel 憑證、尚未在真實 LINE 群組測試收圖**。
