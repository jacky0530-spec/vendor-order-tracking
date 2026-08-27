# 廠商訂單追蹤系統

GitHub Pages 前端 + Supabase 後端。

## 功能
- LINE 訂單自動寫入 Supabase
- 出貨方為「宜羿」時排除
- 新廠商自動建立
- 無交期預設 14 天，可依廠商調整
- 現貨／N 週／區間週數自動換算交期
- 逾期、3 天內到期醒目提醒
- 管理員查看全部訂單與廠商報表
- 廠商以 V0001、V0002…帳號登入，只能查看自己的訂單
- 廠商可回填預計出貨日、實際出貨日、物流與單號
- LINE 解析異常集中待人工檢查

## GitHub Pages 發佈
1. Repository → Settings
2. 左側 Pages
3. Build and deployment → Source 選 Deploy from a branch
4. Branch 選 main，Folder 選 /(root)
5. Save
6. 發佈網址：`https://jacky0530-spec.github.io/vendor-order-tracking/`

## 首次管理員
在登入頁展開「首次建立管理員」，輸入一次性設定碼與自訂管理員密碼。成功後使用 `ADMIN` 登入。

## LINE Webhook
Webhook URL：
`https://qibeuakrryqjaiwbcorg.supabase.co/functions/v1/line-webhook`

Supabase Edge Function Secrets 需要：
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`

LINE Developers 需開啟：
- Use webhook
- Allow bot to join group chats

## 安全
前端只包含 Supabase publishable key；RLS 控制資料存取。Service Role Key、LINE Channel Secret、LINE Access Token 不可放進 GitHub。
