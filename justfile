# Acuity Admin Automation — Task Runner
#
# Prerequisites:
#   - CHROME_PATH env var set to Chrome/Chromium executable
#   - pnpm installed (9.15.9+)
#   - Node.js 20+
#
# Quick start:
#   just setup        # Install deps
#   just login        # Headed browser → save cookies
#   just validate     # Check cookie validity
#   just scan         # Dry-run unpaid report
#   just prices       # Update 7 service prices (dry-run)

set dotenv-load := true
set shell := ["bash", "-euo", "pipefail", "-c"]

# Default: show available commands
default:
    @just --list

# ─── Setup ────────────────────────────────────────────────────────────────

# Install dependencies
setup:
    pnpm install

# Build TypeScript
build:
    pnpm build

# Run tests
test:
    pnpm test:unit

# ─── Authentication ──────────────────────────────────────────────────────

# Launch headed browser for manual OAuth login, save cookies
login:
    @echo "🔐 Launching headed browser for Acuity login..."
    @echo "   Complete the login manually (handles reCAPTCHA, OAuth, 2FA)"
    @echo "   Cookies will be saved to .acuity-cookies.json"
    npx tsx scripts/run-checkout.ts --headed --save-cookies --dry-run
    @chmod 600 .acuity-cookies.json 2>/dev/null || true
    @echo "✅ Cookies saved. Valid for ~4 hours."

# Check if saved cookies are still valid
validate:
    @if [ ! -f .acuity-cookies.json ]; then \
        echo "❌ No .acuity-cookies.json found. Run: just login"; \
        exit 1; \
    fi
    @echo "🔍 Validating session cookies..."
    npx tsx -e "
    import { importCookies, validateCookies } from './src/cookies.js';
    import { launchBrowser } from './src/browser.js';
    const { browser, page } = await launchBrowser({ headless: true });
    await importCookies(page, '.acuity-cookies.json');
    const valid = await validateCookies(page);
    await browser.close();
    if (valid) { console.log('✅ Session is valid'); process.exit(0); }
    else { console.log('❌ Session expired. Run: just login'); process.exit(1); }
    "

# ─── Scanning & Reports ──────────────────────────────────────────────────

# Scan unpaid appointments (dry-run, no modifications)
scan start="2025-01-01":
    @echo "📊 Scanning unpaid appointments from {{start}}..."
    npx tsx scripts/run-checkout.ts \
        --cookies .acuity-cookies.json \
        --start-date {{start}}

# Scan and output JSON report
scan-json start="2025-01-01" output="unpaid-report.json":
    npx tsx scripts/run-checkout.ts \
        --cookies .acuity-cookies.json \
        --start-date {{start}} \
        --format json \
        --output {{output}}
    @echo "📄 Report saved to {{output}}"

# Spot-check N appointments on a given week
spot-check week count="5":
    npx tsx scripts/spot-check.ts --week {{week}} --count {{count}}

# Scan all appointments for a specific client
scan-client name start="2025-01-01":
    npx tsx scripts/scan-liz-hartman.ts --client "{{name}}" --start {{start}}

# ─── Appointment Actions ──────────────────────────────────────────────────

# Execute batch mark-paid (MODIFIES ACUITY — use with care)
checkout start="2025-01-01":
    @echo "⚠️  This will MODIFY appointments in Acuity!"
    @echo "   Press Ctrl+C within 5 seconds to abort..."
    @sleep 5
    npx tsx scripts/run-checkout.ts \
        --cookies .acuity-cookies.json \
        --start-date {{start}} \
        --execute

# ─── Service Prices ──────────────────────────────────────────────────────

# Explore appointment types page (discover edit form selectors)
explore-types:
    @echo "🔍 Exploring appointment types page..."
    npx tsx scripts/explore-admin.ts --pages appointmentTypes

# Update service prices (dry-run by default)
prices:
    @echo "💰 Price update — DRY RUN (no changes)"
    npx tsx scripts/update-prices.ts --config services.json

# Update service prices (EXECUTE — modifies Acuity)
prices-execute:
    @echo "⚠️  This will MODIFY service prices in Acuity!"
    @echo "   Press Ctrl+C within 5 seconds to abort..."
    @sleep 5
    npx tsx scripts/update-prices.ts --config services.json --execute

# ─── Client Data ──────────────────────────────────────────────────────────

# Export client directory
export-clients output="acuity-clients.json":
    npx tsx scripts/export-clients.ts --output {{output}}
    @echo "📋 Exported to {{output}}"

# ─── DOM Exploration ──────────────────────────────────────────────────────

# Explore all admin pages (screenshots + DOM dump)
explore:
    npx tsx scripts/explore-admin.ts

# Explore specific page(s)
explore-page pages:
    npx tsx scripts/explore-admin.ts --pages {{pages}}

# Deep explore with click-through
deep-explore page:
    npx tsx scripts/deep-explore.ts --page {{page}}

# ─── Full Workflow ────────────────────────────────────────────────────────

# Complete flow: login → validate → scan → review
full-scan:
    @echo "🚀 Starting full scan workflow..."
    just login
    just validate
    just scan
    @echo "✅ Scan complete. Review output above."
    @echo "   To execute: just checkout"

# Complete price update flow: login → explore → prices (dry-run)
full-prices:
    @echo "🚀 Starting price update workflow..."
    just login
    just validate
    just explore-types
    just prices
    @echo "✅ Dry-run complete. Review output above."
    @echo "   To execute: just prices-execute"
