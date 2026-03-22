/**
 * Report Generation
 *
 * Generates unpaid appointment reports in CSV and JSON formats.
 * Pure functions — no browser interaction needed.
 */

import type { AppointmentRecord, AppointmentFilter, UnpaidReport } from './types.js';

/**
 * Generate an UnpaidReport from a list of appointments and filter criteria.
 */
export const generateUnpaidReport = (
  appointments: AppointmentRecord[],
  filter: AppointmentFilter,
): UnpaidReport => {
  const unpaid = appointments.filter((a) => !a.paid);

  const totalAmount = unpaid.reduce((sum, a) => sum + a.price, 0);

  return {
    generatedAt: new Date(),
    dateRange: {
      start: filter.startDate,
      end: filter.endDate,
    },
    totalUnpaid: unpaid.length,
    totalAmount,
    appointments: unpaid,
  };
};

/**
 * Escape a value for CSV output.
 * Wraps in quotes if the value contains commas, quotes, or newlines.
 */
const escapeCSV = (value: string): string => {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

/**
 * Format a Date as ISO date string (YYYY-MM-DD).
 */
const formatDateISO = (date: Date): string => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * Convert an UnpaidReport to CSV string.
 *
 * Columns: ID, Date, Client, Service, Duration (min), Price, Payment Method, Notes
 * Header row included. Footer row with totals.
 */
export const toCSV = (report: UnpaidReport): string => {
  const headers = ['ID', 'Date', 'Client', 'Service', 'Duration (min)', 'Price', 'Payment Method', 'Notes'];
  const lines: string[] = [];

  // Header comment
  lines.push(`# Unpaid Appointments Report`);
  lines.push(`# Generated: ${report.generatedAt.toISOString()}`);
  lines.push(`# Date Range: ${formatDateISO(report.dateRange.start)} to ${formatDateISO(report.dateRange.end)}`);
  lines.push(`# Total Unpaid: ${report.totalUnpaid}`);
  lines.push(`# Total Amount: $${report.totalAmount.toFixed(2)}`);
  lines.push('');

  // Header row
  lines.push(headers.join(','));

  // Data rows
  for (const apt of report.appointments) {
    const row = [
      escapeCSV(apt.id),
      formatDateISO(apt.date),
      escapeCSV(apt.clientName),
      escapeCSV(apt.service),
      String(apt.duration),
      `$${apt.price.toFixed(2)}`,
      escapeCSV(apt.paymentMethod || ''),
      escapeCSV(apt.notes || ''),
    ];
    lines.push(row.join(','));
  }

  // Footer
  lines.push('');
  lines.push(`,,,,Total,$${report.totalAmount.toFixed(2)},,`);

  return lines.join('\n');
};

/**
 * Convert an UnpaidReport to a formatted JSON string.
 * Dates are serialized as ISO strings.
 */
export const toJSON = (report: UnpaidReport): string => {
  const serializable = {
    generatedAt: report.generatedAt.toISOString(),
    dateRange: {
      start: formatDateISO(report.dateRange.start),
      end: formatDateISO(report.dateRange.end),
    },
    totalUnpaid: report.totalUnpaid,
    totalAmount: report.totalAmount,
    appointments: report.appointments.map((a) => ({
      ...a,
      date: formatDateISO(a.date),
    })),
  };

  return JSON.stringify(serializable, null, 2);
};
