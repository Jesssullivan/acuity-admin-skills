#!/usr/bin/env tsx

/**
 * Checkout Execution Report Generator
 *
 * Parses the output log from run-checkout.ts and generates a structured
 * execution summary with statistics, per-week breakdowns, per-client
 * breakdowns, discount summaries, and timeline information.
 *
 * Usage:
 *   tsx scripts/generate-report.ts < logfile.txt
 *   tsx scripts/generate-report.ts /path/to/logfile.txt
 *   tsx scripts/generate-report.ts /path/to/logfile.txt --format json
 */

import { createReadStream } from "node:fs";
import { createInterface, Interface } from "node:readline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppointmentAction {
  id: string;
  client: string;
  week: string;
  action: "skipped" | "marked_paid" | "discount_and_paid" | "failed";
  discountAmount?: number;
  originalPrice?: number;
  newPrice?: number;
}

interface WeekScan {
  week: string;
  totalScanned: number;
}

interface WeekActions {
  week: string;
  count: number;
  skipped: number;
  markedPaid: number;
  discounted: number;
  failed: number;
}

interface ClientSummary {
  name: string;
  appointmentCount: number;
  skipped: number;
  markedPaid: number;
  discounted: number;
  failed: number;
  totalDiscountSavings: number;
}

interface DiscountEntry {
  client: string;
  appointmentId: string;
  week: string;
  originalPrice: number;
  newPrice: number;
  savings: number;
}

interface Report {
  summary: {
    totalWeeksScanned: number;
    totalAppointmentsScanned: number;
    unpaidFound: number;
    unpaidProcessed: number;
    alreadyPaid: number;
    newlyMarkedPaid: number;
    discounted: number;
    failed: number;
    successTotal: number;
    failedTotal: number;
  };
  timeline: {
    mode: string;
    dateRange: string;
    scanPhaseWeeks: number;
    processPhaseWeeks: number;
  };
  weekScans: WeekScan[];
  weekActions: WeekActions[];
  clients: ClientSummary[];
  discounts: {
    clientName: string;
    discountAmount: number;
    entries: DiscountEntry[];
    totalSavings: number;
  }[];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const parseLog = async (input: Interface): Promise<Report> => {
  const lines: string[] = [];

  for await (const line of input) {
    lines.push(line);
  }

  // Phase 1: Scan metadata
  const weekScans: WeekScan[] = [];
  const actions: AppointmentAction[] = [];
  let mode = "unknown";
  let dateRange = "";
  let totalScanned = 0;
  let unpaidFound = 0;
  let discountClient = "";
  let discountAmount = 0;
  let currentWeek = "";
  let currentProcessWeek = "";
  let processWeeks = 0;

  // Track appointment state across multi-line sequences
  let pendingId = "";
  let pendingClient = "";
  let pendingAction: "mark_paid" | "discount_and_paid" = "mark_paid";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Mode
    const modeMatch = line.match(/\[acuity-admin\] Mode: (.+)/);
    if (modeMatch) {
      mode = modeMatch[1].trim();
      continue;
    }

    // Date range
    const dateRangeMatch = line.match(/\[acuity-admin\] Date range: (.+)/);
    if (dateRangeMatch) {
      dateRange = dateRangeMatch[1].trim();
      continue;
    }

    // Week scan lines: [appointments] Week of YYYY-MM-DD: N appointments
    const weekScanMatch = line.match(
      /\[appointments\] Week of (\d{4}-\d{2}-\d{2}): (\d+) appointments/
    );
    if (weekScanMatch) {
      weekScans.push({
        week: weekScanMatch[1],
        totalScanned: parseInt(weekScanMatch[2], 10),
      });
      continue;
    }

    // Total scanned summary
    const scannedMatch = line.match(
      /\[appointments\] Scanned (\d+) weeks, found (\d+) total/
    );
    if (scannedMatch) {
      totalScanned = parseInt(scannedMatch[2], 10);
      continue;
    }

    // Unpaid found
    const unpaidMatch = line.match(
      /\[acuity-admin\] Found (\d+) unpaid appointments/
    );
    if (unpaidMatch) {
      unpaidFound = parseInt(unpaidMatch[1], 10);
      continue;
    }

    // Discount announcement
    const discountAnnounce = line.match(
      /\[acuity-admin\] (\d+) appointments for "(.+)" will get \$(\d+) discount/
    );
    if (discountAnnounce) {
      discountClient = discountAnnounce[2];
      discountAmount = parseInt(discountAnnounce[3], 10);
      continue;
    }

    // Processing week navigation
    const navMatch = line.match(
      /\[acuity-admin\] Navigating to week of (\d{4}-\d{2}-\d{2}) \((\d+) appointments?\)\.\.\./
    );
    if (navMatch) {
      currentProcessWeek = navMatch[1];
      processWeeks++;
      continue;
    }

    // Appointment action initiation (mark paid)
    const markPaidMatch = line.match(
      /\[acuity-admin\]\s+(\d+) \((.+?)\) mark paid\.\.\./
    );
    if (markPaidMatch) {
      pendingId = markPaidMatch[1];
      pendingClient = markPaidMatch[2];
      pendingAction = "mark_paid";
      continue;
    }

    // Appointment action initiation (discount + mark paid)
    const discountMatch = line.match(
      /\[acuity-admin\]\s+(\d+) \((.+?)\) discount \+ mark paid\.\.\./
    );
    if (discountMatch) {
      pendingId = discountMatch[1];
      pendingClient = discountMatch[2];
      pendingAction = "discount_and_paid";
      continue;
    }

    // Already paid (skip)
    const alreadyPaidMatch = line.match(
      /\[actions\] Appointment (\d+) is already marked as paid, skipping/
    );
    if (alreadyPaidMatch && pendingId === alreadyPaidMatch[1]) {
      actions.push({
        id: pendingId,
        client: pendingClient,
        week: currentProcessWeek,
        action: "skipped",
      });
      pendingId = "";
      continue;
    }

    // Discount applied + marked paid
    const discountAppliedMatch = line.match(
      /\[actions\] Applying \$(\d+) discount: \$(\d+) -> \$(\d+), then marking paid/
    );
    if (discountAppliedMatch && pendingId) {
      // The next line will confirm; store price info now
      const origPrice = parseInt(discountAppliedMatch[2], 10);
      const newPrice = parseInt(discountAppliedMatch[3], 10);
      // Check for confirmation on the next line
      const nextLine = i + 1 < lines.length ? lines[i + 1] : "";
      if (nextLine.includes("discount applied + marked paid")) {
        actions.push({
          id: pendingId,
          client: pendingClient,
          week: currentProcessWeek,
          action: "discount_and_paid",
          discountAmount: parseInt(discountAppliedMatch[1], 10),
          originalPrice: origPrice,
          newPrice: newPrice,
        });
        i++; // Skip the confirmation line
        pendingId = "";
        continue;
      }
    }

    // Marked paid (non-discount, successful)
    const markedPaidMatch = line.match(
      /\[actions\] Appointment (\d+): marked paid/
    );
    if (markedPaidMatch && pendingId === markedPaidMatch[1]) {
      actions.push({
        id: pendingId,
        client: pendingClient,
        week: currentProcessWeek,
        action: "marked_paid",
      });
      pendingId = "";
      continue;
    }

    // Failed actions
    const failedMatch = line.match(
      /\[actions\].*(?:FAILED|failed|error).*(\d{10,})/i
    );
    if (failedMatch && pendingId) {
      actions.push({
        id: pendingId,
        client: pendingClient,
        week: currentProcessWeek,
        action: "failed",
      });
      pendingId = "";
      continue;
    }
  }

