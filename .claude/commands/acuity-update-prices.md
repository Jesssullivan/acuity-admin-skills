---
description: Modify service prices in Acuity appointment types
allowed-tools: Bash, Read
---

Navigate to the appointment types page and modify service prices. **NEW CAPABILITY — requires DOM exploration first.**

**Prerequisites:**
1. Run `/acuity-explore --pages appointmentTypes --deep` to discover edit form selectors
2. Update `src/selectors.ts` with type edit form selectors
3. Valid `.acuity-cookies.json`

**Target price changes:**
| Service | Old | New |
|---------|-----|-----|
| Urgent Care 45min | $150 | $155 |
| Therapeutic 45min | $100 | $105 |
| TMD 1st Consult 30min | $150 | $155 |
| TMD Single 30min | $100 | $105 |
| TMD Double 60min | $200 | $205 |
| Cervical 30min | $75 | $80 |
| Cervical 60min | $150 | $155 |

**Dry-run mandatory for first use.** Screenshot before and after each price change.

$ARGUMENTS
