#!/usr/bin/env tsx
/**
 * Probe the appointment type edit page to discover form fields and selectors.
 * Clicks the first edit-appointment-type link and dumps all form inputs.
 */

import { launchBrowser, closeBrowser } from '../src/browser.js';
import { importCookies } from '../src/cookies.js';

async function main() {
	const { browser, page } = await launchBrowser({ headless: true });
	await importCookies(page, '.acuity-cookies.json');

	// Navigate to appointment types (use domcontentloaded — networkidle0 times out on React SPA)
	page.setDefaultTimeout(60000);
	page.setDefaultNavigationTimeout(60000);
	await page.goto('https://secure.acuityscheduling.com/appointments.php?action=appointmentTypes', { waitUntil: 'domcontentloaded', timeout: 60000 });
	await new Promise(r => setTimeout(r, 5000)); // Wait for React to render

	// Get all edit links with their names
	const editLinks = await page.$$('a.edit-appointment-type');
	const typeNames: string[] = [];
	for (const link of editLinks) {
		const text = await link.evaluate(el => el.textContent?.trim() || '');
		const classes = await link.evaluate(el => el.className);
		if (!classes.includes('btn-rosetta')) {
			typeNames.push(text);
		}
	}
	console.log(`Found ${typeNames.length} appointment types:`);
	typeNames.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));

	// Click the first name link (not the "Edit" button) to navigate to edit page
	const nameLinks = await page.$$('a.edit-appointment-type:not(.btn-rosetta-sm)');
	if (nameLinks.length > 0) {
		const firstName = await nameLinks[0].evaluate(el => el.textContent?.trim());
		console.log(`\nClicking: "${firstName}"`);

		await Promise.all([
			page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {}),
			nameLinks[0].click(),
		]);
		await new Promise(r => setTimeout(r, 2000));

		console.log(`URL: ${page.url()}\n`);

		// Dump all form inputs on the edit page
		console.log('=== FORM INPUTS ===');
		const inputs = await page.$$('input, select, textarea');
		for (const inp of inputs) {
			const info = await inp.evaluate(el => ({
				tag: el.tagName,
				name: el.getAttribute('name') || '',
				type: el.getAttribute('type') || '',
				id: el.id || '',
				value: (el as any).value?.substring(0, 60) || '',
				placeholder: el.getAttribute('placeholder') || '',
			}));
			if (info.name || info.id) {
				console.log(`  ${info.tag} name="${info.name}" type="${info.type}" id="${info.id}" value="${info.value}" placeholder="${info.placeholder}"`);
			}
		}

		// Look for price/cost specific fields
		console.log('\n=== PRICE-RELATED FIELDS ===');
		const priceInputs = await page.$$('input[name*="price" i], input[name*="cost" i], input[name*="amount" i], input[id*="price" i], input[id*="cost" i]');
		for (const inp of priceInputs) {
			const info = await inp.evaluate(el => ({
				name: el.getAttribute('name'),
				id: el.id,
				value: (el as any).value,
				type: el.getAttribute('type'),
			}));
			console.log(`  FOUND: name="${info.name}" id="${info.id}" value="${info.value}" type="${info.type}"`);
		}

		// Also check for any element containing dollar amounts
		console.log('\n=== DOLLAR AMOUNTS ON PAGE ===');
		const dollarElements = await page.evaluate(() => {
			const results: string[] = [];
			document.querySelectorAll('*').forEach(el => {
				const text = el.textContent?.trim() || '';
				if (/^\$\d+/.test(text) && text.length < 20) {
					results.push(`${el.tagName}.${el.className.split(' ')[0]} = "${text}"`);
				}
			});
			return [...new Set(results)].slice(0, 20);
		});
		dollarElements.forEach(d => console.log(`  ${d}`));
	}

	await closeBrowser();
}

main().catch(e => { console.error(e); process.exit(1); });