  // ---------------------------------------------------------------------------
  // Aggregate
  // ---------------------------------------------------------------------------

  const skipped = actions.filter((a) => a.action === "skipped").length;
  const markedPaid = actions.filter((a) => a.action === "marked_paid").length;
  const discounted = actions.filter(
    (a) => a.action === "discount_and_paid"
  ).length;
  const failed = actions.filter((a) => a.action === "failed").length;

  // Per-week actions
  const weekMap = new Map<string, WeekActions>();
  for (const action of actions) {
    if (!weekMap.has(action.week)) {
      weekMap.set(action.week, {
        week: action.week,
        count: 0,
        skipped: 0,
        markedPaid: 0,
        discounted: 0,
        failed: 0,
      });
    }
    const w = weekMap.get(action.week)!;
    w.count++;
    if (action.action === "skipped") w.skipped++;
    else if (action.action === "marked_paid") w.markedPaid++;
    else if (action.action === "discount_and_paid") w.discounted++;
    else if (action.action === "failed") w.failed++;
  }
  const weekActions = [...weekMap.values()].sort((a, b) =>
    a.week.localeCompare(b.week)
  );

  // Per-client
  const clientMap = new Map<string, ClientSummary>();
  for (const action of actions) {
    if (!clientMap.has(action.client)) {
      clientMap.set(action.client, {
        name: action.client,
        appointmentCount: 0,
        skipped: 0,
        markedPaid: 0,
        discounted: 0,
        failed: 0,
        totalDiscountSavings: 0,
      });
    }
    const c = clientMap.get(action.client)!;
    c.appointmentCount++;
    if (action.action === "skipped") c.skipped++;
    else if (action.action === "marked_paid") c.markedPaid++;
    else if (action.action === "discount_and_paid") {
      c.discounted++;
      c.totalDiscountSavings += action.discountAmount ?? 0;
    } else if (action.action === "failed") c.failed++;
  }
  const clients = [...clientMap.values()].sort(
    (a, b) => b.appointmentCount - a.appointmentCount
  );

