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

There's no local dev server, linter, or test command — edit the HTML files directly and open them in a browser (or push and check the live GitHub Pages site) to verify changes. Each page is fully self-contained; don't extract shared CSS/JS into separate files unless explicitly asked, since the project intentionally has no build step.

## Git workflow

This is a one-person project with no CI/CD and no review process, so don't leave work sitting on a feature branch waiting for approval. Whenever a change is finished (and, for the pages listed below, its `BUILD_VERSION` has been bumped), merge it directly into `main` and push — don't wait for the user to ask for a merge or a pull request each time.

## Booking system architecture

`booking.html` and `booking-board.html` share a booking backend that lives **outside this repo**:

- A Google Sheet (`SHEET_ID = "1-0UwxcPNxA95FFRCNICMbhheGtC5-Z9wwBGUQRaLZP0"`, sheet name `"booking"`) is the source of truth for booked slots. Both pages read it via the public gviz JSON endpoint (`.../gviz/tq?tqx=out:json&sheet=booking`).
- A Cloudflare Worker (`WEBAPP_URL` in `booking-board.html`) handles writes (booking/cancelling slots) from the admin board. Its source is not part of this repo. The admin board sends a password (entered once and cached in the browser's `localStorage`, never hardcoded in this repo since it's public) along with each write; the Worker is expected to return HTTP 403 when the password is wrong, which makes the page clear the cached password and ask again.
- Both pages hardcode `SHEET_ID`, `SHEET_NAME`, `SLOT_TIMES`, and `DAYS_TO_SHOW` near the top of their `<script>` block. **These must stay in sync across `booking.html`, `booking-board.html`, and the external Worker** — if you change the sheet, add/remove time slots, or change how many days are shown, update both files in this repo and remind the user to update the Worker.
- Both `booking.html` and `booking-board.html` have a `BUILD_VERSION` string plus a `checkForUpdate` polling mechanism that force-reloads open tabs when the version changes — bump each file's own `BUILD_VERSION` string whenever you edit that file (see "Mobile browsers showing stale cached content" below).

## Mobile browsers showing stale cached content

GitHub Pages doesn't let this repo set custom HTTP cache headers, so a phone browser (especially one that's had a page open a while, or is on a flaky connection) can keep serving an old cached copy of a page after it's been edited and pushed live — reloading doesn't always help.

The fix, applied to every page in this repo except `reply.html` (which has its own separate mechanism, see "Pages" above): a `BUILD_VERSION` string constant plus a `checkForUpdate()` function that periodically re-fetches the page's own source with `fetch(location.pathname + '?_vc=' + Date.now(), { cache: 'no-store' })` (bypassing the cache), extracts the `BUILD_VERSION` from the fetched HTML via regex, and if it differs from the currently-loaded version, force-navigates to a cache-busted URL (`?v=<version>&_r=<timestamp>`) so the browser loads the fresh page. It runs on page load, every 5 minutes, whenever the tab becomes visible again, and on `pageshow` with `persisted` (restored from the browser's back/forward cache).

**Whenever you edit `index.html`, `booking.html`, `booking-board.html`, `outfit.html`, `map.html`, or `about.html`, bump that file's own `BUILD_VERSION` string** (e.g. to the current date) — otherwise open tabs/phones won't detect the change and won't auto-reload. Each page's version is independent; they don't need to match each other. If you ever add a new page to this repo, copy this same block (from the bottom of any existing page, e.g. `outfit.html`) into it rather than leaving it without update detection.

