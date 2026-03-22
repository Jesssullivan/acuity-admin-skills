#!/usr/bin/env tsx
/**
 * Targeted fix for Tess Legler 1413986492:
 *   - Restore price $70 -> $100 (misapplied $30 Liz Hartman discount from v2 stale panel bug)
 *   - Mark paid
 *
 * This is a one-time remediation script — not for general use.
 * The v2 checkout run had a stale panel bug that caused Liz Hartman's $30 discount
 * to be applied to the wrong appointment (Tess Legler's panel was stuck open).
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

	console.error(`[fix-tess] Mode: ${dryRun ? 'DRY-RUN' : 'EXECUTE'}`);

	const { page } = await launchBrowser({
		headless: true,
		executablePath: process.env.CHROME_PATH,
	});

	await importCookies(page, cookiePath);
	const valid = await validateCookies(page);
	if (!valid) {
		console.error('[fix-tess] Session expired.');
		await closeBrowser();
		process.exit(1);
	}

	// Tess Legler is on week of 2025-02-10 (based on the scan results)
	// Need to find the right week — appointment 1413986492 was causing sticky panel issues
	// in the Feb 2025 range. Let's try navigating to weeks around there.
	const weeksToTry = ['2025-02-03', '2025-02-10', '2025-02-17', '2025-02-24'];

	let opened = false;
	for (const week of weeksToTry) {
		console.error(`[fix-tess] Trying week of ${week}...`);
		await navigateToWeek(page, week);

		opened = await openAppointmentDetail(page, '1413986492');
		if (opened) {
			console.error(`[fix-tess] Found appointment on week of ${week}`);
			break;
		}
	}

	if (!opened) {
		console.error('[fix-tess] FAILED: Could not open Tess Legler 1413986492 on any week');
		await closeBrowser();
		process.exit(1);
	}

	// Verify panel ID (safety check built into openAppointmentDetail, but double-check)
	const formId = await page.evaluate((sel: string) => {
		const form = document.querySelector(sel) as HTMLFormElement;
		const action = form?.action || '';
		const match = action.match(/id=(\d+)/);
		return match?.[1] || '';
	}, AdminSelectors.detailForm);

	if (formId !== '1413986492') {
		console.error(`[fix-tess] SAFETY: Panel shows ${formId}, expected 1413986492 — aborting`);
		await closeBrowser();
		process.exit(1);
	}

	// Read current state
	const currentPrice = await page.evaluate((sel: string) => {
		const input = document.querySelector(sel) as HTMLInputElement;
		return input?.value || 'N/A';
	}, AdminSelectors.detailPrice);

	const currentPaid = await page.evaluate((sel: string) => {
		const checkbox = document.querySelector(sel) as HTMLInputElement;
		return checkbox?.checked || false;
	}, AdminSelectors.detailIsPaid);

	const clientName = await page.evaluate((sel: string) => {
		const firstName = (document.querySelector(sel) as HTMLInputElement)?.value || '';
		return firstName;
	}, AdminSelectors.detailFirstName);

	const lastName = await page.evaluate((sel: string) => {
		const el = (document.querySelector(sel) as HTMLInputElement)?.value || '';
		return el;
	}, AdminSelectors.detailLastName);

	console.error(`[fix-tess] Client: ${clientName} ${lastName}`);
	console.error(`[fix-tess] Current: price=$${currentPrice}, isPaid=${currentPaid}`);

	// Verify this is actually Tess Legler
	const fullName = `${clientName} ${lastName}`.trim().toLowerCase();
	if (!fullName.includes('tess') && !fullName.includes('legler')) {
		console.error(`[fix-tess] SAFETY: Client name "${clientName} ${lastName}" doesn't match Tess Legler — aborting`);
		await closeAppointmentDetail(page);
		await closeBrowser();
		process.exit(1);
	}

	if (currentPrice === '70' || currentPrice === '70.00') {
		if (dryRun) {
			console.error('[fix-tess] DRY-RUN: Would restore price $70 -> $100 and mark paid');
		} else {
			console.error('[fix-tess] Restoring price $70 -> $100 and marking paid...');

			// Enable edit mode
			const editBtn = await page.$(AdminSelectors.detailEdit);
			if (!editBtn) throw new Error('Edit button not found');
			await editBtn.click();
			await humanDelay(500);

			// Verify panel ID again after edit mode
			const editFormId = await page.evaluate((sel: string) => {
				const form = document.querySelector(sel) as HTMLFormElement;
				const action = form?.action || '';
				const match = action.match(/id=(\d+)/);
				return match?.[1] || '';
			}, AdminSelectors.detailForm);

			if (editFormId !== '1413986492') {
				console.error(`[fix-tess] SAFETY: Panel changed to ${editFormId} after edit — aborting`);
				await closeBrowser();
				process.exit(1);
			}

			// Clear and set correct price
			await page.click(AdminSelectors.detailPrice, { count: 3 });
			await page.type(AdminSelectors.detailPrice, '100.00');
			await humanDelay(300);

			// Check isPaid if not already
			if (!currentPaid) {
				await page.click(AdminSelectors.detailIsPaid);
				await humanDelay(300);
			}

			// Save
			const saveBtn = await page.$(AdminSelectors.detailSave);
			if (!saveBtn) throw new Error('Save button not found');
			await saveBtn.click();
			await humanDelay(2000);

			console.error('[fix-tess] Price restored to $100 and marked paid');
		}
	} else if (currentPrice === '100' || currentPrice === '100.00') {
		if (currentPaid) {
			console.error('[fix-tess] Already at $100 and paid — no fix needed');
		} else if (dryRun) {
			console.error('[fix-tess] DRY-RUN: Price already $100, would mark paid');
		} else {
			console.error('[fix-tess] Price already $100, marking paid...');
			const editBtn = await page.$(AdminSelectors.detailEdit);
			if (!editBtn) throw new Error('Edit button not found');
			await editBtn.click();
			await humanDelay(500);

			await page.click(AdminSelectors.detailIsPaid);
			await humanDelay(300);

			const saveBtn = await page.$(AdminSelectors.detailSave);
			if (!saveBtn) throw new Error('Save button not found');
			await saveBtn.click();
			await humanDelay(2000);

			console.error('[fix-tess] Marked paid');
		}
	} else {
		console.error(`[fix-tess] WARNING: Unexpected price $${currentPrice} — skipping. Manual review needed.`);
	}

	await closeAppointmentDetail(page);
	await closeBrowser();
	console.error('[fix-tess] Done.');
};

main().catch((err) => {
	console.error('Fatal:', err);
	process.exit(1);
});
