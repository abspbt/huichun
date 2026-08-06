// Cloudflare Worker：回春視務所預約表的讀寫後端
//
// 環境變數（用 `wrangler secret put <名稱>` 或 Cloudflare Dashboard 設定，不要寫進程式碼）：
//   GOOGLE_CLIENT_EMAIL  Google 服務帳號的 client_email
//   GOOGLE_PRIVATE_KEY   Google 服務帳號的 private_key（PEM 格式，換行可為字面 \n）
//   ADMIN_TOKEN          admin 後台寫入用的密碼
//   SPREADSHEET_ID       Google 試算表 ID
//
// GET  /   →  回傳 booking!A1:F400 的 Sheets API values.get 原始 JSON（唯讀，前端目前未使用，但保留舊行為）
// POST /   →  body 為 {date, time, action, password}，寫入/清除單一格子

var SHEET_NAME = "booking";
var SHEET_RANGE_FULL = SHEET_NAME + "!A1:F400";
var SHEET_RANGE_DATES = SHEET_NAME + "!A1:A400";

var COLUMN_BY_TIME = {
  "10:00": "B",
  "11:00": "C",
  "13:30": "D",
  "14:30": "E",
  "15:30": "F"
};

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

// ---- Google 服務帳號 → access token（GET / POST 共用） ----

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
    scope: "https://www.googleapis.com/auth/spreadsheets",
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

// ---- GET：轉發 booking!A1:F400 的原始 Sheets API JSON ----

async function handleGet(env, headers) {
  var accessToken = await getAccessToken(env);
  var url = "https://sheets.googleapis.com/v4/spreadsheets/" + env.SPREADSHEET_ID +
    "/values/" + encodeURIComponent(SHEET_RANGE_FULL);
  var res = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  var body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: Object.assign({}, headers, { "Content-Type": "application/json;charset=utf-8" })
  });
}

// ---- POST：鎖定／解除單一時段 ----

function dateToSheetLabel(dateStr) {
  var parts = String(dateStr).split("-");
  var month = parts[1] || "";
  var day = parts[2] || "";
  return pad2(month) + "月" + pad2(day) + "日";
}

function pad2(v) {
  var s = String(v);
  return s.length < 2 ? "0" + s : s;
}

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

  if (password !== env.ADMIN_TOKEN) {
    return jsonResponse({ ok: false, message: "密碼錯誤" }, 403, headers);
  }

  var column = COLUMN_BY_TIME[time];
  if (!date || !column || (action !== "lock" && action !== "unlock")) {
    return jsonResponse({ ok: false, message: "參數錯誤" }, 400, headers);
  }

  var accessToken = await getAccessToken(env);

  var dateRes = await fetch(
    "https://sheets.googleapis.com/v4/spreadsheets/" + env.SPREADSHEET_ID +
      "/values/" + encodeURIComponent(SHEET_RANGE_DATES),
    { headers: { Authorization: "Bearer " + accessToken } }
  );
  var dateData = await dateRes.json();
  if (!dateRes.ok) {
    return jsonResponse({ ok: false, message: "讀取試算表失敗：" + JSON.stringify(dateData) }, 502, headers);
  }

  var targetLabel = dateToSheetLabel(date);
  var rows = dateData.values || [];
  var rowNumber = -1;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i] && rows[i][0] === targetLabel) {
      rowNumber = i + 1; // Sheets 列號從 1 開始
      break;
    }
  }
  if (rowNumber === -1) {
    return jsonResponse({ ok: false, message: "找不到該日期" }, 200, headers);
  }

  var value = action === "lock" ? "X" : "";
  var range = SHEET_NAME + "!" + column + rowNumber;
  var updateRes = await fetch(
    "https://sheets.googleapis.com/v4/spreadsheets/" + env.SPREADSHEET_ID +
      "/values/" + encodeURIComponent(range) + "?valueInputOption=RAW",
    {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ range: range, majorDimension: "ROWS", values: [[value]] })
    }
  );

  if (!updateRes.ok) {
    var errBody = await updateRes.text();
    return jsonResponse({ ok: false, message: "寫入試算表失敗：" + errBody }, 502, headers);
  }

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
      if (request.method === "GET") {
        return await handleGet(env, headers);
      }
      if (request.method === "POST") {
        return await handlePost(request, env, headers);
      }
      return jsonResponse({ ok: false, message: "Method Not Allowed" }, 405, headers);
    } catch (err) {
      return jsonResponse({ ok: false, message: (err && err.message) || String(err) }, 500, headers);
    }
  }
};
