# booking-worker

`booking-board.html` 寫入預約表用的 Cloudflare Worker（讀取仍走 Google Sheets 的公開 gviz 端點，跟這支 Worker 無關）。

## 部署

```
cd worker
wrangler deploy
```

首次部署或金鑰更新時設定 secrets（不要寫進 `wrangler.toml` 或提交進 git）：

```
wrangler secret put GOOGLE_CLIENT_EMAIL
wrangler secret put GOOGLE_PRIVATE_KEY   # 貼 PEM 全文即可，字面 \n 會自動轉換
wrangler secret put ADMIN_TOKEN          # 前端 booking-board.html 要求輸入的密碼
wrangler secret put SPREADSHEET_ID
```

`GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` 來自 Google Cloud 服務帳號的 JSON 金鑰，且該服務帳號的 email 需要有這份 Google Sheet 的編輯權限。

## API

- `GET /`：回傳 `booking!A1:F400` 的 Sheets API `values.get` 原始 JSON。
- `POST /`：body 為 `{"date":"2026-08-06","time":"10:00","action":"lock","password":"..."}`
  - `action` 為 `"lock"` 或 `"unlock"`
  - 密碼錯誤回 HTTP 403
  - 成功回 `{"ok":true}`；找不到日期回 `{"ok":false,"message":"找不到該日期"}`

CORS 只允許 `https://hui-chun.com`、`https://www.hui-chun.com`、`https://abspbt.github.io` 這幾個網域呼叫。若前端網域不同，記得同步修改 `booking-worker.js` 裡的 `ALLOWED_ORIGINS`。
