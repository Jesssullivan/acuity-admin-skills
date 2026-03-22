#!/usr/bin/env tsx
/**
 * Deep DOM exploration script for Acuity admin.
 *
 * Uses saved cookies to navigate key admin pages headlessly and dump
 * their DOM structure for selector development. Outputs JSON to stdout.
 *
 * Usage:
 *   npx tsx scripts/deep-explore.ts
 *   npx tsx scripts/deep-explore.ts --page calendar
 *   npx tsx scripts/deep-explore.ts --page appointment --id 12345
 */

import { launchBrowser, closeBrowser, screenshot } from '../src/browser.js';
import { importCookies, validateCookies } from '../src/cookies.js';

const PAGES = {
	calendar: 'https://secure.acuityscheduling.com/appointments.php',
	calendarAll: 'https://secure.acuityscheduling.com/appointments.php?action=editAppt&allCalendars=true',
	reports: 'https://secure.acuityscheduling.com/reports.php',
	clients: 'https://secure.acuityscheduling.com/admin/clients',
	invoices: 'https://secure.acuityscheduling.com/admin/invoices',
	paymentSettings: 'https://secure.acuityscheduling.com/admin/payment-processor',
	appointmentTypes: 'https://secure.acuityscheduling.com/appointments.php?action=appointmentTypes',
};

type PageKey = keyof typeof PAGES;

const parseArgs = () => {
	const args = process.argv.slice(2);
	let pageName: PageKey | 'all' = 'all';
	let appointmentId: string | null = null;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--page') pageName = (args[++i] || 'all') as PageKey | 'all';
		if (args[i] === '--id') appointmentId = args[++i] || null;
	}

	return { pageName, appointmentId };
};

/**
 * Extract comprehensive DOM info from the current page.
 */
