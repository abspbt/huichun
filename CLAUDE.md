# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Static marketing/booking site for 回春視務所 (Hui Chun Photo), an ID-photo studio in Kaohsiung. There is no build system, package manager, or test suite — this is a small set of self-contained, hand-authored HTML files (inline `<style>` and `<script>`, no external JS bundles) deployed as-is via GitHub Pages to `hui-chun.com` (see `CNAME`).

## Pages

- `index.html` — public landing page, links out to the other pages plus Instagram/Facebook/LINE.
- `booking.html` — customer-facing booking wizard (pick people count → pick time slots → confirm). No update/version-check logic.
- `booking-board.html` — admin-facing booking board. Same slot data as `booking.html` but adds a theme switcher and a build-version auto-reload mechanism (see below).
- `outfit.html` — ID photo requirements and outfit advice.
- `map.html` — directions/transit guide.

## Working with this repo

There's no local dev server, linter, or test command — edit the HTML files directly and open them in a browser (or push and check the live GitHub Pages site) to verify changes. Each page is fully self-contained; don't extract shared CSS/JS into separate files unless explicitly asked, since the project intentionally has no build step.

## Booking system architecture

`booking.html` and `booking-board.html` share a booking backend that lives **outside this repo**:

- A Google Sheet (`SHEET_ID = "1-0UwxcPNxA95FFRCNICMbhheGtC5-Z9wwBGUQRaLZP0"`, sheet name `"booking"`) is the source of truth for booked slots. Both pages read it via the public gviz JSON endpoint (`.../gviz/tq?tqx=out:json&sheet=booking`).
- A Cloudflare Worker (`WEBAPP_URL` in `booking-board.html`) handles writes (booking/cancelling slots) from the admin board. Its source is not part of this repo. The admin board sends a password (entered once and cached in the browser's `localStorage`, never hardcoded in this repo since it's public) along with each write; the Worker is expected to return HTTP 403 when the password is wrong, which makes the page clear the cached password and ask again.
- Both pages hardcode `SHEET_ID`, `SHEET_NAME`, `SLOT_TIMES`, and `DAYS_TO_SHOW` near the top of their `<script>` block. **These must stay in sync across `booking.html`, `booking-board.html`, and the external Worker** — if you change the sheet, add/remove time slots, or change how many days are shown, update both files in this repo and remind the user to update the Worker.
- `booking-board.html` has a `BUILD_VERSION` string plus a `checkForUpdate` polling mechanism that force-reloads open admin tabs when the version changes — bump this string whenever you edit `booking-board.html`. `booking.html` deliberately does not have this mechanism (customer-facing page doesn't need it).

## Mobile browsers showing stale cached content

GitHub Pages doesn't let this repo set custom HTTP cache headers, so a phone browser (especially one that's had a page open a while, or is on a flaky connection) can keep serving an old cached copy of a page after it's been edited and pushed live — reloading doesn't always help.

The fix already used on `booking-board.html`: a `BUILD_VERSION` string constant plus a `checkForUpdate()` function that periodically re-fetches the page's own source with `fetch(location.pathname + '?_vc=' + Date.now(), { cache: 'no-store' })` (bypassing the cache), extracts the `BUILD_VERSION` from the fetched HTML via regex, and if it differs from the currently-loaded version, force-navigates to a cache-busted URL (`?v=<version>&_r=<timestamp>`) so the browser loads the fresh page. It runs on page load, every 5 minutes, whenever the tab becomes visible again, and on `pageshow` with `persisted` (restored from the browser's back/forward cache).

When to use it: only on a page someone might leave open for a long time and that needs to auto-refresh without a manual reload — currently just `booking-board.html` (the admin board). Customer-facing pages (`booking.html`, `index.html`, `outfit.html`, `map.html`, `about.html`, `reply.html`) intentionally skip it, since customers reopen the link each visit rather than leaving a tab open for hours. If a specific customer-facing page starts having a genuine "phone keeps showing the old version" complaint, add the same `BUILD_VERSION` + `checkForUpdate` pattern to that page (copy it from `booking-board.html`) rather than researching a new approach — and remember to bump that page's `BUILD_VERSION` every time it's edited afterward, or the check won't detect anything changed.

## Replying to the user

The user has no programming background. After finishing a change or a debugging task, reply in one or two sentences: what was done, the result, and whether the user needs to do anything (e.g. refresh the page to confirm). Don't explain technical details, code logic, or root-cause analysis. Exception: if the situation requires the user to make a decision (e.g. permission setup, missing information needed to proceed), explain that situation clearly.
