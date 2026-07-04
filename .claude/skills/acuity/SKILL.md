---
name: acuity
description: Drive the Acuity Scheduling admin panel (Massage Ithaca) via Puppeteer: scan/mark unpaid appointments, batch checkout, update prices, export clients. Dry-run default; hits production.
---

# Acuity Admin Panel Automation

Puppeteer-based browser automation for the Acuity Scheduling **admin panel**
(https://secure.acuityscheduling.com), account Massage Ithaca (ID 30472727,
logged in as jess@sulliwood.org). This replaces the blocked REST API (would
require the $49/mo Powerhouse plan) with DOM-driven automation.

**Disambiguation:** This skill automates the Acuity **admin panel UI** in a
browser. It is unrelated to `scheduling-bridge` / `acuity-middleware`
(Linear TIN-1993), which is a server-side API integration project. Do not
confuse the two — if a task mentions webhooks, API middleware, or a
scheduling bridge service, that is TIN-1993's territory, not this skill's.

## Safety Rules (non-negotiable)

1. **Dry-run by default.** Every mutating command requires an explicit
   `--execute` flag. Without it, commands only report what *would* change.
2. **No Acuity sandbox exists.** All operations hit production data for a
   real business. Prefer read-only commands (`spot-check`, `scan-client`,
   `explore`) to validate assumptions before running anything with
   `--execute`.
3. **Verify panel ID before AND after edit mode.** The Acuity SPA can swap
   the detail side-panel out from under a script; always re-check
   `verifyPanelId` before saving.
4. **Circuit breaker**: abort after 3 consecutive failures (configurable via
   `--max-failures`). Don't override this without a good reason.
5. **SAFETY abort**: if `verifyPanelId` detects the wrong appointment loaded,
   stop immediately rather than continue against a mismatched panel.
6. **Screenshot on failure** for debugging, but screenshots (and
   `exploration-results/`) contain client PII — clean them up out of
   `/tmp/acuity-admin-screenshots/` after debugging, and never commit them.
7. **The `$` prefix on calendar entries is not a reliable paid indicator.**
   Always open the detail panel and check the actual `isPaid` checkbox.
8. **Close the detail panel after every operation** to avoid the known
   stale-panel bug (closing one appointment and opening another can leave
   the old panel mounted).

## Cookie / Auth Handling

- Auth is cookie-based (`PHPSESSID`, `sentinel-session` for Squarespace SSO,
  `login_session`, `_acloggedin`). Session lifetime is ~4 hours of
  inactivity.
- Two-phase model: a rare **headed** manual login (handles reCAPTCHA
  Enterprise / OAuth) that saves `.acuity-cookies.json`, then repeated
  **headless** runs that import and validate that cookie file.
- Expiry detection must check page *content* for login-form markers
  (`Log in to Acuity`, `FORGOT PASSWORD`, `#login-form`,
  `input#username`) — Acuity re-renders the login form at the same URL
  instead of redirecting, so URL checks alone are wrong.
- `.acuity-cookies.json`, `.env`, and `*.cookies.json` are gitignored.
  **Never commit them, never print their contents, and don't relax the
  `.gitignore` entries that protect them.** No credentials are stored in
  code — auth is resolved only from env vars or the cookie file.
- Run browser automation from a host with Chrome/Chromium available and
  `CHROME_PATH` set (see repo `.claude/CLAUDE.md` for the current
  execution host). Watch for the macOS Chrome profile-picker window, which
  breaks Puppeteer's first-page assumption — see repo CLAUDE.md for the
  mitigation flags.

## Commands

This skill wraps the following slash commands 1:1 (see
`.claude/commands/*.md` for full flag reference):

- **`/acuity-login`** — Authenticate to the admin panel and manage session
  cookies. `headed` mode for manual login (reCAPTCHA/OAuth) with
  `--save-cookies`; `validate` mode to check whether the saved cookie file
  is still good. Run `validate` first before anything else.
- **`/acuity-explore`** — DOM discovery crawl across the ~20 known admin
  pages; dumps forms/buttons/tables/inputs to JSON plus screenshots for
  selector development. 6 pages (integrations, settings, forms,
  custom-appearance, embed-codes, api) are React SPAs known to time out.
  Priority target: `appointmentTypes`, whose per-type edit form selectors
  are still unmapped.
- **`/acuity-spot-check`** — Read-only. Opens N appointments for a given
  week and compares the calendar `$`-prefix hint against the real `isPaid`
  checkbox in the detail panel. No modifications are possible with this
  command; use it to sanity-check paid-status accuracy before a checkout
  run.
- **`/acuity-scan-client`** — Read-only. Scans a date range for a specific
  client's appointments and reports discrepancies (e.g. paid full price
  when a discount should have applied).
- **`/acuity-checkout`** — The batch mark-paid workflow. Scans the calendar
  week-by-week for unpaid appointments; dry-run reports only, `--execute`
  actually marks them paid, gated by the circuit breaker and panel-ID
  safety checks. Requires a valid `.acuity-cookies.json` (run
  `/acuity-login validate` first).
- **`/acuity-update-prices`** — Modifies service prices on the appointment
  types page. Requires `/acuity-explore --pages appointmentTypes --deep`
  to have already mapped the edit-form selectors into `src/selectors.ts`.
  Dry-run is mandatory for first use; take a screenshot before and after
  each price change.
- **`/acuity-export-clients`** — Scrapes the client directory (table
  scraping from `/admin/clients`, with CSV export via
  `clients.php?action=importexport` as a fallback). Output fields:
  lastName, firstName, phone, email. Phone formats are inconsistent
  (E.164, US display, leading apostrophe) — normalize before any
  downstream (e.g. Postgres) import.

## Selectors

All DOM selectors live in `src/selectors.ts`, last verified 2026-03-08.
Acuity is a mixed PHP-form + React-SPA app, so selectors drift across
deploys — re-run `/acuity-explore` against a page before trusting stale
selectors, especially for `appointmentTypes`.
