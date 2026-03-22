/**
 * Type definitions for Acuity admin automation.
 */

export interface AcuityCredentials {
  email: string;
  password: string;
}

export interface AppointmentFilter {
  startDate: Date;
  endDate: Date;
  status?: 'all' | 'unpaid' | 'paid';
  clientName?: string;
}

export interface AppointmentRecord {
  id: string;
  date: Date;
  /** The week date (YYYY-MM-DD) this appointment was found on in the calendar */
  weekDate?: string;
  clientName: string;
  service: string;
  duration: number;
  price: number;
  paid: boolean;
  paymentMethod?: string;
  notes?: string;
}

export interface CheckoutAction {
  appointmentId: string;
  action: 'mark-paid-cash' | 'apply-discount' | 'discount-and-mark-paid';
  discountAmount?: number;
  note?: string;
}

export interface UnpaidReport {
  generatedAt: Date;
  dateRange: { start: Date; end: Date };
  totalUnpaid: number;
  totalAmount: number;
  appointments: AppointmentRecord[];
}

export interface BrowserOptions {
  /** Run in headless mode (default: true) */
  headless?: boolean;
  /** Path to Chrome/Chromium executable (env: CHROME_PATH) */
  executablePath?: string;
  /** Default navigation timeout in ms (default: 30000) */
  timeout?: number;
  /** Viewport width (default: 1280) */
  viewportWidth?: number;
  /** Viewport height (default: 800) */
  viewportHeight?: number;
  /** Directory for screenshots on failure */
  screenshotDir?: string;
}

/** Serialized cookie for export/import */
export interface SerializedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/** Cookie jar file format */
export interface CookieJar {
  exportedAt: string;
  domain: string;
  cookies: SerializedCookie[];
}
