# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Static marketing/booking site for 回春視務所 (Hui Chun Photo), an ID-photo studio in Kaohsiung. There is no build system, package manager, or test suite — this is a small set of self-contained, hand-authored HTML files (inline `<style>` and `<script>`, no external JS bundles) deployed as-is via GitHub Pages to `hui-chun.com` (see `CNAME`).

## Pages

- `index.html` — public landing page, links out to the other pages plus Instagram/Facebook/LINE.
- `booking.html` — customer-facing booking wizard (pick people count → pick time slots → confirm).
- `booking-board.html` — admin-facing booking board. Same slot data as `booking.html` but adds a theme switcher.
- `outfit.html` — ID photo requirements and outfit advice.
- `map.html` — directions/transit guide.
- `about.html` — about/studio intro page.
- `reply.html` — internal staff tool (quick-reply message generator), not linked from the public site.

The two non-public pages, `booking-board.html` and `reply.html`, each carry `<meta name="robots" content="noindex, nofollow">` **and** a `Disallow` line in `robots.txt` — both spellings of each URL, with and without `.html`, since GitHub Pages serves either. Keep both for any page added later that shouldn't be found: `robots.txt` only asks crawlers not to fetch, `noindex` is what actually keeps a page out of results if someone links to it.

## Working with this repo

There's no local dev server, linter, or test command — edit the HTML files directly and open them in a browser (or push and check the live GitHub Pages site) to verify changes. Each page is fully self-contained; don't extract shared CSS/JS into separate files unless explicitly asked, since the project intentionally has no build step. The one exception is `tools/build-fonts.py` (see "Fonts" below); it is run by hand and its output is committed, so deployment is still "push and it's live".

**Internal links are written without the `.html` extension** (`href="/booking"`, not `href="booking.html"` or an absolute `https://hui-chun.com/booking`), matching each page's `<link rel="canonical">` and the URLs in `sitemap.xml` and `llms.txt`. GitHub Pages serves both spellings, so a mix works but splits the page's ranking signal between two URLs.

## Git workflow

This is a one-person project with no CI/CD and no review process, so don't leave work sitting on a feature branch waiting for approval. Whenever a change is finished (and, for the pages listed under "Mobile browsers showing stale cached content", its `BUILD_VERSION` has been bumped), merge it directly into `main` and push — don't wait for the user to ask for a merge or a pull request each time.

## Fonts — per-page subsets, and when you must rebuild them

