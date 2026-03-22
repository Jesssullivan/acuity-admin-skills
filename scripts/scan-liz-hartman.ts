#!/usr/bin/env tsx
/**
 * Scan ALL Liz Hartman appointments across the full date range.
 * Reports price and paid status for each, regardless of current paid state.
 *
 * Purpose: Find Liz Hartman appointments that are paid but still at $100
 * (missed the $30 discount because they were already paid when the
 * checkout automation ran — it only processes unpaid appointments).
 *
 * Usage:
 *   CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *   npx tsx scripts/scan-liz-hartman.ts --cookies .acuity-cookies.json
 *
 *   # With custom date range:
 *   npx tsx scripts/scan-liz-hartman.ts --cookies .acuity-cookies.json \
 *     --start 2025-01-01 --end 2026-03-31
 *
 * Output: Table of all Liz Hartman appointments with price/paid status + summary.
 */

import { launchBrowser, closeBrowser } from '../src/browser.js';
import { importCookies, validateCookies } from '../src/cookies.js';
import {
	navigateToWeek,
	scrapeCalendarAppointments,
	getCurrentWeekDate,
	openAppointmentDetail,
	closeAppointmentDetail,
} from '../src/appointments.js';
import { AdminSelectors, findSelector } from '../src/selectors.js';

const humanDelay = (ms = 500) => new Promise((r) => setTimeout(r, ms + Math.random() * 300));

interface LizRecord {
	id: string;
	weekDate: string;
	clientName: string;
	service: string;
	isPaid: boolean;
	price: string;
	needsDiscount: boolean; // true if paid but price is $100 (should be $70)
}

