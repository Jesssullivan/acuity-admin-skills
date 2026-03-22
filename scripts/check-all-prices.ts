#!/usr/bin/env tsx
/**
 * Check current prices for all appointment types.
 * Clicks each edit link, reads the price field, reports.
 */

import { launchBrowser, closeBrowser } from '../src/browser.js';
import { importCookies } from '../src/cookies.js';

async function main() {
	const { browser, page } = await launchBrowser({ headless: true });
	page.setDefaultTimeout(60000);
	page.setDefaultNavigationTimeout(60000);
	await importCookies(page, '.acuity-cookies.json');

	await page.goto('https://secure.acuityscheduling.com/appointments.php?action=appointmentTypes', {
		waitUntil: 'domcontentloaded',
		timeout: 60000,
	});
	await new Promise(r => setTimeout(r, 5000));

	// Get all type name links (not Edit buttons)
	const nameLinks = await page.$$('a.edit-appointment-type:not(.btn-rosetta-sm)');
	console.log(`Found ${nameLinks.length} appointment types\n`);

	const results: { name: string; price: string; duration: string; url: string }[] = [];

	for (let i = 0; i < nameLinks.length; i++) {
		// Re-query because page navigation invalidates element handles
		await page.goto('https://secure.acuityscheduling.com/appointments.php?action=appointmentTypes', {
			waitUntil: 'domcontentloaded',
			timeout: 60000,
		});
		await new Promise(r => setTimeout(r, 3000));

		const links = await page.$$('a.edit-appointment-type:not(.btn-rosetta-sm)');
		if (i >= links.length) break;

		const name = await links[i].evaluate(el => el.textContent?.trim() || '');

		await Promise.all([
			page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
			links[i].click(),
		]);
		await new Promise(r => setTimeout(r, 2000));

		const url = page.url();
		const priceEl = await page.$('input#price');
		const durationEl = await page.$('input#duration');
		const price = priceEl ? await priceEl.evaluate(el => (el as HTMLInputElement).value) : 'N/A';
		const duration = durationEl ? await durationEl.evaluate(el => (el as HTMLInputElement).value) : 'N/A';

		results.push({ name: name.substring(0, 50), price, duration, url });
		console.log(`${(i + 1).toString().padStart(2)}. ${name.substring(0, 50).padEnd(52)} $${price.padEnd(10)} ${duration}min  ${url.split('/').pop()}`);
	}

	console.log('\n=== PRICE SUMMARY ===');
	console.log('Type'.padEnd(52), 'Price'.padEnd(12), 'Duration', 'TypeID');
	console.log('-'.repeat(90));
	for (const r of results) {
		const typeId = r.url.split('/').pop();
		console.log(r.name.padEnd(52), r.price.padEnd(12), (r.duration + 'min').padEnd(10), typeId);
	}

	await closeBrowser();
}

main().catch(e => { console.error(e); process.exit(1); });
