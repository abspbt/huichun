首頁背景每日自動輪播 — 圖片命名規則
================================

這個資料夾放的是首頁 (index.html) 背景插圖的「每日輪播」圖片。
機制寫在 index.html 的 <img class="hero-bg" id="heroBg"> 標籤後面那段
inline <script> 裡，這裡只是說明怎麼放檔案，不用改任何程式碼。

怎麼放圖：
- 檔名就是「幾號」，例如 5.webp 對應每個月的 5 號、17.webp 對應 17 號，
  以此類推，最多到 31.webp（用台灣時區判斷今天是幾號）。
- 檔案格式用 .webp（跟現在首頁用的 img/hero-illustration.webp 一樣）。
- 尺寸／構圖要求跟 CLAUDE.md「Homepage hero illustration sizing」那節
  完全一樣：寬度 640px（高度依來源照片比例）、把想強調的主體放在畫面
  右半到三分之二處（因為 object-position: right center），左半部要
  維持素淨明亮（牆面／淺色背景那種），因為文字會直接疊在圖片上面，
  沒有任何遮罩擋著。
- 不用每張都補齊 1~31 號——哪一天沒有對應檔名的圖，網站會自動顯示
  預設的 img/hero-illustration.webp，不會壞版、不會出現破圖。
- 同一個檔名（例如 15.webp）在不同月份的 15 號都會重複出現，這是
  預期行為；如果要換成別的照片，直接把同一個檔名的內容換掉即可，
  網站會自動用「當天日期」當作快取版本號，不會被瀏覽器快取卡住舊圖。

這個機制不會用到、也不需要更新 index.html 的 BUILD_VERSION —— 只有
未來如果要「改」輪播的程式邏輯本身（不是換圖片內容）才需要動到
index.html 並照 CLAUDE.md 的規則手動 bump BUILD_VERSION。