const dumpPageDOM = async (page: import('puppeteer-core').Page, label: string) => {
	await screenshot(label);

	const info = await page.evaluate(() => {
		// All interactive elements
		const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a.btn'))
			.map((el) => ({
				tag: el.tagName,
				type: (el as HTMLInputElement).type || '',
				text: el.textContent?.trim().substring(0, 100) || '',
				id: el.id,
				name: (el as HTMLInputElement).name || '',
				classes: el.className.substring(0, 200),
				href: (el as HTMLAnchorElement).href || '',
				'data-attrs': Array.from(el.attributes)
					.filter((a) => a.name.startsWith('data-'))
					.map((a) => `${a.name}=${a.value}`)
					.join(', '),
			}))
			.slice(0, 50);

		// All forms and inputs
		const inputs = Array.from(document.querySelectorAll('input, select, textarea'))
			.map((el) => ({
				tag: el.tagName,
				type: (el as HTMLInputElement).type || '',
				name: (el as HTMLInputElement).name || '',
				id: el.id,
				placeholder: (el as HTMLInputElement).placeholder || '',
				value: (el as HTMLInputElement).value?.substring(0, 50) || '',
				classes: el.className.substring(0, 200),
			}))
			.slice(0, 50);

		// Tables
		const tables = Array.from(document.querySelectorAll('table')).map((t) => ({
			id: t.id,
			classes: t.className,
			rows: t.rows.length,
			headers: Array.from(t.querySelectorAll('th')).map((th) => th.textContent?.trim()),
			sampleRow: t.rows[1]
				? Array.from(t.rows[1].cells).map((c) => c.textContent?.trim().substring(0, 80))
				: [],
		}));

		// Any list-like structures (appointment lists, etc.)
		const lists = Array.from(
			document.querySelectorAll(
				'[class*="appointment"], [class*="event"], [class*="booking"], [class*="client"], [id*="appointment"]',
			),
		)
			.map((el) => ({
				tag: el.tagName,
				id: el.id,
				classes: el.className.substring(0, 200),
				childCount: el.children.length,
				text: el.textContent?.trim().substring(0, 200),
				'data-attrs': Array.from(el.attributes)
					.filter((a) => a.name.startsWith('data-'))
					.map((a) => `${a.name}=${a.value}`)
					.join(', '),
			}))
			.slice(0, 30);

		// Links with IDs in them (appointment detail links)
		const detailLinks = Array.from(document.querySelectorAll('a[href*="id="], a[href*="appointmentId"]'))
			.map((a) => ({
				text: a.textContent?.trim().substring(0, 80),
				href: (a as HTMLAnchorElement).href,
			}))
			.slice(0, 20);

		// Any modals or overlays currently visible
		const modals = Array.from(
			document.querySelectorAll('[class*="modal"], [class*="dialog"], [class*="overlay"], [role="dialog"]'),
		)
			.filter((el) => {
				const style = getComputedStyle(el);
				return style.display !== 'none' && style.visibility !== 'hidden';
			})
			.map((el) => ({
				tag: el.tagName,
				id: el.id,
				classes: el.className.substring(0, 200),
				text: el.textContent?.trim().substring(0, 300),
			}));

		// Payment-related elements
		const paymentElements = Array.from(
			document.querySelectorAll(
				'[class*="pay"], [class*="price"], [class*="amount"], [class*="discount"], [class*="invoice"], [id*="pay"], [id*="price"]',
			),
		)
			.map((el) => ({
				tag: el.tagName,
				id: el.id,
				classes: el.className.substring(0, 200),
				text: el.textContent?.trim().substring(0, 150),
			}))
			.slice(0, 30);

		// Main content area HTML snippet
		const mainContent = (
			document.querySelector('#acuity-main-content') ||
			document.querySelector('#main-content') ||
			document.querySelector('main') ||
			document.querySelector('#content')
		)?.innerHTML?.substring(0, 5000);

		// Detail/side panel — try multiple strategies to find it
		// The panel is outside #acuity-main-content, likely a sibling
		const detailCandidates = [
			'#detail-wrapper',
			'#detail-container',
			'.detail-wrapper',
			'.detail-container',
			'[class*="detail-panel"]',
			'[class*="side-panel"]',
			'[class*="slideout"]',
			'[id*="detail"]',
			'#appointment-detail',
			'.appointment-detail',
		];
		let detailPanel = '';
		for (const sel of detailCandidates) {
			const el = document.querySelector(sel);
			if (el && el.innerHTML.length > 100) {
				detailPanel = `SELECTOR: ${sel}\n` + el.outerHTML.substring(0, 10000);
				break;
			}
		}

		// If no named detail, find any container with isPaid or priceSold inputs
		if (!detailPanel) {
			const isPaidEl = document.querySelector('#isPaid, [name="isPaid"]');
			if (isPaidEl) {
				// Walk up to find the containing panel
				let parent = isPaidEl.parentElement;
				for (let i = 0; i < 10 && parent; i++) {
					if (parent.outerHTML.length > 2000) {
						detailPanel = `FOUND via isPaid ancestor (${i} levels up): tag=${parent.tagName} id=${parent.id} class=${parent.className.substring(0, 100)}\n` + parent.outerHTML.substring(0, 10000);
						break;
					}
					parent = parent.parentElement;
				}
			}
		}

		// Also grab the form that has isPaid/priceSold
		const editForm = (
			document.querySelector('form:has(#isPaid)') ||
			document.querySelector('form:has([name="priceSold"])') ||
			document.querySelector('form:has([name="first_name"])')
		)?.outerHTML?.substring(0, 10000) || '';

		return {
			url: location.href,
			title: document.title,
			buttons,
			inputs,
			tables,
			lists,
			detailLinks,
			modals,
			paymentElements,
			mainContent,
			detailPanel,
			editForm,
		};
	});

	return info;
};

