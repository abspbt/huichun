// Cloudflare Worker：回春視務所預約表的讀寫後端（資料存在 Cloudflare D1）
//
// 綁定與環境變數：
//   DB                   D1 資料庫 huichun-booking（見 wrangler.toml）
//   ADMIN_TOKEN          admin 後台寫入用的密碼（secret）
//   GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY / SPREADSHEET_ID
//                        舊的 Google 試算表。只在 D1 第一次被用到時，把試算表裡
//                        已有的鎖定時段匯入 D1 一次（見 ensureReady），之後不再讀寫
//                        試算表。匯入完成後這三個 secret 可以刪掉。
//
// 資料表 bookings：一列 = 一個被鎖定（不可預約）的時段，例如 ('2026-10-01', '10:00')。
//
// GET  /bookings?from=YYYY-MM-DD&to=YYYY-MM-DD
//        公開讀取，回 {"ok":true,"booked":{"2026-10-01":["10:00","13:30"]}}
//        只有日期＋時段，沒有任何客人資料，跟以前公開的 Google 試算表內容相同。
// POST /  body 為 {date, time, action, password}
//        action 為 "lock" / "unlock"；time 為 SLOT_TIMES 之一，或 "ALL"（整天）
//        密碼錯誤回 403

// 對外一律回這句。原始錯誤內容可能含內部資訊，不該回給呼叫端（這個端點任何人
// 都能打）；詳細內容用 console.log 留在 Cloudflare 後台的 Logs / `wrangler tail`。
var GENERIC_ERROR = "暫時無法連線，請稍後再試";

// 必須跟 booking.html / booking-board.html 的 SLOT_TIMES 一致
var SLOT_TIMES = ["10:00", "11:00", "13:30", "14:30", "15:30"];

var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var MAX_RANGE_DAYS = 400;

var ALLOWED_ORIGINS = [
  "https://hui-chun.com",
  "https://www.hui-chun.com",
  "https://abspbt.github.io"
];

function corsHeaders(origin) {
  var allowOrigin = ALLOWED_ORIGINS.indexOf(origin) !== -1 ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function jsonResponse(payload, status, headers) {
  return new Response(JSON.stringify(payload), {
    status: status,
    headers: Object.assign({}, headers, { "Content-Type": "application/json;charset=utf-8" })
  });
}

// ---- Google 服務帳號 → access token（只給一次性匯入用） ----

function base64UrlFromBytes(bytes) {
  var binary = "";
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlFromString(str) {
  return base64UrlFromBytes(new TextEncoder().encode(str));
}

function pemToArrayBuffer(pem) {
  var b64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  var binary = atob(b64);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function importPrivateKey(pem) {
  return crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function getAccessToken(env) {
  var privateKeyPem = String(env.GOOGLE_PRIVATE_KEY).replace(/\\n/g, "\n");
  var now = Math.floor(Date.now() / 1000);

  var header = { alg: "RS256", typ: "JWT" };
  var claimSet = {
    iss: env.GOOGLE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };
  var unsigned = base64UrlFromString(JSON.stringify(header)) + "." + base64UrlFromString(JSON.stringify(claimSet));

  var key = await importPrivateKey(privateKeyPem);
  var signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(unsigned)
  );
  var jwt = unsigned + "." + base64UrlFromBytes(new Uint8Array(signature));

  var res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });
  var data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error("取得 Google access token 失敗：" + JSON.stringify(data));
  }
  return data.access_token;
}

function isValidDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  var d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function pad2(v) {
  var s = String(v);
  return s.length < 2 ? "0" + s : s;
}

function ymd(y, m, d) {
  return y + "-" + pad2(m) + "-" + pad2(d);
}

// ---- 資料表建立＋舊試算表一次性匯入 ----

var readyChecked = false; // 同一個 Worker 實例內只檢查一次

async function ensureReady(env) {
  if (readyChecked) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS bookings (date TEXT NOT NULL, time TEXT NOT NULL, PRIMARY KEY (date, time))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
  ]);
  var row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'sheet_imported'").first();
  if (!row) {
    var count = await importFromSheet(env);
    await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('sheet_imported', ?)")
      .bind(new Date().toISOString() + " (" + count + " slots)")
      .run();
    console.log("已從 Google 試算表匯入 " + count + " 個鎖定時段");
  }
  readyChecked = true;
}

