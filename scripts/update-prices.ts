#!/usr/bin/env tsx
/**
 * Update service prices in Acuity appointment types.
 *
 * Reads target prices from services.json, navigates to the appointment types
 * management page, finds each service by name, and updates the price.
 *
 * DRY-RUN by default. Pass --execute to apply changes.
 *
 * Usage:
 *   npx tsx scripts/update-prices.ts --config services.json
 *   npx tsx scripts/update-prices.ts --config services.json --execute
 *
 * PREREQUISITE: Run 'just explore-types' first to verify selectors work.
 * The appointment types edit form selectors may need updating if Acuity
 * changes their DOM structure.
 */

import { readFileSync } from 'fs';
import { launchBrowser, takeScreenshot, closeBrowser } from '../src/browser.js';
import { importCookies, validateCookies } from '../src/cookies.js';

interface ServiceConfig {
	name: string;
	category: string;
	duration: number;
	oldPrice: number;
	newPrice: number;
	acuityId: string | null;
	notes?: string;
}

interface ServicesFile {
	services: ServiceConfig[];
}

// Parse CLI args
const args = process.argv.slice(2);
const configPath = args.includes('--config')
	? args[args.indexOf('--config') + 1]
	: 'services.json';
const execute = args.includes('--execute');
const cookiePath = args.includes('--cookies')
	? args[args.indexOf('--cookies') + 1]
	: '.acuity-cookies.json';

// Load service config
let config: ServicesFile;
try {
	config = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch (e) {
	console.error(`Failed to read ${configPath}:`, e);
	process.exit(1);
}

console.log(`📋 Loaded ${config.services.length} service price targets from ${configPath}`);
console.log(`   Mode: ${execute ? '⚠️  EXECUTE (will modify Acuity)' : '🔍 DRY RUN'}`);
console.log();

// Print price table
console.log('Service Price Targets:');
console.log('─'.repeat(70));
for (const svc of config.services) {
	const change = svc.newPrice - svc.oldPrice;
	const arrow = change > 0 ? `+$${change}` : change < 0 ? `-$${Math.abs(change)}` : 'no change';
	console.log(`  ${svc.name.padEnd(40)} $${svc.oldPrice} → $${svc.newPrice} (${arrow})`);
}
console.log('─'.repeat(70));
console.log();

if (!execute) {
	console.log('🔍 DRY RUN — no changes will be made.');
	console.log('   To apply: npx tsx scripts/update-prices.ts --config services.json --execute');
	console.log();
	console.log('⚠️  NOTE: The appointment type edit form selectors are not yet mapped.');
	console.log('   Run "just explore-types" first to discover the DOM structure,');
	console.log('   then update src/selectors.ts with the type edit form selectors.');
	process.exit(0);
}

// --- Execute mode ---

console.log('🚀 Starting price update execution...');
console.log();

const { browser, page } = await launchBrowser({ headless: true });

try {
	// Import and validate cookies
	await importCookies(page, cookiePath);
	const valid = await validateCookies(page);
	if (!valid) {
		console.error('❌ Session expired. Run: just login');
		process.exit(1);
	}
	console.log('✅ Session valid');

	// Navigate to appointment types page
	const typesUrl = 'https://secure.acuityscheduling.com/appointments.php?action=appointmentTypes';
	console.log(`📍 Navigating to appointment types: ${typesUrl}`);
	await page.goto(typesUrl, { waitUntil: 'networkidle0', timeout: 30000 });

	await takeScreenshot(page, 'appointment-types-before.png');

	// Find and click each service type
	for (const svc of config.services) {
		console.log(`\n🔧 Processing: ${svc.name} ($${svc.oldPrice} → $${svc.newPrice})`);

		// Find the service by name text in the page
		// NOTE: These selectors need to be discovered via 'just explore-types'
		// The appointment types page structure is not yet fully mapped.
		const typeButtons = await page.$$('button, a, [role="button"]');
		let found = false;

		for (const btn of typeButtons) {
			const text = await btn.evaluate((el: Element) => el.textContent?.trim() || '');
			if (text.toLowerCase().includes(svc.name.toLowerCase().substring(0, 20))) {
				console.log(`  Found type button: "${text}"`);
				found = true;

				// Click to open edit form
				await btn.click();
				await page.waitForTimeout(2000);

				// Look for price input field
				// SELECTOR DISCOVERY NEEDED: The exact selector for the price field
				// in the type edit form is unknown. Run 'just explore-types' to find it.
				const priceInput = await page.$('input[name="price"], input[name="cost"], input[name="amount"], input[type="number"]');

				if (priceInput) {
					const currentPrice = await priceInput.evaluate((el: HTMLInputElement) => el.value);
					console.log(`  Current price: $${currentPrice}`);

					if (parseFloat(currentPrice) === svc.oldPrice) {
						// Clear and set new price
						await priceInput.click({ clickCount: 3 }); // Select all
						await priceInput.type(String(svc.newPrice));
						console.log(`  Set new price: $${svc.newPrice}`);

						// Look for save button
						const saveBtn = await page.$('button[type="submit"], input[type="submit"], [data-testid*="save"]');
						if (saveBtn) {
							await saveBtn.click();
							await page.waitForTimeout(2000);
							console.log(`  ✅ Saved`);
						} else {
							console.log(`  ⚠️  No save button found — may need manual save`);
						}
					} else {
						console.log(`  ⚠️  Price mismatch! Expected $${svc.oldPrice}, found $${currentPrice}. SKIPPING.`);
					}
				} else {
					console.log(`  ❌ No price input found in edit form. Run 'just explore-types' to map selectors.`);
				}

				// Navigate back to types list
				await page.goBack({ waitUntil: 'networkidle0' }).catch(() => {
					return page.goto(typesUrl, { waitUntil: 'networkidle0' });
				});
				await page.waitForTimeout(1000);
				break;
			}
		}

		if (!found) {
			console.log(`  ❌ Service type not found on page: "${svc.name}"`);
		}
	}

	await takeScreenshot(page, 'appointment-types-after.png');
	console.log('\n📸 Screenshots saved: appointment-types-before.png, appointment-types-after.png');
} catch (e) {
	console.error('💥 Error during price update:', e);
	await takeScreenshot(page, 'price-update-error.png');
	process.exit(1);
} finally {
	await closeBrowser();
}

console.log('\n✅ Price update execution complete.');
