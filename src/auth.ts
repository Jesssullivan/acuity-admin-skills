/**
 * Acuity Admin Authentication
 *
 * Handles login to the Acuity Scheduling admin panel.
 * Login is a TWO-STEP flow:
 *   1. Enter email → click NEXT
 *   2. Password container appears → enter password → submit
 *
 * reCAPTCHA Enterprise (invisible) is present. Headless browsers may be
 * scored lower — the reCAPTCHA token is submitted automatically via
 * invisible mode. If reCAPTCHA blocks, consider:
 *   - Using a non-headless browser (--headed flag)
 *   - Adding realistic user-agent and viewport
 *   - Adding delays between actions to mimic human timing
 *
 * Three possible flows after entering email:
 *   A. Direct password — email has Acuity-only account
 *   B. Choose provider — "Continue with Acuity Scheduling" vs "Continue with Squarespace"
 *   C. Cookie-based — manually log in once (headed), export cookies for reuse
 *
 * For OAuth accounts (e.g., jess@sulliwood.org via Squarespace SSO), use
 * loginWithCookies() after manual login, or run headed mode for interactive SSO.
 *
 * Credentials can be passed directly or read from env vars:
 *   ACUITY_ADMIN_EMAIL
 *   ACUITY_ADMIN_PASSWORD
 */

import type { Page } from 'puppeteer-core';
import type { AcuityCredentials } from './types.js';
import { AdminSelectors, findSelector } from './selectors.js';

const ACUITY_LOGIN_URL = 'https://secure.acuityscheduling.com/login.php';

/**
 * Resolve credentials from arguments or environment variables.
 */
export const resolveCredentials = (
	credentials?: Partial<AcuityCredentials>,
): AcuityCredentials => {
	const email = credentials?.email || process.env.ACUITY_ADMIN_EMAIL || '';
	const password = credentials?.password || process.env.ACUITY_ADMIN_PASSWORD || '';

	if (!email || !password) {
		throw new Error(
			'Acuity admin credentials required. Pass them directly or set ' +
				'ACUITY_ADMIN_EMAIL and ACUITY_ADMIN_PASSWORD env vars.',
		);
	}

	return { email, password };
};

/**
 * Small delay to mimic human interaction timing.
 */
const humanDelay = (ms = 500) => new Promise((r) => setTimeout(r, ms + Math.random() * 300));

/**
 * Log into the Acuity admin panel.
 *
 * Two-step flow:
 *   1. Navigate to login.php
 *   2. Enter email in #username field
 *   3. Click #next-button (NEXT)
 *   4. Wait for #password-container to become visible
 *   5. Enter password in #password field
 *   6. Click submit (the same #next-button changes to LOG IN)
 *   7. Wait for dashboard to load
 *
 * @param page - Puppeteer page instance
 * @param credentials - Email/password (falls back to env vars)
 * @returns The page, now authenticated
 */