  // Discounts
  const discountActions = actions.filter(
    (a) => a.action === "discount_and_paid"
  );
  const discountsByClient = new Map<string, DiscountEntry[]>();
  for (const a of discountActions) {
    if (!discountsByClient.has(a.client)) {
      discountsByClient.set(a.client, []);
    }
    discountsByClient.get(a.client)!.push({
      client: a.client,
      appointmentId: a.id,
      week: a.week,
      originalPrice: a.originalPrice ?? 0,
      newPrice: a.newPrice ?? 0,
      savings: a.discountAmount ?? 0,
    });
  }
  const discounts = [...discountsByClient.entries()].map(
    ([clientName, entries]) => ({
      clientName,
      discountAmount,
      entries,
      totalSavings: entries.reduce((sum, e) => sum + e.savings, 0),
    })
  );

  return {
    summary: {
      totalWeeksScanned: weekScans.length,
      totalAppointmentsScanned: totalScanned,
      unpaidFound,
      unpaidProcessed: actions.length,
      alreadyPaid: skipped,
      newlyMarkedPaid: markedPaid + discounted,
      discounted,
      failed,
      successTotal: skipped + markedPaid + discounted,
      failedTotal: failed,
    },
    timeline: {
      mode,
      dateRange,
      scanPhaseWeeks: weekScans.length,
      processPhaseWeeks: processWeeks,
    },
    weekScans,
    weekActions,
    clients,
    discounts,
  };
};

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const pad = (str: string, len: number): string =>
  str.length >= len ? str : str + " ".repeat(len - str.length);

const padLeft = (str: string, len: number): string =>
  str.length >= len ? str : " ".repeat(len - str.length) + str;

