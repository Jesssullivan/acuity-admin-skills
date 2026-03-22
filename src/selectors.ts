/**
 * Acuity Admin UI CSS Selector Registry
 *
 * Single source of truth for all CSS selectors targeting the Acuity admin panel.
 *
 * Architecture:
 *   - Login page: server-rendered PHP form
 *   - Post-login: React SPA (dashboard, nav) + PHP forms (appointment detail)
 *   - Calendar: React toolbar + PHP-rendered appointment grid
 *   - Appointment detail: side panel (form#appointment-details-page) opened by clicking calendar entry
 *
 * Login selectors: verified 2026-03-08 against login.php
 * Dashboard selectors: verified 2026-03-08 via headed explore (home.php)
 * Calendar selectors: verified 2026-03-08 via headless explore (appointments.php)
 * Detail selectors: verified 2026-03-08 via headless click-explore (side panel)
 *
 * When Acuity changes their admin DOM, fix this ONE file.
 */

export const AdminSelectors = {
	// -- Login page (verified 2026-03-08) --
	loginForm: '#login-form',
	loginEmailInput: 'input#username[name="username"]',
	loginPasswordInput: 'input#password[name="password"]',
	loginPasswordContainer: '#password-container',
	loginNextButton: 'input#next-button[name="login"]',
	loginUsernameError: '#username-error',
	loginAcuityContinue: '#acuity-continue',
	loginSquarespaceContinue: '#squarespace-continue',

	// -- Dashboard (verified 2026-03-08) --
	dashboardContainer: '#acuity-main-content',
	navCalendar: 'a[href*="appointments.php"]:not([href*="action="])',
	navClients: 'a[href*="/admin/clients"]',
	navInvoices: 'a[href*="/admin/invoices"]',
	navReports: 'a[href*="reports.php"]',
	navAvailability: 'a[href*="/admin/calendars"]',
	navAppointmentTypes: 'a[href*="appointmentTypes"]',
	navPaymentSettings: 'a[href*="payment-processor"]',

	// -- Calendar page (verified 2026-03-08) --
	// URL: appointments.php (week view by default)
	// Toolbar is React, grid is PHP-rendered
	calendarContent: '#appointment-content',
	calendarListContainer: '.appointment-list-container',
	calendarToolbar: '.react-appointment-calendar-toolbar',
	calendarNavPrev: '#nav-previous',
	calendarNavNext: '#nav-next',
	calendarNavToday: '[data-testid="calendar-toolbar-today"]',
	calendarViewSelector: '[data-testid="calendar-view-selector"]',
	calendarMonthSelect: '#chooseMonth',

	// -- Appointment entries on calendar (verified 2026-03-08) --
	// Each appointment is a div with id="appt:<appointmentId>:<calendarId>"
	// CSS class: .timeslot.appointment.cal_<calendarId>
	// Inner content: .appointment-inner
	// Text format: "ClientName:\n ServiceName\n TimeRange"
	// $ prefix on service name = UNPAID (e.g. "$TMD 1st Consultation")
	appointmentEntry: '[data-testid="appt-container"]',
	appointmentInner: '.appointment-inner',
	appointmentListingContainer: '[data-testid="appointment-listing-container"]',

	// -- Appointment detail side panel (verified 2026-03-08) --
	// Opens by clicking an appointment entry on the calendar.
	// NOT a standalone URL — it's an overlay on the calendar page.
	// Form: form#appointment-details-page
	// Action: /appointments.php?action=update&id=<ID>&origin=calendar
	// The panel has a "static view" (read-only) and "edit view" (enabled by clicking Edit).
	detailForm: 'form#appointment-details-page',
	detailContainer: '.appointment-details-container',
	detailPanelVisible: '.detail-nav-display',
	detailClose: '[data-testid="close-appointment-detail"]',
	detailEdit: '[data-testid="edit-appt-button"]',
	detailReschedule: '[data-testid="reschedule-button"]',
	detailCancel: '[data-testid="cancel-appointment-btn"]',
	detailSave: '[data-testid="save-edit-appt"]',
	detailOptionsGear: '[data-testid="appointment-options-gear-icon"]',

	// -- Appointment detail fields (verified 2026-03-08) --
	// These are inside form#appointment-details-page
	detailFirstName: 'input[name="first_name"]',
	detailLastName: 'input[name="last_name"]',
	detailPhone: 'input[name="phone"]',
	detailEmail: 'input[name="email"]',
	detailAppointmentType: 'select#appointmentType[name="appointmentType"]',
	detailCalendar: 'select[name="calendar"]',
	detailPrice: 'input[name="priceSold"]',
	detailIsPaid: 'input#isPaid[name="isPaid"]',
	detailCertificateCode: 'input#certificateCode[name="certificateCode"]',
	detailClientSearch: '#client-user-typeahead',
	detailClientId: '#clientID',
	detailNotes: 'textarea#appt-notes[name="notes"]',
	detailCsrf: 'input[name="__csrf_magic"]',

	// -- Payment display (verified 2026-03-08) --
	paymentPrice: '.payment-price',
	paymentDeduction: '.payment-deduction',
	paymentSection: '.payment',
	totalPrice: '.total-price',
} as const;

export type AdminSelectorKey = keyof typeof AdminSelectors;

/**
 * Try selectors in order, return the first matching selector string.
 * Works with both string and string[] selector values.
 * Returns null if none match.
 */
export const findSelector = async (
	page: import('puppeteer-core').Page,
	candidates: string | readonly string[],
	timeout = 3000,
): Promise<string | null> => {
	const selectorList = typeof candidates === 'string' ? [candidates] : candidates;
	for (const selector of selectorList) {
		try {
			await page.waitForSelector(selector, { timeout });
			return selector;
		} catch {
			// Selector not found, try next
		}
	}
	return null;
};

/**
 * Resolve a selector from the registry — throws if none match.
 */
export const resolveSelector = async (
	page: import('puppeteer-core').Page,
	key: AdminSelectorKey,
	timeout = 3000,
): Promise<string> => {
	const candidates = AdminSelectors[key];
	const found = await findSelector(page, candidates, timeout);
	if (!found) {
		const list = typeof candidates === 'string' ? candidates : (candidates as readonly string[]).join(', ');
		throw new Error(
			`Selector "${key}" not found. Tried: [${list}] within ${timeout}ms`,
		);
	}
	return found;
};
