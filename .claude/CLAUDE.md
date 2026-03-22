# Acuity Admin Skills — Claude Code Context

## Overview

Puppeteer-based automation for the Acuity Scheduling admin panel. Replaces the blocked REST API ($49/mo Powerhouse plan) with browser automation.

**Account**: Massage Ithaca (ID 30472727), logged in as jess@sulliwood.org
**Admin URL**: https://secure.acuityscheduling.com

## Quick Reference

```bash
pnpm install                           # Install deps
pnpm test:unit                         # Run tests
npx tsx scripts/run-checkout.ts --help  # Checkout CLI
npx tsx scripts/explore-admin.ts       # DOM explorer
npx tsx scripts/export-clients.ts      # Client export
```

**Execution host**: xoxd-bates (Mac with Chrome). NOT Yoga.

## Cookie Authentication

Two-phase model:
1. **Headed login** (manual, infrequent): `CHROME_PATH="..." npx tsx scripts/run-checkout.ts --headed --save-cookies`
2. **Headless reuse** (automated): Import `.acuity-cookies.json`, validate session

**Key cookies**: `PHPSESSID`, `sentinel-session` (Squarespace SSO), `login_session`, `_acloggedin`
**Session lifetime**: ~4 hours inactivity
**Expiry detection**: Check page body for login form strings (NOT URL — Acuity renders login at same URL)

## Acuity DOM Architecture

### Login Page (`login.php`)
- PHP form with reCAPTCHA Enterprise
- Two-step: `input#username` → NEXT → `#password-container` → `input#password` → LOG IN
- OAuth: Squarespace SSO → Google

### Calendar (`appointments.php`)
- React toolbar + PHP grid
- Entries: `div[data-testid="appt-container"]` with `id="appt:<id>:<calId>"`
- `$` prefix on service name = unpaid (UNRELIABLE — must check detail panel)
- Week nav: `#nav-previous`, `#nav-next`, URL param `?view=thisWeek&day=YYYY-MM-DD`

### Appointment Detail (side panel)
- Form: `form#appointment-details-page`
- Action: `POST /appointments.php?action=update&id=<ID>&origin=calendar`
- Edit mode: click `[data-testid="edit-appt-button"]`
- Fields: `input[name="priceSold"]`, `input#isPaid[name="isPaid"]`, `textarea#appt-notes`
- Save: `[data-testid="save-edit-appt"]`
- Close: `[data-testid="close-appointment-detail"]`

### Known Bugs
- **Stale panel**: Closing one appointment and opening another sometimes leaves old panel. Fixed with `verifyPanelId` safety checks.
- **Calendar $ prefix**: Does NOT reliably match `isPaid` checkbox. Always open detail panel.

## Safety Rules

1. **Never modify without --execute flag** — dry-run default
2. **Always verify panel ID** before AND after edit mode
3. **Circuit breaker**: Abort after 3 consecutive failures
4. **Cookie files are secrets** — never commit
5. **Screenshots contain PII** — clean up after debugging

## Selectors Registry

All selectors in `src/selectors.ts`. Last verified 2026-03-08.

## Appointment Types (Price Updates)

The appointment types edit page (`appointments.php?action=appointmentTypes`) has NOT been fully explored.
Individual type edit form selectors are UNMAPPED. Need to run `explore-admin.ts` targeting that page first.

7 types need price updates:
- Urgent Care 45min: $150 → $155
- Therapeutic 45min: $100 → $105
- TMD 1st Consult 30min: $150 → $155
- TMD Single 30min: $100 → $105
- TMD Double 60min: $200 → $205
- Cervical 30min: $75 → $80
- Cervical 60min: $150 → $155
