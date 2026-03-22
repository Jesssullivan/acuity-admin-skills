#!/usr/bin/env tsx
/**
 * CLI entry point for Acuity admin automation.
 *
 * Three authentication modes:
 *   1. --headed (interactive): Opens browser, you log in manually, cookies saved
 *   2. --cookies <file>: Reuses saved cookies from a previous interactive session
 *   3. Auto credentials: Uses ACUITY_ADMIN_EMAIL + ACUITY_ADMIN_PASSWORD env vars
 *
 * Typical workflow:
 *   # First time — log in manually, save cookies:
 *   pnpm checkout --headed --save-cookies
 *
 *   # Subsequent runs — headless with saved cookies:
 *   pnpm checkout --cookies .acuity-cookies.json
 *
 *   # Scan unpaid from Jan 2025:
 *   pnpm checkout --cookies .acuity-cookies.json --start-date 2025-01-01
 *
 *   # Apply $30 discount to Liz Hartman and mark all paid:
 *   pnpm checkout --cookies .acuity-cookies.json --execute \
 *     --discount-client "Liz Hartman" --discount-amount 30
 *
 * Environment variables:
 *   ACUITY_ADMIN_EMAIL     - Acuity admin login email
 *   ACUITY_ADMIN_PASSWORD  - Acuity admin login password
 *   CHROME_PATH            - Path to Chrome/Chromium executable
 */

import { writeFile } from 'node:fs/promises';
import { launchBrowser, closeBrowser, screenshot } from '../src/browser.js';
import { loginToAcuity, interactiveLogin, isAuthenticated } from '../src/auth.js';
import { exportCookies, importCookies, validateCookies } from '../src/cookies.js';
import { listAppointments, navigateToWeek } from '../src/appointments.js';
import { markPaidCash, discountAndMarkPaid } from '../src/actions.js';
import { generateUnpaidReport, toCSV, toJSON } from '../src/report.js';
import type { AppointmentFilter } from '../src/types.js';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliOptions {
	format: 'csv' | 'json';
	output: string | null;
	execute: boolean;
	headed: boolean;
	startDate: string;
	endDate: string | null;
	cookies: string | null;
	saveCookies: boolean;
	cookiePath: string;
	explore: boolean;
	discountClient: string | null;
	discountAmount: number;
	maxConsecutiveFailures: number;
}

const parseArgs = (args: string[]): CliOptions => {
	const options: CliOptions = {
		format: 'csv',
		output: null,
		execute: false,
		headed: false,
		startDate: '2025-01-01',
		endDate: null,
		cookies: null,
		saveCookies: false,
		cookiePath: '.acuity-cookies.json',
		explore: false,
		discountClient: null,
		discountAmount: 0,
		maxConsecutiveFailures: 3,
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case '--format':
				options.format = (args[++i] as 'csv' | 'json') || 'csv';
				break;
			case '--output':
				options.output = args[++i] || null;
				break;
			case '--execute':
				options.execute = true;
				break;
			case '--headed':
				options.headed = true;
				break;
			case '--start-date':
				options.startDate = args[++i] || '2025-01-01';
				break;
			case '--end-date':
				options.endDate = args[++i] || null;
				break;
			case '--discount-client':
				options.discountClient = args[++i] || null;
				break;
			case '--discount-amount':
				options.discountAmount = parseFloat(args[++i] || '0');
				break;
			case '--cookies':
				options.cookies = args[++i] || '.acuity-cookies.json';
				break;
			case '--save-cookies':
				options.saveCookies = true;
				break;
			case '--cookie-path':
				options.cookiePath = args[++i] || '.acuity-cookies.json';
				break;
			case '--explore':
				options.explore = true;
				break;
			case '--max-failures':
				options.maxConsecutiveFailures = parseInt(args[++i] || '3', 10);
				break;
			case '--help':
			case '-h':
				console.log(`
Acuity Admin Checkout Tool

Usage:
  npx tsx scripts/run-checkout.ts [options]

Auth modes (pick one):
  --headed --save-cookies   Interactive login in visible browser, save cookies
  --cookies <file>          Load saved cookies for headless automation
  (default)                 Use ACUITY_ADMIN_EMAIL + ACUITY_ADMIN_PASSWORD env vars

Options:
  --format <csv|json>          Output format (default: csv)
  --output <file>              Write report to file (default: stdout)
  --execute                    Actually mark unpaid appointments as paid (cash)
  --headed                     Show browser window (not headless)
  --start-date <date>          Start date for filter (default: 2025-01-01)
  --end-date <date>            End date for filter (default: today)
  --discount-client <name>     Apply discount to this client's appointments
  --discount-amount <dollars>  Discount amount in dollars (used with --discount-client)
  --save-cookies               Export session cookies after login
  --cookie-path <file>         Cookie file path (default: .acuity-cookies.json)
  --explore                    Just log in and dump page DOM info (for selector dev)
  --help, -h                   Show this help

Environment:
  ACUITY_ADMIN_EMAIL     Login email (for auto credential login)
  ACUITY_ADMIN_PASSWORD  Login password (for auto credential login)
  CHROME_PATH            Chrome/Chromium executable path
`);
				process.exit(0);
		}
	}

	return options;
};

