/**
 * Appointment Navigation and Scraping
 *
 * Navigate the Acuity admin calendar and extract appointment data.
 *
 * Calendar structure (verified 2026-03-08):
 *   - URL: appointments.php (week view by default)
 *   - Each appointment: div#appt:<id>:<calId> with class .timeslot.appointment
 *   - Inner text: "ClientName:\n ServiceName\n TimeRange"
 *   - $ prefix on service = UNPAID
 *   - Toolbar has prev/next week navigation (#nav-previous, #nav-next)
 *   - Week title in .react-appointment-calendar-toolbar[data-day="YYYY-MM-DD"]
 *
 * Appointment detail (side panel, verified 2026-03-08):
 *   - Opens by clicking appointment entry on calendar
 *   - Form: form#appointment-details-page
 *   - Fields: first_name, last_name, priceSold, isPaid, certificateCode, notes
 *   - Must click "Edit" button before fields are editable
 */

import type { Page } from 'puppeteer-core';
import type { AppointmentFilter, AppointmentRecord } from './types.js';
import { AdminSelectors, findSelector } from './selectors.js';

const ACUITY_CALENDAR_URL = 'https://secure.acuityscheduling.com/appointments.php';

const humanDelay = (ms = 500) => new Promise((r) => setTimeout(r, ms + Math.random() * 300));

/**
 * Format a Date as YYYY-MM-DD.
 */
const formatDate = (date: Date): string => {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
};

/**
 * Parse an appointment entry's text content into structured data.
 *
 * Format: "ClientName:\n $ServiceName\n TimeRange"
 * The $ prefix indicates unpaid status.
 */
const parseAppointmentText = (text: string): { clientName: string; service: string; time: string; unpaid: boolean } => {
	const lines = text
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);

	const clientName = (lines[0] || '').replace(/:$/, '').trim();
	const serviceLine = lines[1] || '';
	const unpaid = serviceLine.startsWith('$');
	const service = unpaid ? serviceLine.substring(1).trim() : serviceLine.trim();
	const time = lines[2] || '';

	return { clientName, service, time, unpaid };
};

/**
 * Parse a price string like "$150.00" or "150.00" to a number.
 */
const parsePrice = (priceStr: string): number => {
	const cleaned = priceStr.replace(/[^0-9.]/g, '');
	return parseFloat(cleaned) || 0;
};

/**
 * Navigate to the calendar for a specific week.
 */
export const navigateToWeek = async (page: Page, date: string): Promise<void> => {
	const url = `${ACUITY_CALENDAR_URL}?view=thisWeek&day=${date}`;
	await page.goto(url, { waitUntil: 'domcontentloaded' });
	await humanDelay(2000);
	// Wait for calendar to render
	await findSelector(page, AdminSelectors.calendarContent, 10000);
};

/**
 * Get the current week's date from the calendar toolbar.
 */
export const getCurrentWeekDate = async (page: Page): Promise<string> => {
	const toolbar = await page.$(AdminSelectors.calendarToolbar);
	if (!toolbar) return '';
	return (await toolbar.evaluate((el) => el.getAttribute('data-day'))) || '';
};

/**
 * Scrape all appointment entries from the current calendar view.
 * Returns raw data from the calendar grid — no detail panel needed.
 */
export const scrapeCalendarAppointments = async (page: Page): Promise<AppointmentRecord[]> => {
	const entries = await page.$$(AdminSelectors.appointmentEntry);
	const appointments: AppointmentRecord[] = [];

	for (const entry of entries) {
		try {
			const data = await entry.evaluate((el) => {
				const id = el.id || '';
				const text = el.textContent?.trim() || '';
				const classes = el.className || '';
				return { id, text, classes };
			});

			// Parse appointment ID from div id="appt:<id>:<calId>"
			const idMatch = data.id.match(/^appt:(\d+):(\d+)$/);
			if (!idMatch) continue;

			const appointmentId = idMatch[1];
			const parsed = parseAppointmentText(data.text);

			appointments.push({
				id: appointmentId,
				date: new Date(), // Will be refined from week context
				clientName: parsed.clientName,
				service: parsed.service,
				duration: 0, // Not available from calendar grid
				price: 0, // Need detail panel for price
				paid: !parsed.unpaid,
				notes: undefined,
			});
		} catch {
			// Skip entries that fail to parse
		}
	}

	return appointments;
};

/**
 * Open the detail side panel for a specific appointment by clicking it.
 * Closes any existing panel first, waits for it to disappear, then opens the target.
 * Retries once if the wrong panel opens (React SPA timing issue).
 */
