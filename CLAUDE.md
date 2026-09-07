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

All pages above except `reply.html` share the same `BUILD_VERSION` auto-reload mechanism (see "Mobile browsers showing stale cached content" below). `reply.html` predates that pattern and instead does its own HEAD-request + ETag/Last-Modified comparison to detect updates — leave it as-is rather than converting it, it works the same way in practice.

## Working with this repo

There's no local dev server, linter, or test command — edit the HTML files directly and open them in a browser (or push and check the live GitHub Pages site) to verify changes. Each page is fully self-contained; don't extract shared CSS/JS into separate files unless explicitly asked, since the project intentionally has no build step. The one exception is `tools/build-fonts.py`, which regenerates the per-page font subsets — see "Fonts" below; it is run by hand and its output is committed, so deployment is still "push and it's live".

## Fonts — per-page subsets, and when you must rebuild them

The site self-hosts Noto Sans TC / Noto Serif TC rather than loading Google Fonts (a Google Fonts `<link>` for CJK is render-blocking and enormous — don't add one back). Traditional Chinese webfonts are the single heaviest thing this site ships, so they are subset **per page**:

- `fonts/noto-*.woff2` — the **source** files: one subset per weight covering the union of all pages' text (900–1000 glyphs, ~150–200 KB each). **No HTML references these any more.** They are kept as the master to re-subset from, exactly like the `.png` originals in `img/`. Don't delete them; without them a future rebuild would have to start from nothing.
- `fonts/page/<page>-<family>-<weight>.woff2` — what the pages actually load. Each holds only the characters that page can display, so a page ships 14–133 KB per weight instead of 150–200 KB.
- `fonts/work-sans-*.woff2` and `fonts/space-grotesk-*.woff2` are referenced by nothing at all (`booking-board.html` names `'Work Sans'` in a `font-family` but never declares an `@font-face`, so it has always rendered in a system font). Left in place, not wired up.

**★ Whenever you change text that appears on a page — body copy, `alt`/`title`, or a Chinese string inside a `<script>` — re-run the subsetter:**

```
pip install fonttools brotli     # once
python3 tools/build-fonts.py
```

It rewrites everything under `fonts/page/` and prints each page's character count and size. If you skip it, characters you just added aren't in the subset and fall back to the system font — not blank boxes (every `font-family` stack ends with `"PingFang TC","Microsoft JhengHei"` / `"Songti TC","PMingLiU"` for exactly this reason), but visibly mismatched weight next to the rest of the line.

`tools/build-fonts.py` also holds the map of which weights each page uses (`PAGES`). **If you change a `font-family` or `font-weight` in a page's CSS, update `PAGES` too**, then re-run it and repoint that page's `@font-face` / `<link rel="preload">` — a weight that has no matching `@font-face` silently gets synthesised by the browser, and a `preload` for a file the page never uses is pure wasted bandwidth (`map.html` shipped a 196 KB preload of a 900 weight nothing used, for a while).

This is the one build-ish step in the repo. It does not run at deploy time — the generated `.woff2` files are committed, and GitHub Pages still serves everything as-is.

## Git workflow

This is a one-person project with no CI/CD and no review process, so don't leave work sitting on a feature branch waiting for approval. Whenever a change is finished (and, for the pages listed below, its `BUILD_VERSION` has been bumped), merge it directly into `main` and push — don't wait for the user to ask for a merge or a pull request each time.

## Booking system architecture

`booking.html` and `booking-board.html` share a booking backend that lives **outside this repo**:

- A Google Sheet (`SHEET_ID = "1-0UwxcPNxA95FFRCNICMbhheGtC5-Z9wwBGUQRaLZP0"`, sheet name `"booking"`) is the source of truth for booked slots. Both pages read it via the public gviz JSON endpoint (`.../gviz/tq?tqx=out:json&sheet=booking`).
- A Cloudflare Worker (`WEBAPP_URL` in `booking-board.html`) handles writes (booking/cancelling slots) from the admin board. Its source lives in `worker/` (see `worker/README.md` for deploy steps) — editing it here changes nothing until someone runs `wrangler deploy`. It accepts `POST` only: an unauthenticated `GET` handler that dumped the whole `booking!A1:F400` to anyone who knew the URL was removed on 2026-09-07 (the frontend never used it — both pages read the sheet through the public gviz endpoint instead). The admin board sends a password (entered once and cached in the browser's `localStorage`, never hardcoded in this repo since it's public) along with each write; the Worker is expected to return HTTP 403 when the password is wrong, which makes the page clear the cached password and ask again.
- Both pages hardcode `SHEET_ID`, `SHEET_NAME`, `SLOT_TIMES`, and `DAYS_TO_SHOW` near the top of their `<script>` block. **These must stay in sync across `booking.html`, `booking-board.html`, and the external Worker** — if you change the sheet, add/remove time slots, or change how many days are shown, update both files in this repo and remind the user to update the Worker.
- Both `booking.html` and `booking-board.html` have a `BUILD_VERSION` string plus a `checkForUpdate` polling mechanism that force-reloads open tabs when the version changes — bump each file's own `BUILD_VERSION` string whenever you edit that file (see "Mobile browsers showing stale cached content" below).

## Mobile browsers showing stale cached content

GitHub Pages doesn't let this repo set custom HTTP cache headers, so a phone browser (especially one that's had a page open a while, or is on a flaky connection) can keep serving an old cached copy of a page after it's been edited and pushed live — reloading doesn't always help.