// ---------------------------------------------------------------------------
// Explore mode: dump DOM structure for selector development
// ---------------------------------------------------------------------------

const exploreMode = async (page: import('puppeteer-core').Page): Promise<void> => {
	console.error('[explore] Dumping page info...');
	const url = page.url();
	console.error(`[explore] Current URL: ${url}`);

	await screenshot('explore-current');

	const info = await page.evaluate(() => {
		const nav = Array.from(document.querySelectorAll('nav a, .nav a, #nav a, [class*="nav"] a'))
			.map((a) => ({
				text: a.textContent?.trim(),
				href: (a as HTMLAnchorElement).href,
				classes: a.className,
			}))
			.slice(0, 30);

		const tables = Array.from(document.querySelectorAll('table')).map((t) => ({
			id: t.id,
			classes: t.className,
			rows: t.rows.length,
			headers: Array.from(t.querySelectorAll('th')).map((th) => th.textContent?.trim()),
		}));

		const forms = Array.from(document.querySelectorAll('form')).map((f) => ({
			id: f.id,
			action: f.action,
			inputs: Array.from(f.querySelectorAll('input, select, textarea')).map((i) => ({
				tag: i.tagName,
				type: (i as HTMLInputElement).type,
				name: (i as HTMLInputElement).name,
				id: i.id,
			})),
		}));

		const mainContent = document.querySelector('#main-content, #content, main, .main')
			?.innerHTML?.substring(0, 3000);

		return { nav, tables, forms, mainContent, title: document.title };
	});

	console.log(JSON.stringify(info, null, 2));
	console.error('[explore] Done. Use this info to update selectors.ts');
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
	const options = parseArgs(process.argv.slice(2));

	console.error('[acuity-admin] Starting...');
	console.error(`[acuity-admin] Mode: ${options.execute ? 'EXECUTE' : 'DRY-RUN'}`);
	console.error(`[acuity-admin] Auth: ${options.cookies ? 'cookies' : options.headed ? 'interactive' : 'credentials'}`);

	try {
		// Launch browser
		console.error('[acuity-admin] Launching browser...');
		const { page } = await launchBrowser({ headless: !options.headed });

		// ----- Authentication -----
		let authenticated = false;

		// Try cookies first (if provided)
		if (options.cookies) {
			console.error(`[acuity-admin] Loading cookies from ${options.cookies}...`);
			const loaded = await importCookies(page, options.cookies);
			if (loaded) {
				authenticated = await validateCookies(page);
			}
		}

		// Fall back to interactive login (headed mode)
		if (!authenticated && options.headed) {
			console.error('[acuity-admin] Starting interactive login...');
			await interactiveLogin(page);
			authenticated = true;

			// Save cookies if requested
			if (options.saveCookies) {
				await exportCookies(page, options.cookiePath);
			}
		}

		// Fall back to credential-based login
		if (!authenticated && !options.headed) {
			console.error('[acuity-admin] Attempting credential login...');
			try {
				await loginToAcuity(page);
				authenticated = true;

				// Also save cookies if requested
				if (options.saveCookies) {
					await exportCookies(page, options.cookiePath);
				}
			} catch (err) {
				console.error(`[acuity-admin] Credential login failed: ${err}`);
				console.error('[acuity-admin] Try running with --headed --save-cookies for manual login.');
				process.exitCode = 1;
				return;
			}
		}

		if (!authenticated) {
			console.error('[acuity-admin] Not authenticated. Provide --headed, --cookies, or env credentials.');
			process.exitCode = 1;
			return;
		}

		// ----- Explore mode -----
		if (options.explore) {
			await exploreMode(page);
			return;
		}

		// ----- Appointment processing -----
		const filter: AppointmentFilter = {
			startDate: new Date(options.startDate),
			endDate: options.endDate ? new Date(options.endDate) : new Date(),
			status: 'unpaid',
		};

		console.error('[acuity-admin] Fetching unpaid appointments...');
		console.error(`[acuity-admin] Date range: ${options.startDate} to ${options.endDate || 'today'}`);
		const appointments = await listAppointments(page, filter);
		console.error(`[acuity-admin] Found ${appointments.length} unpaid appointments`);

		// Identify discount-eligible appointments
		const discountName = options.discountClient?.toLowerCase();
		const discountAppts = discountName
			? appointments.filter((a) => a.clientName.toLowerCase().includes(discountName))
			: [];
		const regularAppts = discountName
			? appointments.filter((a) => !a.clientName.toLowerCase().includes(discountName))
			: appointments;

		if (discountName && discountAppts.length > 0) {
			console.error(`[acuity-admin] ${discountAppts.length} appointments for "${options.discountClient}" will get $${options.discountAmount} discount`);
		}

		// Generate report
		const report = generateUnpaidReport(appointments, filter);
		const output = options.format === 'json' ? toJSON(report) : toCSV(report);

		// Output report
		if (options.output) {
			await writeFile(options.output, output, 'utf-8');
			console.error(`[acuity-admin] Report written to ${options.output}`);
		} else {
			console.log(output);
		}

		// Execute actions if requested
		if (options.execute && appointments.length > 0) {
			let success = 0;
			let failed = 0;
			let consecutiveFailures = 0;
			let aborted = false;

			// Group ALL appointments by week for efficient navigation
			const byWeek = new Map<string, typeof appointments>();
			for (const apt of appointments) {
				const week = apt.weekDate || 'unknown';
				if (!byWeek.has(week)) byWeek.set(week, []);
				byWeek.get(week)!.push(apt);
			}

			console.error(`[acuity-admin] Processing ${appointments.length} appointments across ${byWeek.size} weeks...`);
			console.error(`[acuity-admin] Circuit breaker: abort after ${options.maxConsecutiveFailures} consecutive failures`);

			for (const [week, weekAppts] of byWeek) {
				if (aborted) break;

				if (week === 'unknown') {
					console.error(`[acuity-admin] Skipping ${weekAppts.length} appointments with unknown week`);
					failed += weekAppts.length;
					continue;
				}

				// Navigate to this week
				console.error(`[acuity-admin] Navigating to week of ${week} (${weekAppts.length} appointments)...`);
				await navigateToWeek(page, week);

				for (const apt of weekAppts) {
					if (aborted) break;

					try {
						const isDiscount = discountName && apt.clientName.toLowerCase().includes(discountName);
						if (isDiscount && options.discountAmount > 0) {
							const note = `$${options.discountAmount} discount applied via automation`;
							console.error(`[acuity-admin]   ${apt.id} (${apt.clientName}) discount + mark paid...`);
							await discountAndMarkPaid(page, apt.id, options.discountAmount, note);
						} else {
							console.error(`[acuity-admin]   ${apt.id} (${apt.clientName}) mark paid...`);
							await markPaidCash(page, apt.id);
						}
						success++;
						consecutiveFailures = 0; // Reset on success
						console.error(`[acuity-admin]   Done.`);
					} catch (err) {
						failed++;
						consecutiveFailures++;
						console.error(`[acuity-admin]   FAILED (${consecutiveFailures}/${options.maxConsecutiveFailures}): ${err}`);
						await screenshot(`checkout-error-${apt.id}`);

						// Circuit breaker: abort if too many consecutive failures
						if (consecutiveFailures >= options.maxConsecutiveFailures) {
							console.error(`[acuity-admin] CIRCUIT BREAKER: ${consecutiveFailures} consecutive failures — aborting to prevent data corruption`);
							aborted = true;
						}

						// Check if the error is a SAFETY error (wrong panel) — always abort immediately
						const errMsg = String(err);
						if (errMsg.includes('SAFETY:')) {
							console.error(`[acuity-admin] SAFETY ABORT: Wrong appointment panel detected — stopping immediately`);
							aborted = true;
						}
					}
				}
			}

			if (aborted) {
				console.error(`[acuity-admin] ABORTED: ${success} success, ${failed} failed. Remaining appointments NOT processed.`);
				process.exitCode = 2;
			} else {
				console.error(`[acuity-admin] Checkout complete: ${success} success, ${failed} failed.`);
			}
		} else if (!options.execute && appointments.length > 0) {
			console.error('[acuity-admin] Dry-run complete. Use --execute to mark appointments as paid.');
			if (discountAppts.length > 0) {
				console.error(`[acuity-admin] With --execute, ${discountAppts.length} "${options.discountClient}" appointments would get $${options.discountAmount} discount.`);
			}
		}
	} catch (err) {
		console.error(`[acuity-admin] Fatal error: ${err}`);
		await screenshot('checkout-fatal');
		process.exitCode = 1;
	} finally {
		await closeBrowser();
		console.error('[acuity-admin] Browser closed.');
	}
};

main();
