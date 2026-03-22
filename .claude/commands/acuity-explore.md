---
description: DOM discovery for selector updates
allowed-tools: Bash, Read, Write
---

Systematically crawl Acuity admin pages, capture screenshots, and dump DOM structure (forms, buttons, tables, inputs) for selector development.

**Usage:**
```bash
npx tsx scripts/explore-admin.ts [options]
  --pages PAGE1,PAGE2   Specific pages to explore (default: all 20)
  --deep               Click through expandable sections
  --output DIR         Output directory for screenshots + JSON
```

**Known pages (20):**
appointments, appointmentTypes, clients, integrations, settings, forms, custom-appearance, embed-codes, api, certificates, packages, invoicing, analytics, scheduling-rules, intake-forms, notifications, reminders, payment, staff, coupons

**6 pages known to timeout:** integrations, settings, forms, custom-appearance, embed-codes, api (React SPA slow loads)

**Output:** JSON per page with title, HTTP status, nav items, headings, forms (action/method/inputs), buttons, tables, links, iframes. Screenshots saved as PNG.

**Priority target:** `appointmentTypes` — individual type edit form selectors are UNMAPPED and needed for price updates.

$ARGUMENTS