const main = async () => {
	const { pageName, appointmentId } = parseArgs();

	console.error('[deep-explore] Starting headless browser...');
	const { page } = await launchBrowser({ headless: true });

	try {
		// Load cookies
		console.error('[deep-explore] Loading cookies...');
		const loaded = await importCookies(page, '.acuity-cookies.json');
		if (!loaded) {
			console.error('[deep-explore] No cookies found. Run with --headed --save-cookies first.');
			process.exit(1);
		}

		// Skip validation — go straight to navigation (validation navigates and wastes time)
		// If cookies are bad, the page visits will reveal it

		const results: Record<string, unknown> = {};

		// Determine which pages to explore
		const pagesToVisit: [string, string][] =
			pageName === 'all'
				? Object.entries(PAGES)
				: pageName in PAGES
					? [[pageName, PAGES[pageName as PageKey]]]
					: [];

		if (pagesToVisit.length === 0 && !appointmentId) {
			console.error(`[deep-explore] Unknown page: ${pageName}`);
			console.error(`[deep-explore] Available: ${Object.keys(PAGES).join(', ')}, all`);
			process.exit(1);
		}

		// Visit each page
		for (const [name, url] of pagesToVisit) {
			console.error(`[deep-explore] Navigating to ${name}: ${url}`);
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
			// Extra wait for React SPA to render
			await new Promise((r) => setTimeout(r, 2000));
			results[name] = await dumpPageDOM(page, `explore-${name}`);
		}

		// If an appointment ID is specified, click it on the calendar to open the side panel
		if (appointmentId) {
			// First ensure we're on the calendar page
			const calUrl = page.url();
			if (!calUrl.includes('appointments.php')) {
				console.error('[deep-explore] Navigating to calendar first...');
				await page.goto(PAGES.calendar, { waitUntil: 'domcontentloaded', timeout: 45000 });
				await new Promise((r) => setTimeout(r, 3000));
			}

			// The appointment div has id="appt:<id>:<calId>"
			// Find any element whose id starts with "appt:<appointmentId>"
			const apptSelector = `[id^="appt:${appointmentId}"]`;
			console.error(`[deep-explore] Looking for appointment: ${apptSelector}`);

			try {
				await page.waitForSelector(apptSelector, { timeout: 10000 });
				console.error(`[deep-explore] Found appointment, clicking...`);
				await page.click(apptSelector);

				// Wait for the side panel / detail overlay to appear
				console.error(`[deep-explore] Waiting for detail panel...`);
				await new Promise((r) => setTimeout(r, 3000));

				// Try common detail panel selectors
				const detailSelectors = [
					'.detail-nav-display',
					'[class*="detail-panel"]',
					'[class*="side-panel"]',
					'[class*="appointment-detail"]',
					'[class*="edit-appointment"]',
					'[data-testid*="detail"]',
					'[data-testid*="edit"]',
					'form',
					'[role="dialog"]',
					'.modal',
				];

				for (const sel of detailSelectors) {
					try {
						await page.waitForSelector(sel, { timeout: 3000 });
						console.error(`[deep-explore] Detail panel appeared: ${sel}`);
						break;
					} catch {
						// Try next
					}
				}

				// Wait for network to settle
				try {
					await page.waitForNetworkIdle({ idleTime: 1000, timeout: 8000 });
				} catch {
					// May not fully idle
				}

				await new Promise((r) => setTimeout(r, 2000));
				results[`appointment-detail-${appointmentId}`] = await dumpPageDOM(page, `explore-apt-detail-${appointmentId}`);
			} catch (err) {
				console.error(`[deep-explore] Could not find/click appointment ${appointmentId}: ${err}`);
				// Try navigating week by week to find the appointment
				console.error(`[deep-explore] Dumping current page state instead`);
				results[`appointment-notfound-${appointmentId}`] = await dumpPageDOM(page, `explore-apt-notfound-${appointmentId}`);
			}
		}

		// Output results
		console.log(JSON.stringify(results, null, 2));
		console.error('[deep-explore] Done.');
	} catch (err) {
		console.error(`[deep-explore] Error: ${err}`);
		await screenshot('deep-explore-error');
		process.exit(1);
	} finally {
		await closeBrowser();
	}
};

main();
