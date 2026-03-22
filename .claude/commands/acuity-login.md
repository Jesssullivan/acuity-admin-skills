---
description: Authenticate to Acuity admin panel and save session cookies
allowed-tools: Bash, Read, Write
---

Authenticate to the Acuity Scheduling admin panel at https://secure.acuityscheduling.com/login.php.

**Modes:**
- `headed` — Launch visible browser for manual login (handles reCAPTCHA, OAuth). Saves cookies on success.
- `validate` — Check if saved `.acuity-cookies.json` is still valid.

**Requirements:**
- `CHROME_PATH` env var pointing to Chrome/Chromium executable
- Run on xoxd-bates (Mac with Chrome installed)

**Steps:**
1. Check for `.acuity-cookies.json` — report age and cookie count
2. If `validate`: import cookies, navigate to `/appointments.php`, check for login form in page body
3. If `headed`: run `npx tsx scripts/run-checkout.ts --headed --save-cookies --dry-run`
4. Report success/failure and cookie expiry estimate

**Session detection:** Acuity renders login form at `/appointments.php` without URL redirect. Must check page content for "Log in to Acuity", "FORGOT PASSWORD", `#login-form`, `input#username`.

$ARGUMENTS
