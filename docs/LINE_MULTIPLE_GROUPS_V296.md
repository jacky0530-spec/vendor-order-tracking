# 宜羿 B2B 商城 V2.96｜LINE 推播可複選發送群組

更新：2026-11-27

## 需求
「批發商城 → LINE 商品推播 → 3．設定推播時間及文字」原本以單選下拉選擇一個發送群組。改成勾選多個已啟用 LINE 群組，一次排程將**同一張新品 DM** 和附商城連結的說明發送到所有勾選的群組。

## 前端（GitHub）
- `catalog-line-dm-v291.js`
  - 將 `#catLineTarget` 單選改為 `#catLineTargetToggle` 可收合勾選清單（`#catLineTargetPanel`），預設收合、顯示「尚未選擇發送群組」。
  - 可展開搜尋 LINE 群組名稱／編號，勾選只顯示 `active=true && connected=true` 的群組。
  - `全選搜尋結果` 只選取符合目前搜尋的群組，保留先前已選取的其他群組；`清除全部` 一次取消全部。
  - 以 `model.selectedGroupIds: Set` 保存勾選，在切換搜尋條件、收合及刷新頁面內群組清單時保留仍有效的選取；群組已停用／離開後會自動自選取清單移除。
  - 無預選群組；一次最多選取 100 群，避免過量批次操作。
  - 設定時間／文案／選品流程保留。點建立排程時先顯示「幾群、哪些商品、發送時間及部分群組名稱」確認對話框，並說明 LINE 訊息額度。
  - 仍只合成一次完整 PNG DM ＋一次 JPEG 預覽圖、上傳一次到 Storage；使用 `catalog_line_schedule_push_multi` RPC 一次排程所有群組，而不是在瀏覽器端逐群 RPC。
  - 伺服器回應 `uuid[]`，要與勾選群組筆數相同才顯示建立成功，避免部分建立卻誤報完成。
- `catalog-v230.css`：多群組收合選擇面板、搜尋列、核取方塊、內部清單捲動，高度上限電腦 230px／手機 210px，群組多時不拉長網頁。
- `index.html`、`admin-tools-v228.js`、`app-version.json`：系統顯示與版本檢查都更新為 V2.96，相關 CSS／JS 檔案使用 `build=296-line-multi-groups`。

## 後端（Supabase）
- 正式 RPC：`public.catalog_line_schedule_push_multi(uuid[],uuid[],timestamptz,text,text,text,text)`，已部署；GitHub SQL 位於 `supabase/migrations/20261127_catalog_line_multi_groups_v296.sql`。
- 語言 PL/pgSQL，`SECURITY INVOKER`，只開放 `authenticated` EXECUTE；驗證 `auth.uid()` 與 `catalog_is_manager()`。
- 每次要求 1–100 個相異、非空 UUID 群組 ID。
- 逐個呼叫既有 `catalog_line_schedule_push` 做全部原有驗證，包括群組啟用、已公開販售產品、上架期限、最多 6 件商品、排程時間、DM 原圖／預覽圖路徑。
- 由單一 RPC 與 Postgres 交易確保全有或全無（若其中一個群組失效、商品或排程不合規，整批不建立任何排程）。
- 每個群組一筆獨立 `catalog_line_push_jobs`，所有群組共用同一張 `dm_storage_path` 和 `preview_storage_path`；原本的每分鐘排程發送器 `catalog-line-dispatch` 依序處理到期工作，不需修改舊 LINE 訂單匯入機器人。
- 個別群組在發送前若已停用，該筆排程記錄失敗，不影響其他群組；發送記錄仍顯示各群組狀態。

## 操作方式
1. 登入最新版 `https://jacky0530-spec.github.io/vendor-order-tracking/?build=296-line-multi-groups`。
2. 點「批發商城 → LINE 商品推播」，選 1 至 6 件已上架商品。
3. 到「3．設定推播時間及文字」的「發送群組（可複選）」，點「勾選發送群組」。
4. 勾選一個或多個群組。群組數量多時可輸入名稱搜尋，再勾選其他群組；「全選搜尋結果」只選符合篩選的群組。
5. 收合後會顯示已勾選幾群；選擇台灣時間、輸入說明，先「預覽合成 DM」。
6. 點「建立 LINE 發送排程」，確認群組數、時間和商品資訊；建立成功後依群組記錄排程。

## 驗證結果
- 正式 Supabase 的 SQL `BEGIN/ROLLBACK` 測試：使用 manager 身分選 2 個已啟用群組，生成兩筆共用相同 DM 路徑的待發送紀錄，回傳兩組不同 job UUID；重複群組 ID、無效群組、超過 100 群均遭拒絕；任一群組出錯整批回滾。正式資料未改動、沒有執行 LINE 發送。
- 客戶身分無法呼叫多群組排程 RPC；新 RPC 使用 SECURITY INVOKER，anon 無 EXECUTE。
- 100 個模擬群組 UI 測試：僅已啟用群組可以選，搜尋符合項目、全選、跨搜尋保留已選、收合及清除全部均通過。
- 最新 GitHub JS 語法及 V2.96 版本、快取引用檢查通過。
- **尚未在正式登入的 Windows/iPad 瀏覽器點選群組與收到實際 LINE 訊息**；仍需實際端對端測試。

## 不變
- 商品圖、文案、DM 版型、6 件商品上限、日期／網址，原有 LINE 官方帳號及舊訂單匯入 Webhook。
- 不會因為儲存／預覽而自動發送任何訊息；只有管理員建立排程時才產生 jobs。