export const openAppointmentDetail = async (page: Page, appointmentId: string): Promise<boolean> => {
	// Close any existing detail panel first and wait for it to disappear
	try {
		const existingPanel = await page.$(AdminSelectors.detailForm);
		if (existingPanel) {
			await closeAppointmentDetail(page);
		}
	} catch {
		// Panel close failed — not critical, continue
	}

	const selector = `[id^="appt:${appointmentId}"]`;
	const entry = await page.$(selector);
	if (!entry) return false;

	// Click the appointment entry
	await entry.click();
	await humanDelay(1000);

	// Wait for detail panel to appear
	const panel = await findSelector(page, AdminSelectors.detailForm, 10000);
	if (!panel) return false;

	// Verify we opened the right appointment by checking the form action URL
	const formId = await page.evaluate((sel) => {
		const form = document.querySelector(sel) as HTMLFormElement;
		const action = form?.action || '';
		const match = action.match(/id=(\d+)/);
		return match?.[1] || '';
	}, AdminSelectors.detailForm);

	if (formId && formId !== appointmentId) {
		// Wrong panel — close it, wait, and retry once
		console.error(`[appointments] Wrong panel (got ${formId}, want ${appointmentId}) — retrying...`);
		await closeAppointmentDetail(page);

		const retryEntry = await page.$(selector);
		if (!retryEntry) return false;

		await retryEntry.click();
		await humanDelay(1500);

		const retryPanel = await findSelector(page, AdminSelectors.detailForm, 10000);
		if (!retryPanel) return false;

		const retryId = await page.evaluate((sel) => {
			const form = document.querySelector(sel) as HTMLFormElement;
			const action = form?.action || '';
			const match = action.match(/id=(\d+)/);
			return match?.[1] || '';
		}, AdminSelectors.detailForm);

		if (retryId && retryId !== appointmentId) {
			console.error(`[appointments] WARNING: Expected appointment ${appointmentId} but panel shows ${retryId} after retry`);
			await closeAppointmentDetail(page);
			return false;
		}
	}

	return true;
};

/**
 * Close the appointment detail side panel and wait for it to disappear.
 */
export const closeAppointmentDetail = async (page: Page): Promise<void> => {
	try {
		const closeBtn = await page.$(AdminSelectors.detailClose);
		if (closeBtn) {
			await closeBtn.click();
		} else {
			// No close button — try clicking the calendar background
			await page.click(AdminSelectors.calendarContent);
		}
	} catch {
		// Click failed — try clicking calendar background as fallback
		try {
			await page.click(AdminSelectors.calendarContent);
		} catch {
			// Best effort — continue
		}
	}

	// Wait for panel to actually disappear from the DOM
	try {
		await page.waitForSelector(AdminSelectors.detailForm, { hidden: true, timeout: 5000 });
	} catch {
		// Panel didn't disappear — force it by navigating away briefly isn't practical,
		// but we can try clicking the close button one more time
		try {
			const closeBtn = await page.$(AdminSelectors.detailClose);
			if (closeBtn) {
				await closeBtn.click();
				await page.waitForSelector(AdminSelectors.detailForm, { hidden: true, timeout: 3000 });
			}
		} catch {
			// Give up — the panel is stuck
		}
	}
	await humanDelay(300);
};

/**
 * Read appointment detail fields from the open side panel.
 */
export const readAppointmentDetail = async (page: Page): Promise<AppointmentRecord | null> => {
	const form = await page.$(AdminSelectors.detailForm);
	if (!form) return null;

	const data = await page.evaluate((sel) => {
		const form = document.querySelector(sel.detailForm);
		if (!form) return null;

		const getValue = (s: string) => {
			const el = form.querySelector(s) as HTMLInputElement | HTMLTextAreaElement | null;
			return el?.value || '';
		};

		const getChecked = (s: string) => {
			const el = form.querySelector(s) as HTMLInputElement | null;
			return el?.checked || false;
		};

		// Extract appointment ID from form action URL
		const action = (form as HTMLFormElement).action || '';
		const idMatch = action.match(/id=(\d+)/);
		const id = idMatch?.[1] || '';

		return {
			id,
			firstName: getValue(sel.detailFirstName),
			lastName: getValue(sel.detailLastName),
			phone: getValue(sel.detailPhone),
			email: getValue(sel.detailEmail),
			price: getValue(sel.detailPrice),
			isPaid: getChecked(sel.detailIsPaid),
			notes: getValue(sel.detailNotes),
			certificateCode: getValue(sel.detailCertificateCode),
		};
	}, AdminSelectors);

	if (!data) return null;

	return {
		id: data.id,
		date: new Date(),
		clientName: `${data.firstName} ${data.lastName}`.trim(),
		service: '', // Not easily extractable from select
		duration: 0,
		price: parsePrice(data.price),
		paid: data.isPaid,
		notes: data.notes || undefined,
	};
};

