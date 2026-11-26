# 宜羿 B2B V2.86｜待處理問題單（取代 NG 問題單）

更新日期：2026-11-26

## 1. 需求與資料來源
使用者提供 Excel：\`團購待處理件.xlsx\`，工作表 \`表單回覆 1\`。
欄位依序包括：Column 13（標記）、完成、目前案件狀態、登記日期、主要人、次要人、問題類型、問題內容、備註、第 11 欄（完成標記）、時間戳記。

經檢查表格包含 1,024 筆資料列，但**只有 24 列具有實際案件內容**，其餘約 1,000 列主要是格式標記（🟥）的空白列。
24 筆的問題類型包括 NG回報、訂單貨況、缺貨回報；案件狀態包括 尚未處理、等待廠商、等待客人。
這些既有資料**未自動匯入資料庫**，避免與原有問題單重複，需另行規劃歷史匯入及去重。

## 2. 功能
- 管理者及系統既有授權員工在「批發商城 → 待處理問題單」建立／修改／查看問題單
- 每筆可設定登記日期、主要人、次要人、問題類型、案件狀態、完成與否、問題主旨、內容、備註
- 可選填客戶主檔關聯（\`customer_id\` 可空白）、商品貨號、ORD/PUR 參考
- 狀態：new 尚未處理、processing 處理中、waiting_vendor 等待廠商、waiting_customer 等待客人、resolved 已解決、closed 已結案
- \`is_completed\`、\`completed_at\` 獨立於狀態，因為 Excel 的「已完成」與「等待廠商」等狀態可能同時存在
- 可新增照片／影片（多選／拖曳；剪貼簿有圖片檔案時可貼上）
- 圖片 JPG/PNG/WebP ≤ 10MB、影片 MP4/MOV/WebM ≤ 50MB 且 ≤ 30 秒
- 上傳前預覽及移除佇列；已有附件可預覽及「軟移除」
- 已有的 NG 問題紀錄與內部留言仍可查看，並可新增進度紀錄
- 客戶端移除「NG 商品反應」導覽，並撤銷資料庫寫入及讀取權限
- 管理員清單有關鍵字、案件狀態及完成狀態篩選

## 3. 前端檔案
- \`ng-tickets-v232.js\`：模組已從客戶提報改成 admin-only render；\`openIssueEditor()\` 管理者新增及修改、圖片/影片 dropzone、上傳前 queue、附件隱藏、內部處理進度。
- \`catalog-v231.js\`：原 \`NG 問題單\` 頁籤改 \`待處理問題單\`；客戶導覽不再顯示 \`NG 商品反應\`，刪除原客戶觸發路徑。
- \`catalog-v230.css\`：案件清單、表單、拖曳附件預覽、行動版響應式排版。
- \`index.html\`、\`admin-tools-v228.js\`：V2.86 版本與載入快取參數。

## 4. Supabase 資料庫
專案 \`qibeuakrryqjaiwbcorg\`。

Migration：\`catalog_admin_only_pending_issues_excel_fields_20261126\`

### ng_tickets 新增欄位
- \`case_date date\`
- \`primary_person text\`
- \`secondary_person text\`
- \`issue_type text\`
- \`internal_notes text\`
- \`is_completed boolean not null default false\`
- \`completed_at timestamptz\`
- \`customer_id\` 改成可 NULL（原來需要必綁客戶）
- \`status\` CHECK 擴充 \`waiting_vendor\`，原狀態全部保留

### ng_photos
- 加上 \`deleted_at timestamptz\`
- 移除附件採軟刪除，只標記 \`deleted_at\`；不刪 Storage 原始檔，以保護歷史紀錄。

### Storage
私有 bucket：\`ng-ticket-photos\`
- \`public=false\`
- MIME 支援：image/jpeg, image/png, image/webp, video/mp4, video/webm, video/quicktime
- bucket 單檔上限 50MB
- 前端仍實施照片 10MB、影片 50MB、30 秒限制
- 使用簽名 URL 預覽私有附件

## 5. RLS 與安全性
- \`ng_tickets\`: SELECT/INSERT/UPDATE 只允許 \`public.catalog_is_manager()\`
- \`ng_messages\`: SELECT/INSERT 只允許 manager，且新增留言的 author_id 必須是 auth.uid()
- \`ng_photos\`: SELECT/INSERT/UPDATE 只允許 manager；新增的 created_by 必須是 auth.uid()
- Storage 的 \`ng-ticket-photos\`：SELECT/INSERT 只允許 manager，且上傳的第一層路徑須是存在的 ticket UUID
- **客戶無法再看見舊 NG 問題單，也無法建立新的提報；不能只靠隱藏 UI，RLS 必須保留。**
- 前端使用 publishable key + session JWT，絕不暴露 service_role。

## 6. 驗證結果
- 管理員身分 SQL transaction：建立無綁定客戶的問題單、更新備註、完成狀態、插入內部進度、插入附件 metadata、軟刪除 metadata，測試成功後 ROLLBACK
- 客戶身分 SQL transaction：問題單讀取數為 0，無法 INSERT，附件讀取數為 0，測試成功後 ROLLBACK
- Storage bucket MIME、容量及非公開狀態已核對。
- JavaScript 兩份前端主檔語法檢查通過，頁籤及快取版本檢查通過。
- **尚未在正式站用管理者真實登入完成瀏覽器拖曳、影片 Storage 上傳及 Safari/iPad 操作測試**。不可把純程式檢查說成正式網站已實測。

## 7. 後續
1. 使用真正管理員登入正式站，測試新增/修改/拖曳圖片及小於 30 秒影片、附件預覽、完成、進度。
2. 使用客戶帳號確認看不到提報入口，嘗試 API 查詢也應由 RLS 阻擋。
3. 如需匯入 Excel 的 24 筆歷史表單資料，先建立比對／去重預覽與日期解析，不要將 1,000 筆格式空白列匯入。
4. 變更功能前先核對 GitHub 最新 main 與 Supabase 已部署 schema。
