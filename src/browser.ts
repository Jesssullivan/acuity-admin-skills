/**
 * Browser Service for Acuity Admin automation.
 *
 * Manages Puppeteer browser lifecycle — launch, page creation, cleanup.
 * Pattern inspired by scheduling-kit's browser-service.ts but without Effect TS
 * (keeping this package lightweight and dependency-free beyond puppeteer-core).
 */

import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import type { BrowserOptions } from './types.js';

const DEFAULT_OPTIONS: Required<BrowserOptions> = {
  headless: true,
  executablePath: '',
  timeout: 30000,
  viewportWidth: 1280,
  viewportHeight: 800,
  screenshotDir: '/tmp/acuity-admin-screenshots',
};

let activeBrowser: Browser | null = null;
let activePage: Page | null = null;

/**
 * Resolve the Chrome/Chromium executable path.
 * Priority: options.executablePath > CHROME_PATH env var > error.
 */
const resolveExecutablePath = (options: BrowserOptions): string => {
  const path = options.executablePath || process.env.CHROME_PATH || '';
  if (!path) {
    throw new Error(
      'No Chrome/Chromium executable found. Set CHROME_PATH env var or pass executablePath option.',
    );
  }
  return path;
};

/**
 * Launch a Puppeteer browser instance.
 * Returns the browser and a managed page with the configured viewport.
 */
export const launchBrowser = async (
  options: BrowserOptions = {},
): Promise<{ browser: Browser; page: Page }> => {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const executablePath = resolveExecutablePath(opts);

  const browser = await puppeteer.launch({
    headless: opts.headless,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({
    width: opts.viewportWidth,
    height: opts.viewportHeight,
  });
  page.setDefaultTimeout(opts.timeout);
  page.setDefaultNavigationTimeout(opts.timeout);

  activeBrowser = browser;
  activePage = page;

  return { browser, page };
};

/**
 * Take a screenshot of the active page.
 * Useful for debugging failures.
 */
export const screenshot = async (
  label: string,
  options: { screenshotDir?: string } = {},
): Promise<Buffer | null> => {
  if (!activePage || activePage.isClosed()) {
    return null;
  }

  const dir = options.screenshotDir || DEFAULT_OPTIONS.screenshotDir;
  const path = `${dir}/${label}-${Date.now()}.png`;

  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
  } catch {
    // Directory creation may fail in some environments
  }

  const buffer = await activePage.screenshot({ path, fullPage: true });
  return Buffer.from(buffer);
};

/**
 * Close the browser and clean up resources.
 */
export const closeBrowser = async (): Promise<void> => {
  if (activePage && !activePage.isClosed()) {
    try {
      await activePage.close();
    } catch {
      // Page may already be closed
    }
  }
  activePage = null;

  if (activeBrowser) {
    try {
      await activeBrowser.close();
    } catch {
      // Browser may already be closed
    }
  }
  activeBrowser = null;
};

/**
 * Get the currently active page, or null if no browser is running.
 */
export const getActivePage = (): Page | null => activePage;

/**
 * Get the currently active browser, or null if not launched.
 */
export const getActiveBrowser = (): Browser | null => activeBrowser;
