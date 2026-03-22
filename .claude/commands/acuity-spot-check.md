---
description: Read-only appointment verification
allowed-tools: Bash, Read
---

Open N appointments from a given week and report their actual isPaid checkbox state vs. the calendar $ prefix indicator. **Read-only — no modifications possible.**

**Usage:**
```bash
npx tsx scripts/spot-check.ts [options]
  --week YYYY-MM-DD   Week to check
  --count N           Number of appointments to verify (default: 5)
```

**Purpose:** Verify paid status accuracy before running checkout. Catches calendar $ prefix mismatches.

$ARGUMENTS
