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

## Homepage hero illustration sizing (applies to the 2026-09-01 v2 homepage layout)

This spec applies to the current `index.html` hero layout (`.hero-grid` = feature list on the left + `.hero-illustration` on the right, four feature rows with icons, four-line brand header). If that layout is redesigned later, re-derive these numbers rather than reusing them as-is — they're measured against this specific structure, not a general rule.

- **Output canvas: 1380 × 1200 px, transparent-background PNG.** This is the size at the widest the illustration ever renders (the flex-grow illustration slot filling the full card width); exporting larger just wastes file size.
- **Reserve the top-left 828 × 840 px (60% × 70% of the canvas) for text/icons.** That's where the four feature rows (icons + two-line copy) sit — don't put illustration subject matter there beyond faint, low-contrast twigs/leaf tips that can tolerate text sitting on top of them.
- **Draw the main subject in the right-hand vertical strip** (right of that 60%-width line), and optionally in the horizontal band below the 70%-height line (below the feature list, still above the tagline).
- Overlapping the illustration with the text does **not** by itself make the subject bigger — the feature-list column width is unchanged, so the subject is still confined to the right-hand strip plus the band below. To make the subject visibly larger, the feature-text column would need to shrink/shorten, which is a separate content decision.
- Reference: `img/hero-illustration.png` (source, transparent) / `img/hero-illustration.webp` (background baked in at `--bg` #F5F5F4, used on the page — see comment above the `<img>` tag in `index.html`).

## Replying to the user

The user has no programming background. After finishing a change or a debugging task, reply in one or two sentences: what was done, the result, and whether the user needs to do anything (e.g. refresh the page to confirm). Don't explain technical details, code logic, or root-cause analysis. Exception: if the situation requires the user to make a decision (e.g. permission setup, missing information needed to proceed), explain that situation clearly.