const formatText = (report: Report): string => {
  const lines: string[] = [];
  const hr = "=".repeat(72);
  const hr2 = "-".repeat(72);

  lines.push(hr);
  lines.push("  ACUITY CHECKOUT EXECUTION REPORT");
  lines.push(hr);
  lines.push("");

  // Timeline
  lines.push("TIMELINE");
  lines.push(hr2);
  lines.push(`  Mode:             ${report.timeline.mode}`);
  lines.push(`  Date range:       ${report.timeline.dateRange}`);
  lines.push(`  Weeks scanned:    ${report.timeline.scanPhaseWeeks}`);
  lines.push(`  Weeks processed:  ${report.timeline.processPhaseWeeks}`);
  lines.push("");

  // Summary
  lines.push("SUMMARY");
  lines.push(hr2);
  lines.push(
    `  Total appointments scanned:  ${report.summary.totalAppointmentsScanned}`
  );
  lines.push(
    `  Unpaid appointments found:   ${report.summary.unpaidFound}`
  );
  lines.push(
    `  Appointments processed:      ${report.summary.unpaidProcessed}`
  );
  lines.push(
    `  Already paid (skipped):      ${report.summary.alreadyPaid}`
  );
  lines.push(
    `  Newly marked paid:           ${report.summary.newlyMarkedPaid}`
  );
  lines.push(
    `    - With discount:           ${report.summary.discounted}`
  );
  lines.push(
    `    - Standard:                ${report.summary.newlyMarkedPaid - report.summary.discounted}`
  );
  lines.push(
    `  Failed:                      ${report.summary.failed}`
  );
  lines.push("");

  // Per-week breakdown
  lines.push("PER-WEEK BREAKDOWN");
  lines.push(hr2);
  lines.push(
    `  ${pad("Week", 14)} ${padLeft("Total", 6)} ${padLeft("Skip", 6)} ${padLeft("Paid", 6)} ${padLeft("Disc", 6)} ${padLeft("Fail", 6)}`
  );
  lines.push("  " + "-".repeat(46));
  for (const w of report.weekActions) {
    lines.push(
      `  ${pad(w.week, 14)} ${padLeft(String(w.count), 6)} ${padLeft(String(w.skipped), 6)} ${padLeft(String(w.markedPaid), 6)} ${padLeft(String(w.discounted), 6)} ${padLeft(String(w.failed), 6)}`
    );
  }
  lines.push("");

  // Per-client breakdown
  lines.push("PER-CLIENT BREAKDOWN");
  lines.push(hr2);
  lines.push(
    `  Unique clients: ${report.clients.length}`
  );
  lines.push("");
  lines.push(
    `  ${pad("Client", 30)} ${padLeft("Appts", 6)} ${padLeft("Skip", 6)} ${padLeft("Paid", 6)} ${padLeft("Disc", 6)} ${padLeft("Fail", 6)}`
  );
  lines.push("  " + "-".repeat(62));
  for (const c of report.clients) {
    const actionMarker =
      c.markedPaid > 0 || c.discounted > 0 || c.failed > 0 ? " *" : "";
    lines.push(
      `  ${pad(c.name + actionMarker, 30)} ${padLeft(String(c.appointmentCount), 6)} ${padLeft(String(c.skipped), 6)} ${padLeft(String(c.markedPaid), 6)} ${padLeft(String(c.discounted), 6)} ${padLeft(String(c.failed), 6)}`
    );
  }
  lines.push("");
  lines.push("  * = action taken (not just skipped)");
  lines.push("");

  // Discount summary
  if (report.discounts.length > 0) {
    lines.push("DISCOUNT SUMMARY");
    lines.push(hr2);
    const totalSavings = report.discounts.reduce(
      (s, d) => s + d.totalSavings,
      0
    );
    lines.push(`  Total discount savings: $${totalSavings}`);
    lines.push("");
    for (const d of report.discounts) {
      lines.push(`  Client: ${d.clientName} ($${d.discountAmount}/appointment)`);
      lines.push(
        `  ${pad("Appointment ID", 16)} ${pad("Week", 14)} ${padLeft("Original", 10)} ${padLeft("Discounted", 12)} ${padLeft("Saved", 8)}`
      );
      lines.push("  " + "-".repeat(62));
      for (const e of d.entries) {
        lines.push(
          `  ${pad(e.appointmentId, 16)} ${pad(e.week, 14)} ${padLeft("$" + e.originalPrice, 10)} ${padLeft("$" + e.newPrice, 12)} ${padLeft("$" + e.savings, 8)}`
        );
      }
      lines.push(
        `  ${pad("", 16)} ${pad("", 14)} ${padLeft("", 10)} ${padLeft("TOTAL", 12)} ${padLeft("$" + d.totalSavings, 8)}`
      );
      lines.push("");
    }
  }

  // Scan phase detail (compact)
  lines.push("SCAN PHASE (appointments per week)");
  lines.push(hr2);
  const nonZeroWeeks = report.weekScans.filter((w) => w.totalScanned > 0);
  const zeroWeeks = report.weekScans.filter((w) => w.totalScanned === 0);
  for (const w of nonZeroWeeks) {
    lines.push(`  ${w.week}:  ${padLeft(String(w.totalScanned), 3)} appointments`);
  }
  if (zeroWeeks.length > 0) {
    lines.push(
      `  (${zeroWeeks.length} weeks with 0 appointments: ${zeroWeeks.map((w) => w.week).join(", ")})`
    );
  }
  lines.push("");

  lines.push(hr);
  lines.push("  End of report");
  lines.push(hr);

  return lines.join("\n");
};

const formatJson = (report: Report): string =>
  JSON.stringify(report, null, 2);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  let format: "text" | "json" = "text";
  let filePath: string | undefined;

  for (const arg of args) {
    if (arg === "--format" || arg === "-f") {
      // Next arg is the format value; handled below
      continue;
    }
    if (arg === "json") {
      // Check if previous arg was --format
      const prevIdx = args.indexOf(arg) - 1;
      if (prevIdx >= 0 && (args[prevIdx] === "--format" || args[prevIdx] === "-f")) {
        format = "json";
        continue;
      }
    }
    if (arg === "--json") {
      format = "json";
      continue;
    }
    if (arg === "--text") {
      format = "text";
      continue;
    }
    if (!arg.startsWith("-")) {
      filePath = arg;
    }
  }

  // Handle --format json as two separate args
  const formatIdx = args.indexOf("--format") !== -1 ? args.indexOf("--format") : args.indexOf("-f");
  if (formatIdx !== -1 && formatIdx + 1 < args.length) {
    const val = args[formatIdx + 1];
    if (val === "json") format = "json";
    else if (val === "text") format = "text";
  }

  const inputStream = filePath
    ? createReadStream(filePath, { encoding: "utf-8" })
    : process.stdin;

  const rl = createInterface({
    input: inputStream,
    crlfDelay: Infinity,
  });

  const report = await parseLog(rl);

  if (format === "json") {
    process.stdout.write(formatJson(report) + "\n");
  } else {
    process.stdout.write(formatText(report) + "\n");
  }
};

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
