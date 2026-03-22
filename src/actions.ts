/**
 * Appointment Actions
 *
 * Perform actions on appointments via the Acuity admin side panel.
 *
 * Detail panel workflow (verified 2026-03-08):
 *   1. Click appointment on calendar -> side panel opens (form#appointment-details-page)
 *   2. Panel starts in read-only "static view"
 *   3. Click "Edit" button (data-testid="edit-appt-button") to enable fields
 *   4. Modify fields (isPaid checkbox, priceSold, certificateCode, notes)
 *   5. Click "Save" (data-testid="save-edit-appt")
 *   6. Form POSTs to /appointments.php?action=update&id=<ID>
 *
 * The isPaid checkbox (input#isPaid) marks the appointment as paid.
 * There is no separate "payment method" selector — checking isPaid = paid.
 * The priceSold field can be modified for discounts.
 */

import type { Page } from 'puppeteer-core';
import type { CheckoutAction } from './types.js';
import { AdminSelectors, findSelector } from './selectors.js';
import { openAppointmentDetail, closeAppointmentDetail } from './appointments.js';

const humanDelay = (ms = 500) => new Promise((r) => setTimeout(r, ms + Math.random() * 300));

/**
 * Verify the currently open panel belongs to the expected appointment.
 * Returns the appointment ID from the form action URL.
 * Throws if the panel shows a different appointment.
 */
const verifyPanelId = async (page: Page, expectedId: string, context: string): Promise<void> => {
	const formId = await page.evaluate((sel) => {
		const form = document.querySelector(sel) as HTMLFormElement;
		const action = form?.action || '';
		const match = action.match(/id=(\d+)/);
		return match?.[1] || '';
	}, AdminSelectors.detailForm);

	if (!formId) {
		throw new Error(`[${context}] Cannot read form ID — panel may not be open`);
	}
	if (formId !== expectedId) {
		throw new Error(`[${context}] SAFETY: Panel shows appointment ${formId} but expected ${expectedId} — aborting to prevent wrong-appointment modification`);
	}
};

/**
 * Enable edit mode on the appointment detail panel.
 * Must be called before modifying any fields.
 */
const enableEditMode = async (page: Page): Promise<void> => {
	const editBtn = await page.$(AdminSelectors.detailEdit);
	if (!editBtn) {
		throw new Error('Edit button not found on detail panel');
	}
	await editBtn.click();
	await humanDelay(500);
};

/**
 * Save the appointment detail form.
 */
const saveAppointment = async (page: Page): Promise<void> => {
	const saveBtn = await page.$(AdminSelectors.detailSave);
	if (!saveBtn) {
		throw new Error('Save button not found on detail panel');
	}
	await saveBtn.click();

	// Wait for the save to complete (button text changes to "Saving...")
	await humanDelay(2000);

	// Check if the panel closed or shows success
	try {
		await page.waitForFunction(
			(sel) => {
				const btn = document.querySelector(sel) as HTMLInputElement;
				return !btn || btn.value !== 'Saving...';
			},
			{ timeout: 10000 },
			AdminSelectors.detailSave,
		);
	} catch {
		console.error('[actions] Save may not have completed cleanly');
	}
};

/**
 * Mark an appointment as paid.
 *
 * Workflow:
 * 1. Open appointment detail panel (click on calendar)
 * 2. Click "Edit" to enable fields
 * 3. Check the isPaid checkbox
 * 4. Click "Save"
 */
export const markPaidCash = async (
	page: Page,
	appointmentId: string,
): Promise<void> => {
	console.error(`[actions] Opening appointment ${appointmentId}...`);
	const opened = await openAppointmentDetail(page, appointmentId);
	if (!opened) {
		throw new Error(`Could not open appointment ${appointmentId} on current calendar view`);
	}

	// SAFETY: Verify the panel shows the correct appointment before any modifications
	await verifyPanelId(page, appointmentId, 'markPaidCash');

	// Check if already paid
	const isPaidAlready = await page.evaluate((sel) => {
		const checkbox = document.querySelector(sel) as HTMLInputElement;
		return checkbox?.checked || false;
	}, AdminSelectors.detailIsPaid);

	if (isPaidAlready) {
		console.error(`[actions] Appointment ${appointmentId} is already marked as paid, skipping`);
		await closeAppointmentDetail(page);
		return;
	}

	// Enable edit mode
	console.error(`[actions] Enabling edit mode...`);
	await enableEditMode(page);

	// SAFETY: Re-verify panel ID after entering edit mode (React may have swapped panels)
	await verifyPanelId(page, appointmentId, 'markPaidCash-postEdit');

	// Check the isPaid checkbox
	console.error(`[actions] Checking isPaid checkbox...`);
	await page.click(AdminSelectors.detailIsPaid);
	await humanDelay(300);

	// Save
	console.error(`[actions] Saving...`);
	await saveAppointment(page);

	// Close the detail panel to prevent stale panel bugs
	await closeAppointmentDetail(page);

	console.error(`[actions] Appointment ${appointmentId} marked as paid`);
};

/**
 * Apply a dollar discount to an appointment by modifying the price.
 *
 * Workflow:
 * 1. Open appointment detail panel
 * 2. Click "Edit" to enable fields
 * 3. Reduce priceSold by the discount amount
 * 4. Optionally add a note
 * 5. Click "Save"
 */
