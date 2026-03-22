/**
 * @tummycrypt/acuity-admin
 *
 * Puppeteer-based browser automation for the Acuity Scheduling admin UI.
 * Provides tools for listing appointments, marking payments, applying
 * discounts, and generating unpaid reports.
 */

// Types
export type {
  AcuityCredentials,
  AppointmentFilter,
  AppointmentRecord,
  CheckoutAction,
  UnpaidReport,
  BrowserOptions,
  SerializedCookie,
  CookieJar,
} from './types.js';

// Browser lifecycle
export { launchBrowser, closeBrowser, screenshot, getActivePage, getActiveBrowser } from './browser.js';

// Authentication
export { loginToAcuity, interactiveLogin, isAuthenticated, resolveCredentials } from './auth.js';

// Cookie persistence
export { exportCookies, importCookies, validateCookies } from './cookies.js';

// Appointment navigation
export {
  listAppointments,
  getAppointmentDetail,
  scrapeCalendarAppointments,
  openAppointmentDetail,
  closeAppointmentDetail,
  readAppointmentDetail,
  navigateToWeek,
} from './appointments.js';

// Actions
export { markPaidCash, applyDiscount, discountAndMarkPaid, executeAction } from './actions.js';

// Report generation
export { generateUnpaidReport, toCSV, toJSON } from './report.js';

// Selectors (for advanced use / DOM inspection)
export { AdminSelectors, findSelector, resolveSelector } from './selectors.js';
export type { AdminSelectorKey } from './selectors.js';