The site self-hosts Noto Sans TC / Noto Serif TC rather than loading Google Fonts (a Google Fonts `<link>` for CJK is render-blocking and enormous — don't add one back). Traditional Chinese webfonts are the heaviest thing this site ships, so they are subset **per page**:

- `fonts/noto-*.woff2` — the **source** masters: one subset per weight covering the union of all pages' text (~150–200 KB each). No HTML references them; they are kept to re-subset from, like the `.png` originals in `img/`. Don't delete them. If the build script warns that a master is missing characters, regenerate that master from Google's variable font (`ofl/notosanstc/NotoSansTC[wght].ttf` in the google/fonts repo; `raw.githubusercontent.com` is reachable): instantiate the weight with `fontTools.varLib.instancer`, then `pyftsubset` it to the union of all pages' text plus the master's existing characters.
- `fonts/page/<page>-<family>-<weight>.woff2` — what the pages actually load. Each holds only the characters that page can display (14–133 KB per weight).
- `fonts/work-sans-*.woff2` and `fonts/space-grotesk-*.woff2` are referenced by nothing. Left in place, not wired up.

**★ Whenever you change text that appears on a page — body copy, `alt`/`title`, or a Chinese string inside a `<script>` — re-run the subsetter:**

```
pip install fonttools brotli     # once
python3 tools/build-fonts.py
```

It rewrites everything under `fonts/page/` and prints each page's character count and size. If you skip it, newly added characters fall back to the system font (every `font-family` stack ends with `"PingFang TC","Microsoft JhengHei"` / `"Songti TC","PMingLiU"` for this reason) — not blank boxes, but visibly mismatched next to the rest of the line.

`tools/build-fonts.py` also holds the map of which weights each page uses (`PAGES`). **If you change a `font-family` or `font-weight` in a page's CSS, update `PAGES` too**, then re-run it and repoint that page's `@font-face` / `<link rel="preload">` — a weight with no matching `@font-face` gets synthesised by the browser, and a `preload` for a file the page never uses is wasted bandwidth.

## Booking system architecture

`booking.html` and `booking-board.html` share a booking backend: a Cloudflare Worker (`crimson-dream-d3cf`, source in `worker/`, see `worker/README.md`) backed by a **Cloudflare D1** database (`huichun-booking`, bound as `DB`).

- Table `bookings (date, time)` — one row = one locked (unbookable) slot. Both pages read via the Worker's public `GET /bookings?from=&to=` (returns only dates/times, no customer data). The admin board writes via `POST /` with `{date, time, action: "lock"|"unlock", password}`; `time` may be `"ALL"` for a whole day. Tapping a slot on the board toggles it; tapping the date toggles the whole day.
- `booking-board.html` loads `FAR_DAYS` (365) days: after the normal 15-day list it lists any later date that has locks, then a "選擇其他日期" date picker + "顯示" button so the user can close dates months ahead. Picked dates with no locks get a "隱藏" button to dismiss them. The picker lives outside the re-rendered `cardsBox` and only acts on the button, never on `change`: iOS Safari closes an open date picker if its element is detached, and fills in today + fires `change` the moment the picker opens.
- The admin password is the Worker's `ADMIN_TOKEN` secret (Cloudflare dashboard → Workers & Pages → `crimson-dream-d3cf` → Settings → Variables and Secrets), cached in the board's `localStorage`, never in this repo (it's public). Wrong password → HTTP 403 → the page clears the cache and asks again.
- The data was migrated from an old Google Sheet into D1 on 2026-09-26 (recorded in the `meta` table, so it never runs again). The Worker still contains that one-time import code; the `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` / `SPREADSHEET_ID` secrets are no longer needed.
- Deployment: the Worker is connected to this repo via Cloudflare Workers Builds (production branch `main`, root directory `/`, no build command, deploy command `npx wrangler deploy --config worker/wrangler.toml`), so every push to `main` redeploys it. Keep the `[[d1_databases]]` and `[observability]` blocks in `worker/wrangler.toml` — a deploy without them removes the dashboard-configured binding / turns logs off.
- `SLOT_TIMES` and `DAYS_TO_SHOW` are hardcoded near the top of both pages' `<script>` blocks and must stay in sync; `SLOT_TIMES` must also match `worker/booking-worker.js`.

## Mobile browsers showing stale cached content

GitHub Pages doesn't let this repo set custom HTTP cache headers, so a phone browser can keep serving an old cached copy of a page after it's been edited and pushed — reloading doesn't always help.

The fix, on every page except `reply.html`: a `BUILD_VERSION` string constant plus a `checkForUpdate()` function that re-fetches the page's own source with `fetch(location.pathname + '?_vc=' + Date.now(), { cache: 'no-store' })`, extracts `BUILD_VERSION` from it via regex, and if it differs from the loaded version, navigates to a cache-busted URL (`?v=<version>&_r=<timestamp>`). It runs 1.5s after `load`, every 30 minutes, when the tab becomes visible again, and on `pageshow` with `persisted`. (`reply.html` instead does its own HEAD-request + ETag/Last-Modified comparison — leave it as-is.)

Keep these details identical across all six pages:

- **The first check is deferred until after `load`, then another 1.5s**, so the HTML re-download doesn't compete with fonts and images during first paint.
- **A 20-second reload cooldown** (`RELOAD_COOLDOWN_MS`, tracked in `sessionStorage` under `hc_last_reload`). Right after a deploy, GitHub Pages' CDN serves old and new content inconsistently; without the cooldown a tab can bounce between versions, and PageSpeed Insights hangs.
- **The 30-minute interval** — each check is a full HTML download (`booking-board.html` is ~130 KB), so shorter intervals burn mobile data on a board left open all day.

**Whenever you edit `index.html`, `booking.html`, `booking-board.html`, `outfit.html`, `map.html`, or `about.html`, bump that file's own `BUILD_VERSION` string** (e.g. to the current date) — otherwise open tabs won't auto-reload. Each page's version is independent. If you add a new page, copy this block from the bottom of an existing page (e.g. `outfit.html`).

**This only busts the cache for the HTML page itself, not images.** If only an image file changes (e.g. the user uploads a replacement via GitHub's web UI), browsers/the CDN may keep serving the old image for a while even on a hard refresh — expected, resolves itself when the cache expires. Images whose URL carries a `?v=` query string (the hero fallback image in `index.html`) can be force-refreshed by bumping that query string.

## Homepage hero

`.hero-grid` (`display:flex; flex-direction:column; position:relative`) holds an absolutely-positioned `<img class="hero-bg">` covering the whole grid (`object-fit: cover`, `object-position: right center`) as a full-bleed background. On top of it sit the `.feature-list` (four feature rows) and the `.tagline` ("專業拍攝｜自然修圖｜快速取件", `align-self: stretch` so it spans the full width and stays centered). The image runs down to the top of `.menu`'s border — the spacing above the menu is `.tagline`'s `margin-bottom` so it's covered by the image. There is **no scrim/gradient mask** (one was tried and removed at the user's request); legibility relies on the photo's own plain/light background.

### Image requirements (static fallback and every rotation image)

- **Size: 640px wide, ~420–435px tall.** The covered box is about 412:272 at the widest content column (`.wrap` max-width 460px); `object-fit: cover` absorbs small differences. Re-derive if `.wrap`'s max-width or the layout changes.
- **Composition:** main subject roughly in the right half to two-thirds. The left side sits directly behind the feature-list text and must stay plain/light; the bottom strip sits behind the full-width centered tagline and must stay plain/light all the way across (e.g. a tabletop below the subject). No transparency needed.
- **Legibility check before shipping a new image is mandatory:** screenshot the hero at e.g. 360px, 390px, 460px and confirm every feature row and the tagline are readable. `.feature-icon` has `background: var(--bg)` so icons stay crisp regardless.

### Daily rotation

The `<img class="hero-bg" id="heroBg">` has an inline `<script>` right after it that swaps the image daily, client-side (no server or build step).

- Rotation images live in `img/hero-rotation/`, named by zero-padded day-of-month — `01.webp` … `31.webp` (Asia/Taipei timezone). See `img/hero-rotation/README.txt` (written for the user).
- **The `<img>` deliberately has no `src`.** The script computes today's day in `Asia/Taipei`, sets `img.onerror` to fall back to `img/hero-illustration.webp`, then assigns `img.src = 'img/hero-rotation/<day>.webp?v=<today's date>'`. A missing day's file just shows the fallback. A `<noscript>` copy of the fallback covers JS-disabled browsers. **Don't reintroduce a separate `Image()` probe** — it downloads two images per visit; the `onerror` fallback needs only one request.
- The `?v=<date>` is computed from `Date`, not `BUILD_VERSION`, so a replaced file (same name recurs monthly) is refetched at least once a day.
- **Do not bump `BUILD_VERSION` for daily rotation or for the user replacing rotation images** — the user manages them entirely by uploading files under `img/hero-rotation/`. Only touch `index.html` (and bump `BUILD_VERSION`) if the rotation script itself changes.
- If `img/hero-illustration.webp` (the fallback) is replaced, bump its `?v=` query string in `index.html` (both in the script's `FALLBACK` and the `<noscript>` `<img>`).

## Image assets

Icons in `img/` exist as a pair: a `.png` (the original as uploaded, kept as the editable source) and a `.webp` (resized/compressed copy that the HTML actually references). This applies to the feature icons (`feature-tag`, `feature-mail`, `feature-clock`, `feature-monitor`) and nav icons (`nav-about`, `nav-calendar`, `nav-facebook`, `nav-faq`, `nav-instagram`, `nav-map`, `nav-send`). The hero images (`img/hero-illustration.webp`, `img/hero-rotation/*.webp`) have no `.png` source in the repo.

The two photos in `images/` use JPG as the source: `about-story-1.jpg` / `about-story-2.jpg` are the originals, and the `.webp` copies (quality 82) are what `about.html`'s `<img>` tags load. `about.html`'s `og:image` / `twitter:image` / JSON-LD `image` intentionally still point at the **`.jpg`**: social preview crawlers' WebP support is inconsistent.

**Don't delete the `.png`/`.jpg` sources as "unused."** They're unused by the website but are the originals any future edit should start from. Only delete one if the user confirms they have the original saved elsewhere or explicitly says they don't need it.

## Replying to the user

The user has no programming background. After finishing a change or a debugging task, reply in one or two sentences: what was done, the result, and whether the user needs to do anything (e.g. refresh the page to confirm). Don't explain technical details, code logic, or root-cause analysis. Exception: if the situation requires the user to make a decision (e.g. permission setup, missing information needed to proceed), explain that situation clearly.
