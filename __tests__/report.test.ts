/**
 * Tests for report generation (CSV and JSON formatting).
 * Uses mock appointment data — no browser needed.
 */

import { describe, it, expect } from 'vitest';
import { generateUnpaidReport, toCSV, toJSON } from '../report.js';
import type { AppointmentRecord, AppointmentFilter } from '../types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const mockAppointments: AppointmentRecord[] = [
  {
    id: 'apt-001',
    date: new Date('2025-02-15T10:00:00Z'),
    clientName: 'Alice Johnson',
    service: 'TMD 60 min',
    duration: 60,
    price: 200,
    paid: false,
    notes: 'First visit',
  },
  {
    id: 'apt-002',
    date: new Date('2025-02-16T14:00:00Z'),
    clientName: 'Bob Smith',
    service: 'Neck/Cervical 30 min',
    duration: 30,
    price: 75,
    paid: true,
    paymentMethod: 'credit card',
  },
  {
    id: 'apt-003',
    date: new Date('2025-03-01T11:00:00Z'),
    clientName: 'Carol Williams',
    service: 'TMD 30 min',
    duration: 30,
    price: 100,
    paid: false,
  },
  {
    id: 'apt-004',
    date: new Date('2025-03-05T13:00:00Z'),
    clientName: 'Dave "The Rock" Lee',
    service: 'TMD 1st Visit/Consultation',
    duration: 60,
    price: 150,
    paid: false,
    notes: 'Referred by dentist, needs follow-up',
  },
];

const defaultFilter: AppointmentFilter = {
  startDate: new Date('2025-01-01'),
  endDate: new Date('2025-12-31'),
};

// ---------------------------------------------------------------------------
// generateUnpaidReport
// ---------------------------------------------------------------------------