The fix, applied to every page in this repo except `reply.html` (which has its own separate mechanism, see "Pages" above): a `BUILD_VERSION` string constant plus a `checkForUpdate()` function that periodically re-fetches the page's own source with `fetch(location.pathname + '?_vc=' + Date.now(), { cache: 'no-store' })` (bypassing the cache), extracts the `BUILD_VERSION` from the fetched HTML via regex, and if it differs from the currently-loaded version, force-navigates to a cache-busted URL (`?v=<version>&_r=<timestamp>`) so the browser loads the fresh page. It runs 1.5s after `load`, every 30 minutes, whenever the tab becomes visible again, and on `pageshow` with `persisted` (restored from the browser's back/forward cache).

Two details in that block are deliberate and must stay identical across all six pages — they were added to `index.html` first and the other five drifted for a while without them:

- **The first check is deferred until after `load`, then another 1.5s.** The check re-downloads the entire HTML; firing it during initial parse makes it compete with fonts and images and visibly slows first paint on a slow connection.
- **A 20-second reload cooldown** (`RELOAD_COOLDOWN_MS`, tracked in `sessionStorage` under `hc_last_reload`). In the minutes right after a deploy, GitHub Pages' CDN nodes serve old and new content inconsistently; without the cooldown a tab can bounce between versions, and PageSpeed Insights gets navigated away mid-analysis and hangs.

The 30-minute interval (rather than 5) matters because each check costs a full HTML download — `booking-board.html` is 122 KB, so a board left open all day was burning several MB of mobile data for nothing.

**Whenever you edit `index.html`, `booking.html`, `booking-board.html`, `outfit.html`, `map.html`, or `about.html`, bump that file's own `BUILD_VERSION` string** (e.g. to the current date) — otherwise open tabs/phones won't detect the change and won't auto-reload. Each page's version is independent; they don't need to match each other. If you ever add a new page to this repo, copy this same block (from the bottom of any existing page, e.g. `outfit.html`) into it rather than leaving it without update detection.