export const loginToAcuity = async (
	page: Page,
	credentials?: Partial<AcuityCredentials>,
): Promise<Page> => {
	const creds = resolveCredentials(credentials);

	// Set a realistic user-agent to help with reCAPTCHA scoring
	await page.setUserAgent(
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
	);

	// Navigate to login page
	console.error('[auth] Navigating to login page...');
	await page.goto(ACUITY_LOGIN_URL, { waitUntil: 'networkidle0' });

	// Step 1: Enter email
	console.error('[auth] Entering email...');
	await page.waitForSelector(AdminSelectors.loginEmailInput, { timeout: 10000 });
	await humanDelay(300);
	await page.click(AdminSelectors.loginEmailInput);
	await page.type(AdminSelectors.loginEmailInput, creds.email, { delay: 80 });

	// Step 2: Click NEXT
	console.error('[auth] Clicking NEXT...');
	await humanDelay(500);
	await page.click(AdminSelectors.loginNextButton);

	// Step 3: Wait for password container to appear
	console.error('[auth] Waiting for password field...');
	await page.waitForFunction(
		(sel) => {
			const el = document.querySelector(sel);
			return el && getComputedStyle(el).display !== 'none';
		},
		{ timeout: 10000 },
		AdminSelectors.loginPasswordContainer,
	);

	// Check for username error (invalid email)
	const usernameError = await page.$(AdminSelectors.loginUsernameError);
	if (usernameError) {
		const errorText = await usernameError.evaluate((el) => {
			const style = getComputedStyle(el);
			return style.display !== 'none' ? el.textContent?.trim() : '';
		});
		if (errorText) {
			throw new Error(`Login failed — username error: ${errorText}`);
		}
	}

	// Step 4: Enter password
	console.error('[auth] Entering password...');
	await humanDelay(300);
	await page.click(AdminSelectors.loginPasswordInput);
	await page.type(AdminSelectors.loginPasswordInput, creds.password, { delay: 60 });

	// Step 5: Submit (click the same button, which is now "Log In")
	console.error('[auth] Submitting login...');
	await humanDelay(500);
	await page.click(AdminSelectors.loginNextButton);

	// Step 6: Wait for navigation to dashboard
	console.error('[auth] Waiting for dashboard...');
	try {
		await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 });
	} catch {
		// Some redirects may not trigger a full navigation event
	}

	// Step 7: Verify we reached the dashboard
	const currentUrl = page.url();
	console.error(`[auth] Post-login URL: ${currentUrl}`);

	// Check if we're still on the login page (reCAPTCHA or wrong password)
	if (currentUrl.includes('login.php')) {
		// Check for error messages
		const errorText = await page.evaluate(() => {
			const errors = document.querySelectorAll('.error');
			return Array.from(errors)
				.map((e) => e.textContent?.trim())
				.filter(Boolean)
				.join('; ');
		});
		throw new Error(
			`Login failed — still on login page. Errors: ${errorText || 'none visible (possible reCAPTCHA block)'}`,
		);
	}

	console.error('[auth] Login successful!');
	return page;
};

/**
 * Check if the page is currently authenticated by looking for
 * admin-only elements or URL patterns.
 */
export const isAuthenticated = async (page: Page): Promise<boolean> => {
	const url = page.url();
	// Logged-in pages use the /app/ path or direct .php pages without login
	if (url.includes('login.php')) return false;
	if (url.includes('secure.acuityscheduling.com') && !url.includes('login')) return true;

	// Try to find dashboard-specific elements
	const dashboard = await findSelector(page, AdminSelectors.dashboardContainer, 2000);
	return dashboard !== null;
};

/**
 * Interactive login — opens the login page in a headed browser and waits
 * for the user to complete login manually (handles OAuth, 2FA, reCAPTCHA, etc.).
 *
 * The script polls the URL until it leaves login.php, then returns control.
 * This is the most reliable method for accounts using SSO (Squarespace, Google).
 *
 * @param page - Puppeteer page instance (must be headed/visible)
 * @param timeoutMs - Max wait time for user to complete login (default: 5 min)
 */
export const interactiveLogin = async (
	page: Page,
	timeoutMs = 300_000,
): Promise<Page> => {
	console.error('[auth] Opening login page for manual authentication...');
	console.error('[auth] Please log in using your browser. The script will wait.');
	await page.goto(ACUITY_LOGIN_URL, { waitUntil: 'networkidle0' });

	const startTime = Date.now();
	const pollInterval = 2000;

	// URLs that indicate we're still in the login/OAuth flow (NOT authenticated yet)
	const loginFlowPatterns = [
		'login.php',
		'forgotpass',
		'login.squarespace.com',
		'accounts.google.com',
		'/oauth/',
		'/oauth2/',
		'/authorize',
		'/callback',
	];

	while (Date.now() - startTime < timeoutMs) {
		const url = page.url();
		const inLoginFlow = loginFlowPatterns.some((p) => url.includes(p));

		// Must be on acuityscheduling.com AND not in any login/OAuth flow
		if (url.includes('secure.acuityscheduling.com') && !inLoginFlow) {
			console.error(`[auth] Login detected! Now at: ${url}`);
			// Wait for the page to fully settle
			try {
				await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 5000 }).catch(() => {});
			} catch {
				// Already settled
			}
			await humanDelay(1000);
			return page;
		}

		await new Promise((r) => setTimeout(r, pollInterval));
		const elapsed = Math.round((Date.now() - startTime) / 1000);
		if (elapsed % 10 === 0) {
			console.error(`[auth] Waiting for login... (${elapsed}s, current: ${url.substring(0, 80)}...)`);
		}
	}

	throw new Error(
		`Interactive login timed out after ${timeoutMs / 1000}s. ` +
			'The user did not complete login in time.',
	);
};