describe('generateUnpaidReport', () => {
  it('should filter out paid appointments', () => {
    const report = generateUnpaidReport(mockAppointments, defaultFilter);

    expect(report.totalUnpaid).toBe(3);
    expect(report.appointments.every((a) => !a.paid)).toBe(true);
  });

  it('should calculate total amount from unpaid only', () => {
    const report = generateUnpaidReport(mockAppointments, defaultFilter);

    // 200 + 100 + 150 = 450 (Bob's $75 is paid, excluded)
    expect(report.totalAmount).toBe(450);
  });

  it('should set date range from filter', () => {
    const report = generateUnpaidReport(mockAppointments, defaultFilter);

    expect(report.dateRange.start).toEqual(defaultFilter.startDate);
    expect(report.dateRange.end).toEqual(defaultFilter.endDate);
  });

  it('should set generatedAt to current time', () => {
    const before = new Date();
    const report = generateUnpaidReport(mockAppointments, defaultFilter);
    const after = new Date();

    expect(report.generatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(report.generatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('should handle empty appointment list', () => {
    const report = generateUnpaidReport([], defaultFilter);

    expect(report.totalUnpaid).toBe(0);
    expect(report.totalAmount).toBe(0);
    expect(report.appointments).toEqual([]);
  });

  it('should handle all-paid appointments', () => {
    const allPaid = mockAppointments.map((a) => ({ ...a, paid: true }));
    const report = generateUnpaidReport(allPaid, defaultFilter);

    expect(report.totalUnpaid).toBe(0);
    expect(report.totalAmount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// toCSV
// ---------------------------------------------------------------------------

describe('toCSV', () => {
  it('should include header comment with report metadata', () => {
    const report = generateUnpaidReport(mockAppointments, defaultFilter);
    const csv = toCSV(report);

    expect(csv).toContain('# Unpaid Appointments Report');
    expect(csv).toContain('# Total Unpaid: 3');
    expect(csv).toContain('# Total Amount: $450.00');
    expect(csv).toContain('# Date Range: 2025-01-01 to 2025-12-31');
  });

  it('should include column headers', () => {
    const report = generateUnpaidReport(mockAppointments, defaultFilter);
    const csv = toCSV(report);

    expect(csv).toContain('ID,Date,Client,Service,Duration (min),Price,Payment Method,Notes');
  });

  it('should include appointment data rows', () => {
    const report = generateUnpaidReport(mockAppointments, defaultFilter);
    const csv = toCSV(report);

    expect(csv).toContain('apt-001,2025-02-15,Alice Johnson,TMD 60 min,60,$200.00,,First visit');
    expect(csv).toContain('apt-003,2025-03-01,Carol Williams,TMD 30 min,30,$100.00,,');
  });

  it('should escape values with commas and quotes', () => {
    const report = generateUnpaidReport(mockAppointments, defaultFilter);
    const csv = toCSV(report);

    // Dave's name has quotes, notes have a comma
    expect(csv).toContain('"Dave ""The Rock"" Lee"');
    expect(csv).toContain('"Referred by dentist, needs follow-up"');
  });

  it('should not include paid appointments', () => {
    const report = generateUnpaidReport(mockAppointments, defaultFilter);
    const csv = toCSV(report);

    expect(csv).not.toContain('Bob Smith');
    expect(csv).not.toContain('apt-002');
  });

  it('should include footer total', () => {
    const report = generateUnpaidReport(mockAppointments, defaultFilter);
    const csv = toCSV(report);

    expect(csv).toContain(',,,,Total,$450.00,,');
  });

  it('should produce valid output for empty report', () => {
    const report = generateUnpaidReport([], defaultFilter);
    const csv = toCSV(report);

    expect(csv).toContain('# Total Unpaid: 0');
    expect(csv).toContain('# Total Amount: $0.00');
    expect(csv).toContain('ID,Date,Client');
    expect(csv).toContain(',,,,Total,$0.00,,');
  });
});

// ---------------------------------------------------------------------------
// toJSON
// ---------------------------------------------------------------------------

describe('toJSON', () => {
  it('should produce valid JSON', () => {
    const report = generateUnpaidReport(mockAppointments, defaultFilter);
    const json = toJSON(report);

    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('should include report metadata', () => {
    const report = generateUnpaidReport(mockAppointments, defaultFilter);
    const parsed = JSON.parse(toJSON(report));

    expect(parsed.totalUnpaid).toBe(3);
    expect(parsed.totalAmount).toBe(450);
    expect(parsed.dateRange.start).toBe('2025-01-01');
    expect(parsed.dateRange.end).toBe('2025-12-31');
  });

  it('should serialize dates as ISO date strings', () => {
    const report = generateUnpaidReport(mockAppointments, defaultFilter);
    const parsed = JSON.parse(toJSON(report));

    expect(parsed.appointments[0].date).toBe('2025-02-15');
    expect(parsed.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should only include unpaid appointments', () => {
    const report = generateUnpaidReport(mockAppointments, defaultFilter);
    const parsed = JSON.parse(toJSON(report));

    expect(parsed.appointments).toHaveLength(3);
    expect(parsed.appointments.every((a: { paid: boolean }) => !a.paid)).toBe(true);
  });

  it('should preserve appointment fields', () => {
    const report = generateUnpaidReport(mockAppointments, defaultFilter);
    const parsed = JSON.parse(toJSON(report));

    const first = parsed.appointments[0];
    expect(first.id).toBe('apt-001');
    expect(first.clientName).toBe('Alice Johnson');
    expect(first.service).toBe('TMD 60 min');
    expect(first.duration).toBe(60);
    expect(first.price).toBe(200);
    expect(first.paid).toBe(false);
    expect(first.notes).toBe('First visit');
  });

  it('should handle empty report', () => {
    const report = generateUnpaidReport([], defaultFilter);
    const parsed = JSON.parse(toJSON(report));

    expect(parsed.totalUnpaid).toBe(0);
    expect(parsed.totalAmount).toBe(0);
    expect(parsed.appointments).toEqual([]);
  });
});
