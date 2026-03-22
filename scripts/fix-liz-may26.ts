#!/usr/bin/env tsx
/**
 * Targeted fix for Liz Hartman appointment on week 2025-05-26:
 *   Appointment 1431423429: apply $30 discount ($100 -> $70)
 *   This appointment is ALREADY PAID but at full price.
 *   The checkout automation skipped it because it was already paid.
 *
 * Usage:
 *   npx tsx scripts/fix-liz-may26.ts --cookies .acuity-cookies.json           # dry-run
 *   npx tsx scripts/fix-liz-may26.ts --cookies .acuity-cookies.json --execute  # apply fix
 */

import { launchBrowser, closeBrowser } from '../src/browser.js';
import { importCookies, validateCookies } from '../src/cookies.js';
import { navigateToWeek, openAppointmentDetail, closeAppointmentDetail } from '../src/appointments.js';
import { AdminSelectors } from '../src/selectors.js';

const humanDelay = (ms = 500) => new Promise((r) => setTimeout(r, ms + Math.random() * 300));

const TARGET_ID = '1431423429';
const TARGET_WEEK = '2025-05-26';
const EXPECTED_PRICE = '100';
const NEW_PRICE = '70.00';

const main = async () => {
	const cookiePath = process.argv.includes('--cookies')
		? process.argv[process.argv.indexOf('--cookies') + 1]
		: '.acuity-cookies.json';

	const dryRun = !process.argv.includes('--execute');

	console.error(`[fix-liz-may26] Mode: ${dryRun ? 'DRY-RUN' : 'EXECUTE'}`);
	console.error(`[fix-liz-may26] Target: ${TARGET_ID} on week ${TARGET_WEEK}`);

	const { page } = await launchBrowser({
		headless: true,
		executablePath: process.env.CHROME_PATH,
	});

	await importCookies(page, cookiePath);
	const valid = await validateCookies(page);
	if (!valid) {
		console.error('[fix-liz-may26] Session expired. Refresh cookies first.');
		await closeBrowser();
		process.exit(1);
	}

	// Navigate to the target week
	console.error(`[fix-liz-may26] Navigating to week of ${TARGET_WEEK}...`);
	await navigateToWeek(page, TARGET_WEEK);

	// Open the appointment
	console.error(`[fix-liz-may26] Opening appointment ${TARGET_ID}...`);
	const opened = await openAppointmentDetail(page, TARGET_ID);
	if (!opened) {
		console.error('[fix-liz-may26] FAILED: Could not open appointment detail panel');
		await closeBrowser();
		process.exit(1);
	}

	await humanDelay(500);

	// Verify the panel shows the correct appointment
	const formId = await page.evaluate((sel: string) => {
		const form = document.querySelector(sel) as HTMLFormElement;
		const action = form?.action || '';
		const match = action.match(/id=(\d+)/);
		return match?.[1] || '';
	}, AdminSelectors.detailForm);

	if (formId !== TARGET_ID) {
		console.error(`[fix-liz-may26] SAFETY: Panel shows appointment ${formId}, expected ${TARGET_ID}`);
		await closeAppointmentDetail(page);
		await closeBrowser();
		process.exit(1);
	}

	// Read current state
	const currentPrice = await page.evaluate((sel: string) => {
		const input = document.querySelector(sel) as HTMLInputElement;
		return input?.value || 'N/A';
	}, AdminSelectors.detailPrice);

	const isPaid = await page.evaluate((sel: string) => {
		const checkbox = document.querySelector(sel) as HTMLInputElement;
		return checkbox?.checked || false;
	}, AdminSelectors.detailIsPaid);

	const firstName = await page.evaluate((sel: string) => {
		return (document.querySelector(sel) as HTMLInputElement)?.value || '';
	}, AdminSelectors.detailFirstName);

	const lastName = await page.evaluate((sel: string) => {
		return (document.querySelector(sel) as HTMLInputElement)?.value || '';
	}, AdminSelectors.detailLastName);

	console.error(`[fix-liz-may26] Current state:`);
	console.error(`  Name: ${firstName} ${lastName}`);
	console.error(`  Price: $${currentPrice}`);
	console.error(`  Paid: ${isPaid}`);

	// Validate: should be Liz Hartman, paid, at $100
	if (!firstName.toLowerCase().includes('liz') || !lastName.toLowerCase().includes('hartman')) {
		console.error(`[fix-liz-may26] SAFETY: Name is "${firstName} ${lastName}", not Liz Hartman — aborting`);
		await closeAppointmentDetail(page);
		await closeBrowser();
		process.exit(1);
	}

	if (!isPaid) {
		console.error('[fix-liz-may26] Appointment is NOT paid — this fix is for already-paid appointments');
		console.error('[fix-liz-may26] Use the regular checkout automation instead');
		await closeAppointmentDetail(page);
		await closeBrowser();
		process.exit(1);
	}

	if (currentPrice !== EXPECTED_PRICE && currentPrice !== `${EXPECTED_PRICE}.00`) {
		if (currentPrice === '70' || currentPrice === '70.00') {
			console.error('[fix-liz-may26] Already at $70 — discount was already applied. No fix needed.');
		} else {
			console.error(`[fix-liz-may26] WARNING: Unexpected price $${currentPrice} — skipping`);
		}
		await closeAppointmentDetail(page);
		await closeBrowser();
		return;
	}

	// Apply the fix
	if (dryRun) {
		console.error(`[fix-liz-may26] DRY-RUN: Would change price $${currentPrice} -> $${NEW_PRICE}`);
		console.error('[fix-liz-may26] Run with --execute to apply the fix');
	} else {
		console.error(`[fix-liz-may26] Applying discount: $${currentPrice} -> $${NEW_PRICE}...`);

		// Enable edit mode
		const editBtn = await page.$(AdminSelectors.detailEdit);
		if (!editBtn) throw new Error('Edit button not found');
		await editBtn.click();
		await humanDelay(500);

		// Re-verify panel ID after edit mode (React may swap panels)
		const postEditId = await page.evaluate((sel: string) => {
			const form = document.querySelector(sel) as HTMLFormElement;
			const action = form?.action || '';
			const match = action.match(/id=(\d+)/);
			return match?.[1] || '';
		}, AdminSelectors.detailForm);

		if (postEditId !== TARGET_ID) {
			console.error(`[fix-liz-may26] SAFETY: Panel changed to ${postEditId} after edit click — aborting`);
			await closeAppointmentDetail(page);
			await closeBrowser();
			process.exit(1);
		}

		// Set discounted price
		await page.click(AdminSelectors.detailPrice, { count: 3 }); // select all
		await page.type(AdminSelectors.detailPrice, NEW_PRICE);
		await humanDelay(300);

		// Save
		const saveBtn = await page.$(AdminSelectors.detailSave);
		if (!saveBtn) throw new Error('Save button not found');
		await saveBtn.click();
		await humanDelay(2000);

		console.error('[fix-liz-may26] Discount applied: $100 -> $70');

		// Verify the save took effect
		const verifyPrice = await page.evaluate((sel: string) => {
			const input = document.querySelector(sel) as HTMLInputElement;
			return input?.value || 'N/A';
		}, AdminSelectors.detailPrice);

		if (verifyPrice === '70' || verifyPrice === '70.00') {
			console.error('[fix-liz-may26] VERIFIED: Price is now $70');
		} else {
			console.error(`[fix-liz-may26] WARNING: Post-save price is $${verifyPrice} — verify manually`);
		}
	}

	await closeAppointmentDetail(page);
	await closeBrowser();
	console.error('[fix-liz-may26] Done.');
};

main().catch((err) => {
	console.error('Fatal:', err);
	process.exit(1);
});
