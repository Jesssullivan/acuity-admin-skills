#!/usr/bin/env tsx
/**
 * Acuity Admin Exhaustive Explorer
 *
 * Systematically navigates every page of the Acuity admin panel,
 * captures screenshots, documents nav items, forms, and features.
 * Uses saved cookies from interactive login.
 *
 * Usage:
 *   CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     npx tsx scripts/explore-admin.ts
 */

import puppeteer from 'puppeteer-core';
import { importCookies, validateCookies } from '../src/cookies.js';
import { launchBrowser } from '../src/browser.js';
import fs from 'fs/promises';
import path from 'path';

const BASE = 'https://secure.acuityscheduling.com';
const OUTPUT_DIR = path.join(process.cwd(), 'exploration-results');

// All known admin pages to explore
const PAGES = [
	{ name: 'dashboard', url: '/home.php', description: 'Main dashboard' },
	{ name: 'calendar-week', url: '/appointments.php', description: 'Calendar (week view)' },
	{ name: 'calendar-day', url: '/appointments.php?view=day', description: 'Calendar (day view)' },
	{ name: 'appointment-types', url: '/appointments.php?action=appointmentTypes', description: 'Service/appointment type config' },
	{ name: 'packages', url: '/appointments.php?action=packages', description: 'Packages & gift certificates' },
	{ name: 'coupons', url: '/appointments.php?action=coupons', description: 'Coupons & promo codes' },
	{ name: 'clients', url: '/admin/clients', description: 'Client directory' },
	{ name: 'invoices', url: '/admin/invoices', description: 'Invoice management' },
	{ name: 'reports', url: '/reports.php', description: 'Revenue & appointment reports' },
	{ name: 'availability', url: '/admin/calendars', description: 'Calendar availability settings' },
	{ name: 'payment-settings', url: '/admin/payment-processor', description: 'Payment processor config' },
	{ name: 'client-emails', url: '/admin/client-emails', description: 'Email template settings' },
	{ name: 'integrations', url: '/admin/integrations', description: 'Third-party integrations' },
	{ name: 'account-settings', url: '/admin/settings', description: 'Account settings' },
	{ name: 'intake-forms', url: '/admin/forms', description: 'Intake form builder' },
	{ name: 'certificates', url: '/appointments.php?action=certificates', description: 'Gift certificate management' },
	{ name: 'custom-css', url: '/admin/custom-appearance', description: 'Custom CSS/appearance' },
	{ name: 'scheduling-page', url: '/admin/scheduling-page', description: 'Scheduling page settings' },
	{ name: 'embed-codes', url: '/admin/embed-codes', description: 'Embed codes for website' },
	{ name: 'api-settings', url: '/admin/api', description: 'API access settings' },
];

