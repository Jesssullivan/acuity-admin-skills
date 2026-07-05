# AGENTS.md

Codex / OMO / non-Claude harness contract for **acuity-admin-skills**. This
mirrors `.claude/skills/acuity/SKILL.md`; when the two disagree, SKILL.md wins.

## What this repo is

Puppeteer (via `puppeteer-core`) automation of the **Acuity Scheduling admin
panel** (`https://secure.acuityscheduling.com`) for the business **Massage
Ithaca** (account ID 30472727, operator jess@sulliwood.org). It drives the
vendor admin UI in a real Chrome/Chromium browser because the REST API is
gated behind the $49/mo Powerhouse plan. It scans/marks unpaid appointments,
runs batch checkout, updates service prices, and exports the client directory.

**This is NOT `scheduling-bridge` / `acuity-middleware` (Linear TIN-1993).**
That is a separate server-side API integration. Anything about webhooks, API
middleware, or a "scheduling bridge service" belongs to TIN-1993, not here.

## Execution host truth

- Run on a host with a real Chrome/Chromium and `CHROME_PATH` set to its
  executable. **Neo (MacBook) is the primary execution host**; a Tinyland
  fleet runner is the fallback.
- `xoxd-bates` was **decommissioned 2026-06-23** — it is not a valid target.
- macOS Chrome opens a profile-picker window that breaks Puppeteer's
  first-page assumption. The launch args in `src/browser.ts` already pass
  `--disable-features=ChromeProfilePicker --no-first-run --disable-infobars`;
  do not create a new profile if a picker still appears — see `.claude/CLAUDE.md`.

## Setup

```bash
pnpm install          # deps (pnpm 9.15.9+, Node 20+)
pnpm test:unit        # unit tests (vitest)
```

`just` is the intended entrypoint (`just --list`); the underlying CLI
invocations are below for harnesses that cannot use recipes.

## Command surface (plain CLI)

All mutating commands are **dry-run by default** and require an explicit
`--execute` flag to write anything. The commands below are the safe
(non-mutating) forms — see "Executing mutations" for how to add `--execute`.

| Purpose | Command (safe form) | Effect |
| --- | --- | --- |
| Login / save cookies | `npx tsx scripts/run-checkout.ts --headed --save-cookies --dry-run` | no production mutation; **writes the local `.acuity-cookies.json` secret** |
| Validate session | `just validate` (imports + checks `.acuity-cookies.json`) | read-only |
| Scan unpaid (report) | `npx tsx scripts/run-checkout.ts --cookies .acuity-cookies.json --start-date 2025-01-01` | read-only (dry-run) |
| Spot-check paid status | `npx tsx scripts/spot-check.ts --cookies .acuity-cookies.json --week 2025-01-06 --count 5` | read-only |
| Scan one client | `npx tsx scripts/scan-liz-hartman.ts --cookies .acuity-cookies.json --client "<name>"` | read-only |
| Explore admin DOM | `npx tsx scripts/explore-admin.ts [--pages appointmentTypes]` | read-only; writes `exploration-results/` (PII) |
| Update service prices | `npx tsx scripts/update-prices.ts --config services.json` | read-only (dry-run) |
| Export client directory | `npx tsx scripts/export-clients.ts --output acuity-clients.json` | read-only; **writes a client-PII file** (see Secrets & PII) |
| Report from run log | `npx tsx scripts/generate-report.ts <logfile> [--format json]` | read-only |

Key `run-checkout.ts` flags: `--start-date`/`--end-date`, `--format csv|json`,
`--output <file>`, `--max-failures <n>`, `--discount-client <name>` +
`--discount-amount <dollars>`, `--cookies <file>`, `--execute`. See
`--help` for the full list.

### Executing mutations

Only two commands write to production Acuity, and only when you append
`--execute`. Do this **only after** running the safe form above and reviewing
the reported diff:

- Batch mark-paid: append `--execute` to `run-checkout.ts` — marks the scanned
  unpaid appointments as paid.
- Update service prices: append `--execute` to `update-prices.ts` — writes new
  prices on the appointment-types page.

Do not paste `--execute` from a snippet; add it deliberately, once, per run.

## Safety rules (non-negotiable)

1. **Dry-run first, always.** Never add `--execute` to a mutating command
   until you have run it without `--execute` and reviewed the reported diff.
   Do not invent an "auto-confirm" path around this.
2. **No sandbox exists.** Every run hits **production data for a real
   business.** Prefer the read-only commands to validate assumptions first.
3. **Verify panel ID before and after edit mode** (`verifyPanelId`); the
   Acuity SPA can swap the detail side-panel out from under a script.
4. **Circuit breaker**: abort after 3 consecutive failures (`--max-failures`).
   Do not raise or disable it casually.
5. **`$` prefix on a calendar entry is NOT a reliable paid indicator** — open
   the detail panel and read the real `isPaid` checkbox.
6. **Close the detail panel after every operation** to avoid the stale-panel bug.

## Secrets & PII

- Auth is cookie-based (`PHPSESSID`, `sentinel-session`, `login_session`,
  `_acloggedin`); ~4h idle lifetime. Env-var credentials
  (`ACUITY_ADMIN_EMAIL` / `ACUITY_ADMIN_PASSWORD`) are an optional fallback.
- **Never commit `.acuity-cookies.json`, `.env`, `.env.*`, or `*.cookies.json`,
  and never print their contents.** These are gitignored; do not relax those
  `.gitignore` entries.
- No credentials belong in code — resolve auth only from env vars or the
  cookie file.
- Client PII lives in many outputs, not just cookies: screenshots,
  `exploration-results/`, the client export (e.g. `acuity-clients.json`),
  scan/checkout run logs, and generated reports. Treat **all** of them as PII.
  Never commit them; write exports/reports under the gitignored
  `exploration-results/` (or otherwise keep them out of the repo), and clean up
  `/tmp/acuity-admin-screenshots/` after debugging. Note that a bare
  `--output acuity-clients.json` lands a PII file at the repo root, which is
  **not** currently covered by `.gitignore` — do not `git add` it.
- Expiry detection must inspect page **content** for login-form markers
  (`Log in to Acuity`, `#login-form`, `input#username`) — Acuity re-renders
  the login form at the same URL, so URL checks alone are wrong.

## Selectors

DOM selectors live in `src/selectors.ts` (last verified 2026-03-08). Acuity is
a mixed PHP-form + React-SPA app and selectors drift across deploys — re-run
`explore-admin.ts` against a page before trusting stale selectors, especially
`appointmentTypes`, whose per-type edit form is still unmapped.
