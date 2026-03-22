#!/usr/bin/env tsx
/**
 * Targeted fix for two appointments on week 2025-03-31:
 *   1. Coleen Cleeve 1426961237: restore price $130 -> $160 (stale panel bug)
 *   2. Liz Hartman 1431422658: apply $30 discount ($100 -> $70) + mark paid
 *
 * This is a one-time remediation script — not for general use.
 */

import { launchBrowser, closeBrowser } from '../src/browser.js';
import { importCookies, validateCookies } from '../src/cookies.js';
import { navigateToWeek, openAppointmentDetail, closeAppointmentDetail } from '../src/appointments.js';
import { AdminSelectors } from '../src/selectors.js';

const humanDelay = (ms = 500) => new Promise((r) => setTimeout(r, ms + Math.random() * 300));

const main = async () => {
	const cookiePath = process.argv.includes('--cookies')
		? process.argv[process.argv.indexOf('--cookies') + 1]
		: '.acuity-cookies.json';

	const dryRun = !process.argv.includes('--execute');

	console.error(`[fix] Mode: ${dryRun ? 'DRY-RUN' : 'EXECUTE'}`);

	const { page } = await launchBrowser({
		headless: true,
		executablePath: process.env.CHROME_PATH,
	});

	await importCookies(page, cookiePath);
	const valid = await validateCookies(page);
	if (!valid) {
		console.error('[fix] Session expired.');
		await closeBrowser();
		process.exit(1);
	}

	// Navigate to the week containing both appointments
	console.error('[fix] Navigating to week of 2025-03-31...');
	await navigateToWeek(page, '2025-03-31');

	// --- Step 1: Fix Coleen Cleeve's price ---
	console.error('[fix] Step 1: Opening Coleen Cleeve 1426961237...');
	const openedColeen = await openAppointmentDetail(page, '1426961237');
	if (!openedColeen) {
		console.error('[fix] FAILED: Could not open Coleen Cleeve appointment');
		await closeBrowser();
		process.exit(1);
	}

	// Read current state
	const coleenPrice = await page.evaluate((sel: string) => {
		const input = document.querySelector(sel) as HTMLInputElement;
		return input?.value || 'N/A';
	}, AdminSelectors.detailPrice);

	const coleenPaid = await page.evaluate((sel: string) => {
		const checkbox = document.querySelector(sel) as HTMLInputElement;
		return checkbox?.checked || false;
	}, AdminSelectors.detailIsPaid);

	console.error(`[fix] Coleen current: price=$${coleenPrice}, isPaid=${coleenPaid}`);

	if (coleenPrice === '130' || coleenPrice === '130.00') {
		if (dryRun) {
			console.error('[fix] DRY-RUN: Would restore Coleen price $130 -> $160');
		} else {
			console.error('[fix] Restoring Coleen price $130 -> $160...');

			// Enable edit mode
			const editBtn = await page.$(AdminSelectors.detailEdit);
			if (!editBtn) throw new Error('Edit button not found');
			await editBtn.click();
			await humanDelay(500);

			// Clear and set correct price
			await page.click(AdminSelectors.detailPrice, { count: 3 });
			await page.type(AdminSelectors.detailPrice, '160.00');
			await humanDelay(300);

			// Save
			const saveBtn = await page.$(AdminSelectors.detailSave);
			if (!saveBtn) throw new Error('Save button not found');
			await saveBtn.click();
			await humanDelay(2000);

			console.error('[fix] Coleen price restored to $160');
		}
	} else if (coleenPrice === '160' || coleenPrice === '160.00') {
		console.error('[fix] Coleen price is already $160 — no fix needed');
	} else {
		console.error(`[fix] WARNING: Unexpected Coleen price $${coleenPrice} — skipping`);
	}

	await closeAppointmentDetail(page);
	await humanDelay(500);

	// --- Step 2: Fix Liz Hartman ---
	console.error('[fix] Step 2: Opening Liz Hartman 1431422658...');
	const openedLiz = await openAppointmentDetail(page, '1431422658');
	if (!openedLiz) {
		console.error('[fix] FAILED: Could not open Liz Hartman appointment');
		await closeBrowser();
		process.exit(1);
	}

	const lizPrice = await page.evaluate((sel: string) => {
		const input = document.querySelector(sel) as HTMLInputElement;
		return input?.value || 'N/A';
	}, AdminSelectors.detailPrice);

	const lizPaid = await page.evaluate((sel: string) => {
		const checkbox = document.querySelector(sel) as HTMLInputElement;
		return checkbox?.checked || false;
	}, AdminSelectors.detailIsPaid);

	console.error(`[fix] Liz current: price=$${lizPrice}, isPaid=${lizPaid}`);

	if (!lizPaid && (lizPrice === '100' || lizPrice === '100.00')) {
		if (dryRun) {
			console.error('[fix] DRY-RUN: Would apply $30 discount ($100 -> $70) + mark paid');
		} else {
			console.error('[fix] Applying $30 discount ($100 -> $70) + mark paid...');

			// Enable edit mode
			const editBtn = await page.$(AdminSelectors.detailEdit);
			if (!editBtn) throw new Error('Edit button not found');
			await editBtn.click();
			await humanDelay(500);

			// Set discounted price
			await page.click(AdminSelectors.detailPrice, { count: 3 });
			await page.type(AdminSelectors.detailPrice, '70.00');
			await humanDelay(300);

			// Check isPaid
			await page.click(AdminSelectors.detailIsPaid);
			await humanDelay(300);

			// Save
			const saveBtn = await page.$(AdminSelectors.detailSave);
			if (!saveBtn) throw new Error('Save button not found');
			await saveBtn.click();
			await humanDelay(2000);

			console.error('[fix] Liz: discount applied + marked paid');
		}
	} else if (lizPaid) {
		console.error('[fix] Liz is already paid — no fix needed');
	} else {
		console.error(`[fix] WARNING: Unexpected Liz state price=$${lizPrice} paid=${lizPaid} — skipping`);
	}

	await closeAppointmentDetail(page);
	await closeBrowser();
	console.error('[fix] Done.');
};

main().catch((err) => {
	console.error('Fatal:', err);
	process.exit(1);
});