interface PageResult {
	name: string;
	url: string;
	finalUrl: string;
	description: string;
	title: string;
	httpStatus: number;
	navItems: string[];
	headings: string[];
	forms: { action: string; method: string; inputs: string[] }[];
	buttons: string[];
	tables: { headers: string[]; rowCount: number }[];
	links: { text: string; href: string }[];
	iframes: string[];
	screenshotPath: string;
	error?: string;
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

const explorePage = async (page: puppeteer.Page, pageInfo: typeof PAGES[0]): Promise<PageResult> => {
	const result: PageResult = {
		name: pageInfo.name,
		url: pageInfo.url,
		finalUrl: '',
		description: pageInfo.description,
		title: '',
		httpStatus: 0,
		navItems: [],
		headings: [],
		forms: [],
		buttons: [],
		tables: [],
		links: [],
		iframes: [],
		screenshotPath: '',
	};

	try {
		console.error(`[explore] Navigating to ${pageInfo.name}: ${BASE}${pageInfo.url}`);

		const response = await page.goto(`${BASE}${pageInfo.url}`, {
			waitUntil: 'networkidle2',
			timeout: 30000,
		});

		result.httpStatus = response?.status() ?? 0;
		result.finalUrl = page.url();
		await delay(2000); // Let React SPA settle

		// Page title
		result.title = await page.title();

		// Navigation items
		result.navItems = await page.evaluate(() =>
			Array.from(document.querySelectorAll('nav a, [class*="NavItem"] a, .sidebar a'))
				.map(a => `${a.textContent?.trim()} → ${(a as HTMLAnchorElement).href}`)
				.filter(Boolean)
				.slice(0, 30),
		);

		// Headings
		result.headings = await page.evaluate(() =>
			Array.from(document.querySelectorAll('h1, h2, h3'))
				.map(h => `${h.tagName}: ${h.textContent?.trim()?.slice(0, 100)}`)
				.filter(Boolean)
				.slice(0, 20),
		);

		// Forms
		result.forms = await page.evaluate(() =>
			Array.from(document.querySelectorAll('form')).map(f => ({
				action: f.action || '(none)',
				method: f.method || 'GET',
				inputs: Array.from(f.querySelectorAll('input, select, textarea'))
					.map(i => `${i.tagName.toLowerCase()}[name=${(i as HTMLInputElement).name || '?'}, type=${(i as HTMLInputElement).type || '?'}]`)
					.slice(0, 20),
			})).slice(0, 10),
		);

		// Buttons
		result.buttons = await page.evaluate(() =>
			Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'))
				.map(b => b.textContent?.trim()?.slice(0, 60))
				.filter(t => t && t.length > 0)
				.slice(0, 20),
		);

		// Tables
		result.tables = await page.evaluate(() =>
			Array.from(document.querySelectorAll('table')).map(t => ({
				headers: Array.from(t.querySelectorAll('th')).map(th => th.textContent?.trim() ?? '').slice(0, 10),
				rowCount: t.querySelectorAll('tbody tr, tr').length,
			})).slice(0, 5),
		);

		// Significant links (not nav)
		result.links = await page.evaluate(() =>
			Array.from(document.querySelectorAll('main a, .content a, [class*="main"] a, #acuity-main-content a'))
				.map(a => ({
					text: a.textContent?.trim()?.slice(0, 60) ?? '',
					href: (a as HTMLAnchorElement).href,
				}))
				.filter(l => l.text && l.href)
				.slice(0, 30),
		);

		// Iframes
		result.iframes = await page.evaluate(() =>
			Array.from(document.querySelectorAll('iframe'))
				.map(f => f.src)
				.filter(Boolean),
		);

		// Screenshot
		const screenshotName = `${pageInfo.name}.png`;
		result.screenshotPath = path.join(OUTPUT_DIR, screenshotName);
		await page.screenshot({
			path: result.screenshotPath,
			fullPage: true,
		});

		console.error(`[explore] ✓ ${pageInfo.name}: ${result.headings.length} headings, ${result.buttons.length} buttons, ${result.forms.length} forms`);
	} catch (e) {
		result.error = (e as Error).message;
		console.error(`[explore] ✗ ${pageInfo.name}: ${result.error}`);
	}

	return result;
};

const main = async () => {
	await fs.mkdir(OUTPUT_DIR, { recursive: true });

	console.error('[explore] Launching browser...');
	const { browser, page } = await launchBrowser({ headless: false });

	console.error('[explore] Importing cookies...');
	await importCookies(page);

	console.error('[explore] Validating session...');
	const valid = await validateCookies(page);
	if (!valid) {
		console.error('[explore] ✗ Cookie session invalid — need fresh login');
		await browser.close();
		process.exit(1);
	}
	console.error('[explore] ✓ Session valid');

	const results: PageResult[] = [];

	for (const pageInfo of PAGES) {
		const result = await explorePage(page, pageInfo);
		results.push(result);
		await delay(1000); // Be polite
	}

	// Write full results
	const reportPath = path.join(OUTPUT_DIR, 'acuity-exploration.json');
	await fs.writeFile(reportPath, JSON.stringify(results, null, 2));

	// Write human-readable summary
	const summary = results.map(r => {
		const lines = [
			`## ${r.name} (${r.description})`,
			`URL: ${r.url} → ${r.finalUrl}`,
			`HTTP: ${r.httpStatus} | Title: ${r.title}`,
			r.error ? `ERROR: ${r.error}` : '',
			'',
			r.headings.length > 0 ? `### Headings\n${r.headings.map(h => `- ${h}`).join('\n')}` : '',
			r.buttons.length > 0 ? `### Buttons\n${r.buttons.map(b => `- ${b}`).join('\n')}` : '',
			r.forms.length > 0 ? `### Forms\n${r.forms.map(f => `- ${f.method} ${f.action}: ${f.inputs.length} inputs`).join('\n')}` : '',
			r.tables.length > 0 ? `### Tables\n${r.tables.map(t => `- Headers: [${t.headers.join(', ')}] (${t.rowCount} rows)`).join('\n')}` : '',
			r.links.length > 0 ? `### Key Links\n${r.links.slice(0, 10).map(l => `- [${l.text}](${l.href})`).join('\n')}` : '',
			r.iframes.length > 0 ? `### Iframes\n${r.iframes.map(f => `- ${f}`).join('\n')}` : '',
			'---',
		].filter(Boolean);
		return lines.join('\n');
	}).join('\n\n');

	const summaryPath = path.join(OUTPUT_DIR, 'acuity-exploration-summary.md');
	await fs.writeFile(summaryPath, `# Acuity Admin Exploration — ${new Date().toISOString()}\n\n${summary}`);

	console.error(`\n[explore] Done! ${results.length} pages explored.`);
	console.error(`[explore] Results: ${reportPath}`);
	console.error(`[explore] Summary: ${summaryPath}`);
	console.error(`[explore] Screenshots: ${OUTPUT_DIR}/`);

	// Stats
	const succeeded = results.filter(r => !r.error).length;
	const failed = results.filter(r => r.error).length;
	console.error(`[explore] ${succeeded} succeeded, ${failed} failed`);

	await browser.close();
};

main().catch(e => {
	console.error('[explore] Fatal:', e);
	process.exit(1);
});
