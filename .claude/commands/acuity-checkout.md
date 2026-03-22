---
description: Batch mark-paid with circuit breaker safety
allowed-tools: Bash, Read
---

Scan the Acuity calendar week-by-week for unpaid appointments and optionally mark them as paid.

**Dry-run by default.** Pass `--execute` to actually modify appointments.

**Usage:**
```bash
npx tsx scripts/run-checkout.ts [options]
  --dry-run          Report unpaid only (default)
  --execute          Actually mark paid
  --start-date YYYY-MM-DD   Start week
  --end-date YYYY-MM-DD     End week
  --max-failures N   Circuit breaker threshold (default: 3)
  --headed           Show browser
  --save-cookies     Export cookies after login
```

**Safety:**
- Circuit breaker aborts after N consecutive failures
- SAFETY abort if wrong appointment panel detected
- verifyPanelId before AND after edit mode
- Screenshots captured on failure

**Prerequisites:** Valid `.acuity-cookies.json` (run `/acuity-login validate` first)

$ARGUMENTS
