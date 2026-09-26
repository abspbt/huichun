# booking-worker

`booking.html` / `booking-board.html` 讀寫預約時段用的 Cloudflare Worker，資料存在 Cloudflare D1（資料庫 `huichun-booking`，綁定名稱 `DB`，見 `wrangler.toml`）。

## 部署

Worker 已接上 GitHub（Cloudflare 後台 Workers & Pages → `crimson-dream-d3cf` → 設定 → 組建），每次推送到 `main` 就會自動部署，不用手動操作。設定：根目錄 `/`、組建命令留空、部署命令 `npx wrangler deploy --config worker/wrangler.toml`。

要手動部署的話：

```
cd worker
wrangler deploy
```

secrets（已在 Cloudflare 後台設好，不要寫進 `wrangler.toml` 或提交進 git）：

```
wrangler secret put ADMIN_TOKEN          # 前端 booking-board.html 要求輸入的密碼
wrangler secret put GOOGLE_CLIENT_EMAIL  # ↓ 這三個只用在第一次把舊 Google 試算表的資料匯入 D1
wrangler secret put GOOGLE_PRIVATE_KEY
wrangler secret put SPREADSHEET_ID
```

## 資料

表 `bookings (date TEXT, time TEXT, PRIMARY KEY (date, time))`：一列 = 一個被鎖定（不可預約）的時段。
表 `meta`：`sheet_imported` 這一列存在，代表舊試算表已經匯入過。Worker 第一次收到請求時如果沒有這一列，會先把 Google 試算表 `booking!A1:F400` 裡有值的格子匯入 D1（只做一次），之後完全不再讀寫試算表。

## API

- `GET /bookings?from=YYYY-MM-DD&to=YYYY-MM-DD`：公開讀取，回 `{"ok":true,"booked":{"2026-10-01":["10:00","13:30"]}}`。只有日期和時段，沒有客人資料（跟以前公開的試算表內容一樣）。範圍最多 400 天。
- `POST /`：body 為 `{"date":"2026-10-01","time":"10:00","action":"lock","password":"..."}`
  - `action` 為 `"lock"` 或 `"unlock"`
  - `time` 為五個時段之一，或 `"ALL"`（整天）
  - 密碼錯誤回 HTTP 403
  - 成功回 `{"ok":true}`
- 其他路徑回 404。

CORS 只允許 `https://hui-chun.com`、`https://www.hui-chun.com`、`https://abspbt.github.io` 這幾個網域呼叫。若前端網域不同，記得同步修改 `booking-worker.js` 裡的 `ALLOWED_ORIGINS`。
