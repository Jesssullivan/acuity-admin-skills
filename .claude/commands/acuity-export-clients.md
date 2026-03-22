---
description: Scrape client directory from Acuity admin
allowed-tools: Bash, Read, Write
---

Navigate to the client directory and export client data.

**Usage:**
```bash
npx tsx scripts/export-clients.ts [options]
  --output FILE    Output JSON file (default: acuity-clients.json)
  --format json|csv
```

**Methods:**
1. Table scraping from `/admin/clients` (primary)
2. CSV export via `clients.php?action=importexport` (fallback)

**Output fields:** lastName, firstName, phone, email
**Last export:** 239 clients (2026-03-08)

**Note:** Phone formats inconsistent (E.164, US display, leading apostrophe). Normalize before PG import.

$ARGUMENTS