**This mechanism only busts the cache for the HTML page itself — it does nothing for images/other assets referenced by `<img>`/`<link>` tags.** If only an image file changes (e.g. someone replaces `img/hero-illustration.webp` directly via GitHub's web upload, without touching any HTML), `BUILD_VERSION` doesn't change, so `checkForUpdate()` never fires, and browsers/GitHub Pages' CDN can keep serving the old cached image for a while even on a hard refresh or in a private window — this is expected, not a bug, and it resolves itself once the CDN cache expires. `index.html`'s hero image works around this specifically: its `<img class="hero-bg">` src carries a `?v=<date>` query string (independent of `BUILD_VERSION`, though conventionally kept in sync with it) — bump that query string too whenever `img/hero-illustration.webp` changes, so the new image gets a new URL and isn't affected by any cached copy of the old one.

## Homepage hero illustration sizing (applies to the 2026-09-03 v3 homepage layout — full-bleed background photo)

This spec applies to the current `index.html` hero layout: `.hero-grid` is `position: relative`, holding an absolutely-positioned `<img class="hero-bg">` that covers the entire grid (`object-fit: cover`, `object-position: right center`) as a full-bleed background, and the `.feature-list` (four feature rows with icons, two-line copy each) sitting directly on top of it in normal flow — two layers, image below and text above, **no scrim/gradient mask between them**. There was briefly a `.hero-bg-scrim` gradient div blocking the left half of the image so text always had a flat background; it was removed at the user's request so the illustration stays visible behind the text everywhere, relying instead on the source photo's own left-side headroom (plain wall/light background) for legibility. If that layout is redesigned later (e.g. back to a side-by-side split, or a scrim gets reintroduced), re-derive this rather than reusing it as-is — it's measured against this specific structure, not a general rule. This superseded the earlier 2026-09-01 v2 spec (side-by-side `.hero-grid` with a separate `.hero-illustration` flex column and a transparent-PNG illustration confined to the right-hand strip) — that spec no longer applies.

- **Output size: resize the delivered `img/hero-illustration.webp` to 640px wide**, height following the source photo's own aspect ratio (whatever crop is uploaded — it's changed more than once, e.g. 640×557 and 640×390 so far). The image is never displayed wider than the page's own content column (`.wrap` maxes out at 460px, so the rendered width tops out well under that), so there's no need to deliver anything close to full source resolution — 640px wide covers retina displays at that render size with margin. Re-derive this number if `.wrap`'s max-width changes.
- **The image is a full-bleed background behind everything in `.hero-grid`, including directly behind the feature-list text** — not confined to a right-hand strip, and not protected by any mask. Because of `object-position: right center`, keep the subject you most want prominent roughly in the right half to two-thirds of the source image, but the left portion is NOT safe to fill with busy/dark content either — it sits directly behind body text with no legibility backstop, so it needs to stay plain/light there (as the current photo's wall background does) or text will become hard to read.
- **No transparency needed.** The current source photo has its own baked-in background (not a transparent PNG) — that's fine, since the image itself supplies the light backdrop that keeps the overlaid text legible. A transparent PNG composited onto `--bg` would also work but isn't required.
- **Legibility check before shipping a new photo/illustration is mandatory, not optional, given there's no scrim**: screenshot the hero at a few widths (e.g. 360px, 390px, 460px) and confirm the feature-list text is readable everywhere it sits on the image — check every feature row, since a busier crop could put a dark/high-contrast area behind one row's text even if the rest looks fine. `.feature-icon` has an explicit `background: var(--bg)` so the icon glyphs stay crisp regardless of what's behind them.
- Reference: `img/hero-illustration.png` (source, as uploaded) / `img/hero-illustration.webp` (the resized delivery copy actually used on the page).

## Homepage hero background daily rotation

`index.html`'s `<img class="hero-bg" id="heroBg">` has an inline `<script>` right after it (separate from the main bottom-of-page `<script>` block) that swaps the hero background daily, purely client-side — there is no server/build step, so this can't be a cron job or a build-time step; it's computed on every page load from `Date`.

- Convention: rotation images live in `img/hero-rotation/`, named by day-of-month — `1.webp` … `31.webp` (Asia/Taipei timezone). See `img/hero-rotation/README.txt` (written for the non-technical user) for the full explanation.
- The script computes today's day-of-month in `Asia/Taipei`, builds `img/hero-rotation/<day>.webp?v=<today's date>`, and preloads it with a throwaway `Image()` probe; only on `onload` does it overwrite `heroBg.src`. If that day's file doesn't exist (404), the probe's `onload` never fires and the page just keeps showing the static `src` already on the tag (`img/hero-illustration.webp`) — this is the fallback/default image, so partially-populated rotation folders (e.g. only a few days uploaded so far) never break the layout or show a broken-image icon.
- The `?v=<date>` query string is computed from `Date`, not from `BUILD_VERSION` — this is deliberate. The same filename (e.g. `15.webp`) recurs every month, so a plain unversioned URL could get stuck on a stale GitHub Pages CDN/browser cache if the user replaces that file's content; stamping today's date on the query string forces a fresh fetch once per day without needing any manual cache-bust.
- **Do not bump `BUILD_VERSION` for daily image rotation** — that's the whole point of this mechanism (the user asked for zero code/HTML touches per day). Only bump `BUILD_VERSION` (per "Mobile browsers showing stale cached content" above) when the rotation *script logic itself* changes, same as any other edit to `index.html`.
- The sizing/legibility rules in "Homepage hero illustration sizing" above apply to every rotation image, not just the static fallback — right half/two-thirds for the main subject, plain/light on the left where feature-list text sits on top, since there's still no scrim.
- The user manages rotation images entirely by uploading/replacing files under `img/hero-rotation/` on GitHub — no HTML edits needed for that. Only touch `index.html` here if the rotation *mechanism* itself needs to change (e.g. a different rotation scheme).

## Replying to the user

The user has no programming background. After finishing a change or a debugging task, reply in one or two sentences: what was done, the result, and whether the user needs to do anything (e.g. refresh the page to confirm). Don't explain technical details, code logic, or root-cause analysis. Exception: if the situation requires the user to make a decision (e.g. permission setup, missing information needed to proceed), explain that situation clearly.