const main = async () => {
	const args = process.argv.slice(2);
	let cookiePath = '.acuity-cookies.json';
	let startDate = '2025-01-01';
	let endDate = '2026-03-31';

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--cookies' && args[i + 1]) cookiePath = args[++i];
		if (args[i] === '--start' && args[i + 1]) startDate = args[++i];
		if (args[i] === '--end' && args[i + 1]) endDate = args[++i];
	}

	console.error(`[liz-scan] Scanning ALL Liz Hartman appointments from ${startDate} to ${endDate}`);
	console.error(`[liz-scan] This is READ-ONLY — no modifications will be made`);

	const { page } = await launchBrowser({
		headless: true,
		executablePath: process.env.CHROME_PATH,
	});

	await importCookies(page, cookiePath);
	const valid = await validateCookies(page);
	if (!valid) {
		console.error('[liz-scan] Session expired. Refresh via --headed --save-cookies');
		await closeBrowser();
		process.exit(1);
	}

	// Phase 1: Scan all weeks and find Liz Hartman appointments on the calendar
	console.error(`[liz-scan] Phase 1: Scanning calendar for Liz Hartman appointments...`);
	await navigateToWeek(page, startDate);

	const lizCalendarEntries: Array<{ id: string; weekDate: string; clientName: string; service: string; calendarPaid: boolean }> = [];
	let currentDate = startDate;
	let weekCount = 0;

	while (currentDate <= endDate && weekCount < 100) {
		weekCount++;
		const weekAppts = await scrapeCalendarAppointments(page);

		// Filter for Liz Hartman (case-insensitive, partial match)
		const lizAppts = weekAppts.filter((a) =>
			a.clientName.toLowerCase().includes('liz') && a.clientName.toLowerCase().includes('hartman'),
		);

		if (lizAppts.length > 0) {
			console.error(`[liz-scan] Week of ${currentDate}: ${lizAppts.length} Liz Hartman appointments`);
			for (const apt of lizAppts) {
				lizCalendarEntries.push({
					id: apt.id,
					weekDate: currentDate,
					clientName: apt.clientName,
					service: apt.service,
					calendarPaid: apt.paid,
				});
			}
		}

		// Navigate to next week
		const nextLink = await page.$(AdminSelectors.calendarNavNext);
		if (!nextLink) break;

		await nextLink.click();
		await humanDelay(2000);
		await findSelector(page, AdminSelectors.calendarContent, 10000);

		const newDate = await getCurrentWeekDate(page);
		if (!newDate || newDate <= currentDate) break;
		currentDate = newDate;
	}

	console.error(`[liz-scan] Scanned ${weekCount} weeks, found ${lizCalendarEntries.length} Liz Hartman entries on calendar`);

	if (lizCalendarEntries.length === 0) {
		console.error('[liz-scan] No Liz Hartman appointments found. Done.');
		await closeBrowser();
		return;
	}

	// Phase 2: Open each appointment's detail panel to get ground truth
	console.error(`[liz-scan] Phase 2: Checking detail panels for ${lizCalendarEntries.length} appointments...`);

	const results: LizRecord[] = [];
	let lastWeek = '';

	for (const entry of lizCalendarEntries) {
		// Navigate to the appointment's week if needed
		if (entry.weekDate !== lastWeek) {
			await navigateToWeek(page, entry.weekDate);
			lastWeek = entry.weekDate;
		}

		const opened = await openAppointmentDetail(page, entry.id);
		if (!opened) {
			console.error(`[liz-scan]   ${entry.id} — could not open detail panel`);
			results.push({
				id: entry.id,
				weekDate: entry.weekDate,
				clientName: entry.clientName,
				service: entry.service,
				isPaid: false,
				price: 'N/A',
				needsDiscount: false,
			});
			continue;
		}

		await humanDelay(500);

		const isPaid = await page.evaluate((sel: string) => {
			const checkbox = document.querySelector(sel) as HTMLInputElement;
			return checkbox?.checked || false;
		}, AdminSelectors.detailIsPaid);

		const price = await page.evaluate((sel: string) => {
			const input = document.querySelector(sel) as HTMLInputElement;
			return input?.value || 'N/A';
		}, AdminSelectors.detailPrice);

		// Read full name from detail panel for confirmation
		const firstName = await page.evaluate((sel: string) => {
			return (document.querySelector(sel) as HTMLInputElement)?.value || '';
		}, AdminSelectors.detailFirstName);

		const lastName = await page.evaluate((sel: string) => {
			return (document.querySelector(sel) as HTMLInputElement)?.value || '';
		}, AdminSelectors.detailLastName);

		const detailName = `${firstName} ${lastName}`.trim();

		// Check if this needs a discount: paid at $100 (should be $70 with $30 discount)
		const priceNum = parseFloat(price) || 0;
		const needsDiscount = isPaid && (priceNum === 100 || priceNum === 100.0);

		results.push({
			id: entry.id,
			weekDate: entry.weekDate,
			clientName: detailName || entry.clientName,
			service: entry.service,
			isPaid,
			price,
			needsDiscount,
		});

		await closeAppointmentDetail(page);
		await humanDelay(300);
	}

	await closeBrowser();

	// Phase 3: Report
	console.log('');
	console.log('=== LIZ HARTMAN APPOINTMENT SCAN ===');
	console.log(`Date range: ${startDate} to ${endDate}`);
	console.log(`Total found: ${results.length}`);
	console.log('');
	console.log('ID           | Week       | Name                 | Price  | Paid  | Needs $30 Discount?');
	console.log('-------------|------------|----------------------|--------|-------|--------------------');

	for (const r of results) {
		const flag = r.needsDiscount ? ' *** YES' : '';
		console.log(
			`${r.id.padEnd(12)} | ${r.weekDate} | ${r.clientName.padEnd(20)} | $${r.price.padEnd(5)} | ${String(r.isPaid).padEnd(5)} | ${flag}`,
		);
	}

	// Summary
	const totalPaid = results.filter((r) => r.isPaid).length;
	const totalUnpaid = results.filter((r) => !r.isPaid).length;
	const at70 = results.filter((r) => parseFloat(r.price) === 70).length;
	const at100 = results.filter((r) => parseFloat(r.price) === 100).length;
	const needsFix = results.filter((r) => r.needsDiscount).length;

	console.log('');
	console.log('=== SUMMARY ===');
	console.log(`Total Liz Hartman appointments: ${results.length}`);
	console.log(`  Paid: ${totalPaid}, Unpaid: ${totalUnpaid}`);
	console.log(`  At $70 (discounted): ${at70}`);
	console.log(`  At $100 (full price): ${at100}`);
	console.log(`  Other prices: ${results.length - at70 - at100}`);
	console.log('');

	if (needsFix > 0) {
		console.log(`*** ACTION NEEDED: ${needsFix} appointments are paid at $100 but should have $30 discount ***`);
		console.log('These were likely already marked paid before the checkout automation ran.');
		console.log('Run a targeted fix script to apply the discount to these appointments.');

		// Output the IDs for easy scripting
		console.log('');
		console.log('Appointment IDs needing discount:');
		for (const r of results.filter((r) => r.needsDiscount)) {
			console.log(`  ${r.id} (week ${r.weekDate}) — currently $${r.price}`);
		}
	} else {
		console.log('All Liz Hartman appointments appear correctly priced.');
	}
};

main().catch((err) => {
	console.error('Fatal:', err);
	process.exit(1);
});
