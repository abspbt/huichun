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
- A Google Apps Script Web App (`WEBAPP_URL` in `booking-board.html`, ending in `/exec`) handles writes (booking/cancelling slots) from the admin board. Its source (`Code.gs`) is not part of this repo.
- Both pages hardcode `SHEET_ID`, `SHEET_NAME`, `SLOT_TIMES`, and `DAYS_TO_SHOW` near the top of their `<script>` block. **These must stay in sync across `booking.html`, `booking-board.html`, and the external `Code.gs`** — if you change the sheet, add/remove time slots, or change how many days are shown, update all relevant files (the two in this repo, and remind the user to update `Code.gs`).
- `booking-board.html` has a `BUILD_VERSION` string plus a `checkForUpdate` polling mechanism that force-reloads open admin tabs when the version changes — bump this string whenever you edit `booking-board.html`. `booking.html` deliberately does not have this mechanism (customer-facing page doesn't need it).
