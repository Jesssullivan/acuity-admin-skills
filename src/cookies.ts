/**
 * Cookie Export/Import for Session Persistence
 *
 * Enables a two-phase workflow:
 *   1. Interactive login (headed browser) → export cookies to JSON file
 *   2. Headless automation → import cookies → skip login entirely
 *
 * Cookie jar files are plain JSON, portable across machines:
 *   {
 *     "exportedAt": "2026-03-08T...",
 *     "domain": "secure.acuityscheduling.com",
 *     "cookies": [{ name, value, domain, path, expires, ... }]
 *   }
 *
 * Usage:
 *   // After manual login:
 *   await exportCookies(page, '~/.acuity-cookies.json');
 *
 *   // Before automation:
 *   await importCookies(page, '~/.acuity-cookies.json');
 *   await page.goto('https://secure.acuityscheduling.com/...');
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Page, Cookie } from 'puppeteer-core';
import type { CookieJar, SerializedCookie } from './types.js';

const ACUITY_DOMAIN = 'secure.acuityscheduling.com';
const DEFAULT_COOKIE_PATH = '.acuity-cookies.json';

/**
 * Export all cookies for the Acuity domain from the current browser session.
 * Saves to a JSON file that can be imported later.
 */
export const exportCookies = async (
	page: Page,
	filePath: string = DEFAULT_COOKIE_PATH,
): Promise<number> => {
	const client = await page.createCDPSession();
	const { cookies } = await client.send('Network.getAllCookies') as { cookies: Cookie[] };
	await client.detach();

	// Filter to Acuity-related domains
	const acuityCookies = cookies.filter(
		(c) =>
			c.domain.includes('acuityscheduling.com') ||
			c.domain.includes('squarespace.com') ||
			c.domain.includes('squareup.com'),
	);

	const serialized: SerializedCookie[] = acuityCookies.map((c) => ({
		name: c.name,
		value: c.value,
		domain: c.domain,
		path: c.path,
		expires: c.expires,
		httpOnly: c.httpOnly ?? false,
		secure: c.secure,
		sameSite: c.sameSite as SerializedCookie['sameSite'],
	}));

	const jar: CookieJar = {
		exportedAt: new Date().toISOString(),
		domain: ACUITY_DOMAIN,
		cookies: serialized,
	};

	await mkdir(dirname(filePath), { recursive: true }).catch(() => {});
	await writeFile(filePath, JSON.stringify(jar, null, 2), 'utf-8');

	console.error(`[cookies] Exported ${serialized.length} cookies to ${filePath}`);
	return serialized.length;
};

/**
 * Import cookies from a JSON file into the current browser session.
 * Returns true if cookies were loaded, false if file doesn't exist or is expired.
 */
export const importCookies = async (
	page: Page,
	filePath: string = DEFAULT_COOKIE_PATH,
): Promise<boolean> => {
	let raw: string;
	try {
		raw = await readFile(filePath, 'utf-8');
	} catch {
		console.error(`[cookies] No cookie file found at ${filePath}`);
		return false;
	}

	const jar: CookieJar = JSON.parse(raw);

	// Check if cookies are expired (older than 24 hours as a safety margin)
	const exportedAt = new Date(jar.exportedAt);
	const ageMs = Date.now() - exportedAt.getTime();
	const ageHours = ageMs / (1000 * 60 * 60);

	if (ageHours > 24) {
		console.error(
			`[cookies] Cookie file is ${ageHours.toFixed(1)} hours old — may be expired. ` +
				'Re-run with --headed to refresh.',
		);
	}

	// Filter out already-expired cookies
	const now = Date.now() / 1000;
	const validCookies = jar.cookies.filter(
		(c) => c.expires === -1 || c.expires === 0 || c.expires > now,
	);

	if (validCookies.length === 0) {
		console.error('[cookies] All cookies have expired. Re-run with --headed to log in again.');
		return false;
	}

	// Set cookies on the page
	await page.setCookie(
		...validCookies.map((c) => ({
			name: c.name,
			value: c.value,
			domain: c.domain,
			path: c.path,
			expires: c.expires,
			httpOnly: c.httpOnly,
			secure: c.secure,
			sameSite: c.sameSite,
		})),
	);

	console.error(
		`[cookies] Imported ${validCookies.length}/${jar.cookies.length} cookies ` +
			`(exported ${ageHours.toFixed(1)} hours ago)`,
	);
	return true;
};

/**
 * Check if saved cookies result in an authenticated session.
 * Navigates to a known admin page and checks if we get redirected to login.
 */
export const validateCookies = async (page: Page): Promise<boolean> => {
	const testUrl = `https://${ACUITY_DOMAIN}/appointments.php`;
	await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
	await new Promise((r) => setTimeout(r, 3000));

	const currentUrl = page.url();

	// Check both URL and page content — expired sessions render login form
	// at the same URL without redirecting
	const hasLoginForm = await page.evaluate(() => {
		const body = document.body?.textContent || '';
		return (
			body.includes('Log in to Acuity') ||
			body.includes('logged out') ||
			body.includes('FORGOT PASSWORD') ||
			!!document.querySelector('#login-form') ||
			!!document.querySelector('input#username[name="username"]')
		);
	});

	const isLoggedIn = !currentUrl.includes('login') && !hasLoginForm;

	if (isLoggedIn) {
		console.error('[cookies] Session is valid — authenticated!');
	} else {
		console.error('[cookies] Session expired — need to log in again.');
	}

	return isLoggedIn;
};
