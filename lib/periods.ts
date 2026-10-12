export function currentMonthValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function nextMonthValue(monthValue: string) {
  const [year, month] = monthValue.split("-").map(Number);
  if (!year || !month) return monthValue;
  const d = new Date(year, month, 1); // month is already 1-indexed input -> +1 month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function formatMonthLabel(value: string) {
  if (!value) return "";
  if (/^[A-Za-z]+ \d{4}$/.test(value)) return value;
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Date(year, month - 1, 1).toLocaleString("default", {
    month: "long",
    year: "numeric"
  });
}

export function monthValueFromLabel(label: string) {
  if (!label) return "";
  if (/^\d{4}-\d{2}$/.test(label)) return label;
  const date = new Date(`${label} 1`);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function quarterLabel(year: number, quarter: number) {
  return `Q${quarter} ${year}`;
}


// ── Business months ─────────────────────────────────────────────────────────
// Ops Dashboard buckets each Mon–Sun week into the month its Monday falls in, so a business
// month ends on the Sunday after its last Monday (September 2026 runs through Sun, Oct 4).
// Ops Dashboard loads each finished week's hours/production Monday at 12:00 UTC, so a business
// month's numbers are complete from BUSINESS_MONTH_READY_HOUR_UTC on the following Monday.
export const BUSINESS_MONTH_READY_HOUR_UTC = 13;

function utcDate(year: number, monthIndex: number, day: number, hour = 0) {
  return new Date(Date.UTC(year, monthIndex, day, hour));
}

// The moment a business month ("YYYY-MM") is complete: the Monday after its last week.
export function businessMonthReadyAt(month: string): Date {
  const [year, m] = month.split("-").map(Number);
  const lastDay = utcDate(year, m, 0); // last calendar day of the month
  const daysSinceMonday = (lastDay.getUTCDay() + 6) % 7;
  const lastMonday = lastDay.getUTCDate() - daysSinceMonday;
  return utcDate(year, m - 1, lastMonday + 7, BUSINESS_MONTH_READY_HOUR_UTC);
}

export function isBusinessMonthComplete(month: string, now = new Date()): boolean {
  return now.getTime() >= businessMonthReadyAt(month).getTime();
}

// Most recent business month whose last week has finished and been loaded.
export function lastCompletedBusinessMonth(now = new Date()): string {
  let month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  while (!isBusinessMonthComplete(month, now)) {
    const [y, m] = month.split("-").map(Number);
    const prev = utcDate(y, m - 2, 1);
    month = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return month;
}

// The business month the current week belongs to (the month of this week's Monday) — matches
// pf-dashboard's "current" month for its est-current/est-next projections.
export function currentBusinessMonth(now = new Date()): string {
  const monday = utcDate(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
  return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}`;
}
