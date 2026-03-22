#!/usr/bin/env tsx

/**
 * Spot-check a few appointments to verify their isPaid status
 * in the detail panel. Reads the checkbox state without modifying anything.
 *
 * Usage:
 *   tsx scripts/spot-check.ts --cookies .acuity-cookies.json --week 2025-01-06 --count 5
 */

import { launchBrowser, closeBrowser, getActivePage } from '../src/browser.js';
import { importCookies, validateCookies } from '../src/cookies.js';
import { navigateToWeek, scrapeCalendarAppointments, openAppointmentDetail, closeAppointmentDetail } from '../src/appointments.js';
import { AdminSelectors } from '../src/selectors.js';

const humanDelay = (ms = 500) => new Promise((r) => setTimeout(r, ms + Math.random() * 300));

const main = async () => {
	const args = process.argv.slice(2);
	let cookiePath = '.acuity-cookies.json';
	let weekDate = '2025-01-06';
	let count = 5;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--cookies' && args[i + 1]) cookiePath = args[++i];
		if (args[i] === '--week' && args[i + 1]) weekDate = args[++i];
		if (args[i] === '--count' && args[i + 1]) count = parseInt(args[++i], 10);
	}

	console.error(`[spot-check] Checking appointments for week of ${weekDate}`);

	const { page } = await launchBrowser({
		headless: true,
		executablePath: process.env.CHROME_PATH,
	});

	await importCookies(page, cookiePath);
	const valid = await validateCookies(page);
	if (!valid) {
		console.error('[spot-check] Session expired. Run --headed --save-cookies first.');
		await closeBrowser();
		process.exit(1);
	}

	await navigateToWeek(page, weekDate);
	const appointments = await scrapeCalendarAppointments(page);

	console.error(`[spot-check] Found ${appointments.length} appointments on this week`);
	console.error(`[spot-check] Checking up to ${count} appointments...`);
	console.error('');

	const toCheck = appointments.slice(0, count);

	for (const apt of toCheck) {
		const opened = await openAppointmentDetail(page, apt.id);
		if (!opened) {
			console.log(`${apt.id} | ${apt.clientName} | COULD NOT OPEN`);
			continue;
		}

		await humanDelay(500);

		// Read isPaid checkbox state
		const isPaid = await page.evaluate((sel) => {
			const checkbox = document.querySelector(sel) as HTMLInputElement;
			return checkbox?.checked || false;
		}, AdminSelectors.detailIsPaid);

		// Read price
		const price = await page.evaluate((sel) => {
			const input = document.querySelector(sel) as HTMLInputElement;
			return input?.value || 'N/A';
		}, AdminSelectors.detailPrice);

		// Read if the $ prefix is on the calendar entry text (unpaid indicator)
		const calendarText = apt.service || '';
		const hasDollarPrefix = calendarText.startsWith('$');

		console.log(`${apt.id} | ${apt.clientName} | isPaid=${isPaid} | price=$${price} | calendarHas$=${hasDollarPrefix} | service="${apt.service}"`);

		await closeAppointmentDetail(page);
		await humanDelay(300);
	}

	console.error('');
	console.error('[spot-check] Done');
	await closeBrowser();
};

main().catch((err) => {
	console.error('Fatal:', err);
	process.exit(1);
});