// 試算表 A 欄是日期，B~F 欄依序對應 SLOT_TIMES，格子有值 = 已鎖定。
// 用 UNFORMATTED_VALUE + SERIAL_NUMBER 讀，日期會是序號（1899-12-30 起算的天數），
// 不會是畫面上顯示的「09月26日」（沒有年份）。萬一 A 欄是文字，也盡量解析。
async function importFromSheet(env) {
  var accessToken = await getAccessToken(env);
  var res = await fetch(
    "https://sheets.googleapis.com/v4/spreadsheets/" + env.SPREADSHEET_ID +
      "/values/" + encodeURIComponent("booking!A1:F400") +
      "?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER",
    { headers: { Authorization: "Bearer " + accessToken } }
  );
  var data = await res.json();
  if (!res.ok) {
    throw new Error("讀取試算表失敗：" + JSON.stringify(data));
  }
  var statements = [];
  (data.values || []).forEach(function (row) {
    var date = parseSheetDate(row && row[0]);
    if (!date) return;
    SLOT_TIMES.forEach(function (time, idx) {
      var v = row[idx + 1];
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        statements.push(
          env.DB.prepare("INSERT OR IGNORE INTO bookings (date, time) VALUES (?, ?)").bind(date, time)
        );
      }
    });
  });
  for (var i = 0; i < statements.length; i += 100) {
    await env.DB.batch(statements.slice(i, i + 100));
  }
  return statements.length;
}

function parseSheetDate(v) {
  if (typeof v === "number" && v > 0) {
    var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  if (typeof v !== "string") return null;
  var s = v.trim();
  var m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) return ymd(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})月(\d{1,2})日/);
  if (m) {
    // 沒有年份：選離今天（台北時間）最近的那一年
    var now = new Date(Date.now() + 8 * 3600000);
    var best = null, bestDiff = Infinity;
    [-1, 0, 1].forEach(function (off) {
      var y = now.getUTCFullYear() + off;
      var diff = Math.abs(Date.UTC(y, parseInt(m[1], 10) - 1, parseInt(m[2], 10)) - now.getTime());
      if (diff < bestDiff) { bestDiff = diff; best = ymd(y, m[1], m[2]); }
    });
    return best;
  }
  return null;
}

// ---- GET /bookings：公開讀取鎖定時段 ----

async function handleGet(url, env, headers) {
  var from = url.searchParams.get("from");
  var to = url.searchParams.get("to");
  if (!isValidDate(from) || !isValidDate(to) || from > to) {
    return jsonResponse({ ok: false, message: "參數錯誤" }, 400, headers);
  }
  var days = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (days > MAX_RANGE_DAYS) {
    return jsonResponse({ ok: false, message: "日期範圍太大" }, 400, headers);
  }

  await ensureReady(env);
  var result = await env.DB.prepare(
    "SELECT date, time FROM bookings WHERE date BETWEEN ? AND ? ORDER BY date, time"
  ).bind(from, to).all();

  var booked = {};
  (result.results || []).forEach(function (r) {
    (booked[r.date] = booked[r.date] || []).push(r.time);
  });
  return jsonResponse({ ok: true, booked: booked }, 200,
    Object.assign({}, headers, { "Cache-Control": "no-store" }));
}

// ---- POST：鎖定／解除時段 ----

async function handlePost(request, env, headers) {
  var payload;
  try {
    payload = await request.json();
  } catch (e) {
    return jsonResponse({ ok: false, message: "請求格式錯誤" }, 400, headers);
  }

  var date = payload && payload.date;
  var time = payload && payload.time;
  var action = payload && payload.action;
  var password = payload && payload.password;

  if (!env.ADMIN_TOKEN || password !== env.ADMIN_TOKEN) {
    return jsonResponse({ ok: false, message: "密碼錯誤" }, 403, headers);
  }

  var times = time === "ALL" ? SLOT_TIMES : (SLOT_TIMES.indexOf(time) !== -1 ? [time] : null);
  if (!isValidDate(date) || !times || (action !== "lock" && action !== "unlock")) {
    return jsonResponse({ ok: false, message: "參數錯誤" }, 400, headers);
  }

  await ensureReady(env);
  var sql = action === "lock"
    ? "INSERT OR IGNORE INTO bookings (date, time) VALUES (?, ?)"
    : "DELETE FROM bookings WHERE date = ? AND time = ?";
  await env.DB.batch(times.map(function (t) {
    return env.DB.prepare(sql).bind(date, t);
  }));

  return jsonResponse({ ok: true }, 200, headers);
}

export default {
  async fetch(request, env) {
    var origin = request.headers.get("Origin") || "";
    var headers = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: headers });
    }

    try {
      var url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/bookings") {
        return await handleGet(url, env, headers);
      }
      if (request.method === "POST") {
        return await handlePost(request, env, headers);
      }
      return jsonResponse({ ok: false, message: "Not Found" }, 404, headers);
    } catch (err) {
      console.log("未預期的錯誤", (err && err.stack) || String(err));
      return jsonResponse({ ok: false, message: GENERIC_ERROR }, 500, headers);
    }
  }
};