**This mechanism only busts the cache for the HTML page itself — it does nothing for images/other assets referenced by `<img>`/`<link>` tags.** If only an image file changes (e.g. someone replaces `img/hero-illustration.webp` directly via GitHub's web upload, without touching any HTML), `BUILD_VERSION` doesn't change, so `checkForUpdate()` never fires, and browsers/GitHub Pages' CDN can keep serving the old cached image for a while even on a hard refresh or in a private window — this is expected, not a bug, and it resolves itself once the CDN cache expires. `index.html`'s hero image works around this specifically: its `<img class="hero-bg">` src carries a `?v=<date>` query string (independent of `BUILD_VERSION`, though conventionally kept in sync with it) — bump that query string too whenever `img/hero-illustration.webp` changes, so the new image gets a new URL and isn't affected by any cached copy of the old one.

## Homepage hero illustration sizing (applies to the 2026-09-06 v4 homepage layout — full-bleed background photo extended through the tagline)

This spec applies to the current `index.html` hero layout: `.hero-grid` is `display:flex; flex-direction:column; position:relative`, holding an absolutely-positioned `<img class="hero-bg">` that covers the entire grid (`object-fit: cover`, `object-position: right center`) as a full-bleed background. Two flow children sit on top of it, stacked vertically: the `.feature-list` (four feature rows with icons, two-line copy each) and, directly below it inside the same `.hero-grid`, the `.tagline` line ("專業拍攝｜自然修圖｜快速取件"). `.tagline` uses `align-self: stretch` so it still spans the full width and stays centered even though the parent flex column would otherwise shrink it to its own text width. The image now extends all the way down to the top of `.menu`'s border — `.menu`'s old `margin-top: 20px` was moved onto `.tagline`'s `margin-bottom` specifically so that spacing is inside `.hero-grid` (and thus covered by the image) instead of sitting after it. There is still **no scrim/gradient mask** between image and text — a `.hero-bg-scrim` was tried once and removed at the user's request, relying instead on the source photo's own headroom (plain wall/light background) for legibility. If this layout is redesigned later (a side-by-side split, a scrim reintroduced, the tagline moved back out), re-derive this rather than reusing it as-is — it's measured against this specific structure, not a general rule. This superseded the earlier 2026-09-03 v3 spec (image covered only `.feature-list`'s height, stopping above `.tagline`) and the 2026-09-01 v2 spec (side-by-side `.hero-grid` with a separate `.hero-illustration` flex column) — neither applies anymore.

- **Output size: resize the delivered `img/hero-illustration.webp` to 640px wide, ~420–435px tall** (height following the source photo's own aspect ratio/crop — the covered box's actual on-page aspect ratio is about 412:272 at the widest content column, so anywhere in that height range for a 640px-wide delivery is close enough; `object-fit: cover` absorbs the rest). This is taller than the pre-2026-09-06 deliveries (e.g. 640×557, 640×390) because the covered area now runs through the tagline line down to the top of the nav menu's divider, not just through the feature list. The image is never displayed wider than the page's own content column (`.wrap` maxes out at 460px, so the rendered width tops out well under that) — 640px wide still covers retina displays at that render size with margin. Re-derive these numbers if `.wrap`'s max-width changes or the layout changes again.
- **The image is a full-bleed background behind everything in `.hero-grid`, including directly behind the feature-list text and the tagline line** — not confined to a right-hand strip, and not protected by any mask. Because of `object-position: right center`, keep the subject you most want prominent roughly in the right half to two-thirds of the source image, but the left portion is NOT safe to fill with busy/dark content either — it sits directly behind body text with no legibility backstop, so it needs to stay plain/light there (as the current photo's wall background does) or text will become hard to read. Unlike the feature rows (confined to the left ~half of the width), `.tagline` is centered and spans the **full width**, so the newly-extended bottom strip needs to stay plain/light all the way across, not just on the left — e.g. a tabletop/surface below the subject works well here.
- **No transparency needed.** The current source photo has its own baked-in background (not a transparent PNG) — that's fine, since the image itself supplies the light backdrop that keeps the overlaid text legible. A transparent PNG composited onto `--bg` would also work but isn't required.
- **Legibility check before shipping a new photo/illustration is mandatory, not optional, given there's no scrim**: screenshot the hero at a few widths (e.g. 360px, 390px, 460px) and confirm the feature-list text *and* the tagline line are readable everywhere they sit on the image — check every feature row plus the tagline, since a busier crop could put a dark/high-contrast area behind one row's (or the tagline's) text even if the rest looks fine. `.feature-icon` has an explicit `background: var(--bg)` so the icon glyphs stay crisp regardless of what's behind them.
- Reference: `img/hero-illustration.png` (source, as uploaded) / `img/hero-illustration.webp` (the resized delivery copy actually used on the page).

**Status as of 2026-09-06 (pending):** the layout change above (image extended down through the tagline) is done and merged to `main`, but `img/hero-illustration.webp` itself is still the old pre-2026-09-06 file (640×390, gradient/blend running out too soon below the flower). The user is preparing a replacement photo — same flower position/size, just with extra canvas below it so the gradient into the background has room to blend — target size per the bullet above (640px wide, ~420–435px tall). Until that replacement is uploaded, the site still works (the old image just gets cropped a bit more by `object-fit: cover` to fill the taller box) but doesn't yet show the intended extra blend room. When the user provides the new file: replace `img/hero-illustration.webp` (and bump its `?v=` query string in `index.html` per "Mobile browsers showing stale cached content" above — `BUILD_VERSION` bump is optional here since only the image is changing, not the HTML/CSS, but bump it anyway if you touch `index.html` to update the query string), then do the legibility screenshot check from the bullet above before calling it done.

## Image assets in `img/`

Most icons/photos in `img/` exist as a pair: a `.png` (the original file as uploaded/exported, kept as the editable source) and a `.webp` (a resized/compressed copy actually referenced by the HTML pages — smaller file size for faster loads). Only the `.webp` files are referenced anywhere in the site; grepping the HTML for `.png` turns up nothing. This applies to the feature icons (`feature-tag`, `feature-mail`, `feature-clock`, `feature-monitor`), the nav icons (`nav-about`, `nav-calendar`, `nav-facebook`, `nav-faq`, `nav-instagram`, `nav-map`, `nav-send`), and the hero illustration (`hero-illustration`) — see also the "Reference" bullet under "Homepage hero illustration sizing" above, which documents this same png-source/webp-delivery split specifically for the hero image.

The two photos in `images/` follow the same convention with JPG as the source: `about-story-1.jpg` / `about-story-2.jpg` are the originals, and `about-story-1.webp` / `about-story-2.webp` (quality 82) are what `about.html`'s `<img>` tags load. Note these JPGs only compress about 25% going to WebP, not the ~50% typical of PNG sources — they were already efficiently encoded. `about.html`'s `og:image` / `twitter:image` / JSON-LD `image` intentionally still point at the **`.jpg`**: social preview crawlers' WebP support is inconsistent, and a share card with no thumbnail is worse than a slightly larger one.

**Don't delete the `.png` files as "unused."** They're unused by the *website*, but they're the original/uneditable-history source for each icon — if the user ever wants a bigger export, a different crop, or to hand the original to a designer, the `.png` is what that comes from. If the `.webp` were the only copy left, any future edit would have to start from a lossy, already-shrunk file. Only delete a `.png` if the user confirms they have the original saved elsewhere (or explicitly says they don't need it) — this is a one-way, hard-to-reverse cleanup since nothing in this repo's history is treated as a design archive.

## Homepage hero background daily rotation

`index.html`'s `<img class="hero-bg" id="heroBg">` has an inline `<script>` right after it (separate from the main bottom-of-page `<script>` block) that swaps the hero background daily, purely client-side — there is no server/build step, so this can't be a cron job or a build-time step; it's computed on every page load from `Date`.

- Convention: rotation images live in `img/hero-rotation/`, named by zero-padded day-of-month — `01.webp` … `31.webp` (Asia/Taipei timezone). See `img/hero-rotation/README.txt` (written for the non-technical user) for the full explanation.
- **The `<img>` deliberately ships with no `src` attribute.** The inline script immediately after it computes today's day-of-month in `Asia/Taipei`, sets `img.onerror` to fall back to `img/hero-illustration.webp`, and then assigns `img.src = 'img/hero-rotation/<day>.webp?v=<today's date>'`. Because the script runs synchronously during parse, the fetch starts essentially as early as a plain `src` would have. If that day's file doesn't exist (404) `onerror` swaps in the default image, so partially-populated rotation folders (e.g. only a few days uploaded so far) never break the layout or show a broken-image icon. A `<noscript>` copy of the default image covers JS-disabled browsers.
- This replaced (2026-09-07) an earlier version that left the default image in `src` and loaded the day's image separately through a throwaway `Image()` probe, swapping it in on `onload`. That downloaded *both* images on every visit (~60 KB where ~30 KB was needed) and delayed the image actually shown until the second download finished. **Don't reintroduce a probe** — the `onerror` fallback covers the missing-file case with one request instead of two.
- The `?v=<date>` query string is computed from `Date`, not from `BUILD_VERSION` — this is deliberate. The same filename (e.g. `15.webp`) recurs every month, so a plain unversioned URL could get stuck on a stale GitHub Pages CDN/browser cache if the user replaces that file's content; stamping today's date on the query string forces a fresh fetch once per day without needing any manual cache-bust.
- **Do not bump `BUILD_VERSION` for daily image rotation** — that's the whole point of this mechanism (the user asked for zero code/HTML touches per day). Only bump `BUILD_VERSION` (per "Mobile browsers showing stale cached content" above) when the rotation *script logic itself* changes, same as any other edit to `index.html`.
- The sizing/legibility rules in "Homepage hero illustration sizing" above apply to every rotation image, not just the static fallback — right half/two-thirds for the main subject, plain/light across the full width where the feature-list text and the tagline line sit on top, since there's still no scrim.
- The user manages rotation images entirely by uploading/replacing files under `img/hero-rotation/` on GitHub — no HTML edits needed for that. Only touch `index.html` here if the rotation *mechanism* itself needs to change (e.g. a different rotation scheme).

## Replying to the user

The user has no programming background. After finishing a change or a debugging task, reply in one or two sentences: what was done, the result, and whether the user needs to do anything (e.g. refresh the page to confirm). Don't explain technical details, code logic, or root-cause analysis. Exception: if the situation requires the user to make a decision (e.g. permission setup, missing information needed to proceed), explain that situation clearly.