/**
 * Navigate week by week through the calendar, collecting appointments.
 * Stops when the current week is past the endDate.
 *
 * IMPORTANT: The calendar $ prefix is NOT a reliable indicator of paid status.
 * Use verifyPaidStatus=true (or filter.status='unpaid') to open each appointment's
 * detail panel and check the actual isPaid checkbox. This is slower but accurate.
 */
export const listAppointments = async (
	page: Page,
	filter: AppointmentFilter,
): Promise<AppointmentRecord[]> => {
	const startDate = formatDate(filter.startDate);
	const endDate = formatDate(filter.endDate);

	// Start at the filter start date
	console.error(`[appointments] Navigating to week of ${startDate}...`);
	await navigateToWeek(page, startDate);

	const allAppointments: AppointmentRecord[] = [];
	let currentDate = startDate;
	let weekCount = 0;
	const maxWeeks = 100; // Safety limit

	while (currentDate <= endDate && weekCount < maxWeeks) {
		weekCount++;
		const weekAppts = await scrapeCalendarAppointments(page);
		// Tag each appointment with its calendar week for later navigation
		for (const appt of weekAppts) {
			appt.weekDate = currentDate;
		}
		console.error(`[appointments] Week of ${currentDate}: ${weekAppts.length} appointments`);
		allAppointments.push(...weekAppts);

		// Navigate to next week
		const nextLink = await page.$(AdminSelectors.calendarNavNext);
		if (!nextLink) break;

		await nextLink.click();
		await humanDelay(2000);
		await findSelector(page, AdminSelectors.calendarContent, 10000);

		const newDate = await getCurrentWeekDate(page);
		if (!newDate || newDate <= currentDate) break; // Safety: no progress
		currentDate = newDate;
	}

	console.error(`[appointments] Scanned ${weekCount} weeks, found ${allAppointments.length} total`);

	// Apply client name filter first (fast, reduces detail panel checks needed)
	let filtered = allAppointments;
	if (filter.clientName) {
		const name = filter.clientName.toLowerCase();
		filtered = filtered.filter((a) => a.clientName.toLowerCase().includes(name));
	}

	// For paid/unpaid filtering, verify via detail panel (calendar $ prefix is unreliable)
	if (filter.status === 'unpaid' || filter.status === 'paid') {
		console.error(`[appointments] Verifying paid status via detail panel for ${filtered.length} appointments...`);
		filtered = await verifyPaidStatusBatch(page, filtered, filter.status);
	}

	return filtered;
};

/**
 * Verify paid status by opening each appointment's detail panel.
 * Groups by week for efficient navigation. Returns only appointments
 * matching the desired status.
 */
const verifyPaidStatusBatch = async (
	page: Page,
	appointments: AppointmentRecord[],
	desiredStatus: 'paid' | 'unpaid',
): Promise<AppointmentRecord[]> => {
	const wantPaid = desiredStatus === 'paid';
	const verified: AppointmentRecord[] = [];

	// Group by week for efficient navigation
	const byWeek = new Map<string, AppointmentRecord[]>();
	for (const apt of appointments) {
		const week = apt.weekDate || 'unknown';
		if (!byWeek.has(week)) byWeek.set(week, []);
		byWeek.get(week)!.push(apt);
	}

	let checked = 0;
	for (const [week, weekAppts] of byWeek) {
		if (week === 'unknown') continue;
		await navigateToWeek(page, week);

		for (const apt of weekAppts) {
			checked++;
			if (checked % 25 === 0) {
				console.error(`[appointments] Verified ${checked}/${appointments.length}...`);
			}

			const opened = await openAppointmentDetail(page, apt.id);
			if (!opened) continue;

			const isPaid = await page.evaluate((sel: string) => {
				const checkbox = document.querySelector(sel) as HTMLInputElement;
				return checkbox?.checked || false;
			}, AdminSelectors.detailIsPaid);

			const price = await page.evaluate((sel: string) => {
				const input = document.querySelector(sel) as HTMLInputElement;
				return parseFloat(input?.value || '0');
			}, AdminSelectors.detailPrice);

			apt.paid = isPaid;
			apt.price = price;

			if (isPaid === wantPaid) {
				verified.push(apt);
			}

			await closeAppointmentDetail(page);
			await humanDelay(200);
		}
	}

	console.error(`[appointments] Verified ${checked} appointments, ${verified.length} are ${desiredStatus}`);
	return verified;
};

/**
 * Get full details for a specific appointment by opening its detail panel.
 */
export const getAppointmentDetail = async (
	page: Page,
	appointmentId: string,
): Promise<AppointmentRecord | null> => {
	const opened = await openAppointmentDetail(page, appointmentId);
	if (!opened) return null;

	const detail = await readAppointmentDetail(page);
	await closeAppointmentDetail(page);
	return detail;
};
