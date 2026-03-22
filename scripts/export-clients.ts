#!/usr/bin/env tsx
/**
 * Export Acuity client list as CSV.
 *
 * Navigates to the client import/export page, triggers the CSV download,
 * and saves it locally for import into our PG clients table.
 *
 * Usage:
 *   CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     npx tsx scripts/export-clients.ts
 */

import puppeteer from 'puppeteer-core';
import { importCookies, validateCookies } from '../src/cookies.js';
import { launchBrowser } from '../src/browser.js';
import fs from 'fs/promises';
import path from 'path';

const BASE = 'https://secure.acuityscheduling.com';
const OUTPUT_DIR = path.join(process.cwd(), 'exploration-results');

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

const main = async () => {
	await fs.mkdir(OUTPUT_DIR, { recursive: true });

	console.error('[export] Launching browser...');
	const { browser, page } = await launchBrowser({ headless: false });

	console.error('[export] Importing cookies...');
	await importCookies(page);

	console.error('[export] Validating session...');
	const valid = await validateCookies(page);
	if (!valid) {
		console.error('[export] Cookie session invalid — need fresh login');
		await browser.close();
		process.exit(1);
	}

	// Set up download behavior
	const client = await page.createCDPSession();
	await client.send('Page.setDownloadBehavior', {
		behavior: 'allow',
		downloadPath: OUTPUT_DIR,
	});

	// Navigate to client import/export page
	console.error('[export] Navigating to client export page...');
	await page.goto(`${BASE}/clients.php?action=importexport`, {
		waitUntil: 'networkidle2',
		timeout: 30000,
	});

	await delay(2000);
	const title = await page.title();
	console.error(`[export] Page title: ${title}`);

	// Take screenshot of the export page
	await page.screenshot({
		path: path.join(OUTPUT_DIR, 'client-export-page.png'),
		fullPage: true,
	});

	// Look for export/download buttons and links
	const exportLinks = await page.evaluate(() => {
		const links = Array.from(document.querySelectorAll('a, button'));
		return links
			.filter(el => {
				const text = el.textContent?.toLowerCase() ?? '';
				return text.includes('export') || text.includes('download') || text.includes('csv');
			})
			.map(el => ({
				tag: el.tagName,
				text: el.textContent?.trim()?.slice(0, 80),
				href: (el as HTMLAnchorElement).href || '',
				id: el.id,
				className: el.className?.slice(0, 80),
			}));
	});

	console.error('[export] Export-related elements:', JSON.stringify(exportLinks, null, 2));

	// Look for forms on the page
	const forms = await page.evaluate(() =>
		Array.from(document.querySelectorAll('form')).map(f => ({
			action: f.action,
			method: f.method,
			inputs: Array.from(f.querySelectorAll('input, select, textarea, button')).map(i => ({
				tag: i.tagName.toLowerCase(),
				type: (i as HTMLInputElement).type || '',
				name: (i as HTMLInputElement).name || '',
				value: (i as HTMLInputElement).value?.slice(0, 50) || '',
				text: i.textContent?.trim()?.slice(0, 50) || '',
			})),
		})),
	);

	console.error('[export] Forms:', JSON.stringify(forms, null, 2));

	// Get all page text for context
	const pageText = await page.evaluate(() => {
		const main = document.querySelector('#acuity-main-content, main, .content');
		return main?.textContent?.replace(/\s+/g, ' ')?.trim()?.slice(0, 2000) ?? document.body.textContent?.replace(/\s+/g, ' ')?.trim()?.slice(0, 2000) ?? '';
	});

	console.error('[export] Page content preview:', pageText?.slice(0, 500));

	// Try clicking the export button if found
	if (exportLinks.length > 0) {
		const csvLink = exportLinks.find(l => l.text?.toLowerCase().includes('csv') || l.text?.toLowerCase().includes('export'));
		if (csvLink) {
			console.error(`[export] Clicking: ${csvLink.text}`);
			if (csvLink.href) {
				await page.goto(csvLink.href, { waitUntil: 'networkidle2' });
			} else {
				await page.evaluate((text) => {
					const el = Array.from(document.querySelectorAll('a, button')).find(
						e => e.textContent?.trim()?.includes(text ?? ''),
					);
					if (el) (el as HTMLElement).click();
				}, csvLink.text?.split(' ')[0]);
			}
			await delay(3000);
			console.error('[export] Download triggered, checking output...');
		}
	}

	// List any downloaded files
	const files = await fs.readdir(OUTPUT_DIR);
	const csvFiles = files.filter(f => f.endsWith('.csv'));
	console.error(`[export] CSV files in output: ${csvFiles.join(', ') || '(none)'}`);

	// Also capture the client list page for manual reference
	console.error('[export] Navigating to client list...');
	await page.goto(`${BASE}/admin/clients`, { waitUntil: 'networkidle2', timeout: 30000 });
	await delay(2000);

	// Extract client data from the table
	const clientData = await page.evaluate(() => {
		const rows = Array.from(document.querySelectorAll('table tr'));
		return rows.slice(1).map(row => {
			const cells = Array.from(row.querySelectorAll('td'));
			return cells.map(c => c.textContent?.trim() ?? '');
		}).filter(r => r.length > 0);
	});

	console.error(`[export] Client table rows: ${clientData.length}`);

	// Save client data as JSON
	if (clientData.length > 0) {
		const jsonPath = path.join(OUTPUT_DIR, 'acuity-clients.json');
		await fs.writeFile(jsonPath, JSON.stringify(clientData, null, 2));
		console.error(`[export] Saved ${clientData.length} client records to ${jsonPath}`);
	}

	await browser.close();
	console.error('[export] Done!');
};

main().catch(e => {
	console.error('[export] Fatal:', e);
	process.exit(1);
});