export const applyDiscount = async (
	page: Page,
	appointmentId: string,
	amount: number,
	note?: string,
): Promise<void> => {
	console.error(`[actions] Opening appointment ${appointmentId} for discount...`);
	const opened = await openAppointmentDetail(page, appointmentId);
	if (!opened) {
		throw new Error(`Could not open appointment ${appointmentId} on current calendar view`);
	}

	// SAFETY: Verify the panel shows the correct appointment
	await verifyPanelId(page, appointmentId, 'applyDiscount');

	// Read current price
	const currentPrice = await page.evaluate((sel) => {
		const input = document.querySelector(sel) as HTMLInputElement;
		return parseFloat(input?.value || '0');
	}, AdminSelectors.detailPrice);

	const newPrice = Math.max(0, currentPrice - amount);
	console.error(`[actions] Applying $${amount} discount: $${currentPrice} -> $${newPrice}`);

	// Enable edit mode
	await enableEditMode(page);

	// SAFETY: Re-verify panel ID after entering edit mode
	await verifyPanelId(page, appointmentId, 'applyDiscount-postEdit');

	// Clear and set new price
	await page.click(AdminSelectors.detailPrice, { count: 3 }); // Select all
	await page.type(AdminSelectors.detailPrice, newPrice.toFixed(2));

	// Add note if provided
	if (note) {
		const notesField = await page.$(AdminSelectors.detailNotes);
		if (notesField) {
			const existingNotes = await notesField.evaluate((el) => (el as HTMLTextAreaElement).value);
			const fullNote = existingNotes
				? `${existingNotes}\n${note}`
				: note;
			await page.evaluate(
				(sel, val) => {
					const el = document.querySelector(sel) as HTMLTextAreaElement;
					if (el) el.value = val;
				},
				AdminSelectors.detailNotes,
				fullNote,
			);
		}
	}

	// Save
	await saveAppointment(page);

	// Close the detail panel to prevent stale panel bugs
	await closeAppointmentDetail(page);
	await humanDelay(300);

	console.error(`[actions] Discount applied to appointment ${appointmentId}`);
};

/**
 * Apply a discount AND mark as paid in a single edit session.
 * More efficient than calling applyDiscount + markPaidCash separately
 * (one open/edit/save cycle instead of two).
 */
export const discountAndMarkPaid = async (
	page: Page,
	appointmentId: string,
	amount: number,
	note?: string,
): Promise<void> => {
	console.error(`[actions] Opening appointment ${appointmentId} for discount + mark paid...`);
	const opened = await openAppointmentDetail(page, appointmentId);
	if (!opened) {
		throw new Error(`Could not open appointment ${appointmentId} on current calendar view`);
	}

	// SAFETY: Verify the panel shows the correct appointment before any modifications
	await verifyPanelId(page, appointmentId, 'discountAndMarkPaid');

	// Read current price
	const currentPrice = await page.evaluate((sel) => {
		const input = document.querySelector(sel) as HTMLInputElement;
		return parseFloat(input?.value || '0');
	}, AdminSelectors.detailPrice);

	const newPrice = Math.max(0, currentPrice - amount);
	console.error(`[actions] Applying $${amount} discount: $${currentPrice} -> $${newPrice}, then marking paid`);

	// Enable edit mode
	await enableEditMode(page);

	// SAFETY: Re-verify panel ID after entering edit mode
	await verifyPanelId(page, appointmentId, 'discountAndMarkPaid-postEdit');

	// Clear and set new price
	await page.click(AdminSelectors.detailPrice, { count: 3 }); // Select all
	await page.type(AdminSelectors.detailPrice, newPrice.toFixed(2));

	// Check isPaid
	const isPaidAlready = await page.evaluate((sel) => {
		const checkbox = document.querySelector(sel) as HTMLInputElement;
		return checkbox?.checked || false;
	}, AdminSelectors.detailIsPaid);

	if (!isPaidAlready) {
		await page.click(AdminSelectors.detailIsPaid);
		await humanDelay(300);
	}

	// Add note if provided
	if (note) {
		const notesField = await page.$(AdminSelectors.detailNotes);
		if (notesField) {
			const existingNotes = await notesField.evaluate((el) => (el as HTMLTextAreaElement).value);
			const fullNote = existingNotes
				? `${existingNotes}\n${note}`
				: note;
			await page.evaluate(
				(sel, val) => {
					const el = document.querySelector(sel) as HTMLTextAreaElement;
					if (el) el.value = val;
				},
				AdminSelectors.detailNotes,
				fullNote,
			);
		}
	}

	// Save
	await saveAppointment(page);

	// Close the detail panel to prevent stale panel bugs
	await closeAppointmentDetail(page);

	console.error(`[actions] Appointment ${appointmentId}: discount applied + marked paid`);
};

/**
 * Execute a checkout action (mark paid or apply discount).
 */
export const executeAction = async (
	page: Page,
	action: CheckoutAction,
): Promise<void> => {
	switch (action.action) {
		case 'mark-paid-cash':
			return markPaidCash(page, action.appointmentId);
		case 'apply-discount':
			if (action.discountAmount === undefined) {
				throw new Error('discountAmount is required for apply-discount action');
			}
			return applyDiscount(page, action.appointmentId, action.discountAmount, action.note);
		case 'discount-and-mark-paid':
			if (action.discountAmount === undefined) {
				throw new Error('discountAmount is required for discount-and-mark-paid action');
			}
			return discountAndMarkPaid(page, action.appointmentId, action.discountAmount, action.note);
		default:
			throw new Error(`Unknown action: ${(action as CheckoutAction).action}`);
	}
};
