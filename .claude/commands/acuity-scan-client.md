---
description: Scan all appointments for a specific client
allowed-tools: Bash, Read
---

Scan all weeks in a date range for a specific client. Opens each appointment's detail panel to read ground-truth price and paid status.

**Usage:**
```bash
npx tsx scripts/scan-liz-hartman.ts [options]
  --client "Name"     Client name (case-insensitive partial match)
  --start YYYY-MM-DD  Start date
  --end YYYY-MM-DD    End date
```

**Read-only.** Reports discrepancies (e.g., paid at full price when discount expected).

$ARGUMENTS
