#!/usr/bin/env tsx

/**
 * Spot-check: scan a couple weeks, find all appointments, open each detail
 * panel and read isPaid + price. Reports the ground truth.
 *
 * Usage:
 *   tsx scripts/spot-check-ids.ts --cookies .acuity-cookies.json --week 2025-01-06 --count 10
 */

import { launchBrowser, closeBrowser } from '../src/browser.js';
import { importCookies, validateCookies } from '../src/cookies.js';
import { navigateToWeek, scrapeCalendarAppointments, openAppointmentDetail, closeAppointmentDetail } from '../src/appointments.js';
import { AdminSelectors } from '../src/selectors.js';

const humanDelay = (ms = 500) => new Promise((r) => setTimeout(r, ms + Math.random() * 300));

const main = async () => {
	const args = process.argv.slice(2);
	let cookiePath = '.acuity-cookies.json';
	let weekDate = '2025-01-06';
	let count = 10;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--cookies' && args[i + 1]) cookiePath = args[++i];
		if (args[i] === '--week' && args[i + 1]) weekDate = args[++i];
		if (args[i] === '--count' && args[i + 1]) count = parseInt(args[++i], 10);
	}

	console.error(`[spot-check] Checking all appointments for week of ${weekDate}`);

	const { page } = await launchBrowser({
		headless: true,
		executablePath: process.env.CHROME_PATH,
	});

	await importCookies(page, cookiePath);
	const valid = await validateCookies(page);
	if (!valid) {
		console.error('[spot-check] Session expired.');
		await closeBrowser();
		process.exit(1);
	}

	await navigateToWeek(page, weekDate);
	const appointments = await scrapeCalendarAppointments(page);

	console.error(`[spot-check] Found ${appointments.length} appointments, checking ${Math.min(count, appointments.length)}...`);
	console.log('');
	console.log('ID           | Client               | Calendar paid? | Detail isPaid | Detail Price');
	console.log('-------------|----------------------|----------------|---------------|-------------');

	let paidCount = 0;
	let unpaidCount = 0;

	for (const apt of appointments.slice(0, count)) {
		const calendarPaid = apt.paid; // from $ prefix parsing

		const opened = await openAppointmentDetail(page, apt.id);
		if (!opened) {
			console.log(`${apt.id} | ${apt.clientName.padEnd(20)} | ${String(calendarPaid).padEnd(14)} | NOT OPENED    |`);
			continue;
		}

		await humanDelay(500);

		// Read isPaid directly (avoid readAppointmentDetail due to __name bug)
		const isPaid = await page.evaluate((sel: string) => {
			const checkbox = document.querySelector(sel) as HTMLInputElement;
			return checkbox?.checked || false;
		}, AdminSelectors.detailIsPaid);

		const price = await page.evaluate((sel: string) => {
			const input = document.querySelector(sel) as HTMLInputElement;
			return input?.value || 'N/A';
		}, AdminSelectors.detailPrice);

		if (isPaid) paidCount++;
		else unpaidCount++;

		const mismatch = calendarPaid !== isPaid ? ' *** MISMATCH' : '';
		console.log(
			`${apt.id} | ${apt.clientName.padEnd(20)} | ${String(calendarPaid).padEnd(14)} | ${String(isPaid).padEnd(13)} | $${price}${mismatch}`,
		);

		await closeAppointmentDetail(page);
		await humanDelay(300);
	}

	console.log('');
	console.log(`Summary: ${paidCount} paid, ${unpaidCount} unpaid (of ${Math.min(count, appointments.length)} checked)`);

	await closeBrowser();
};

main().catch((err) => {
	console.error('Fatal:', err);
	process.exit(1);
});
