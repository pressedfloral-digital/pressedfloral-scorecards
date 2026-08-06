import type { Employee, PayType, Scorecard } from "./types";

export function escapeCsvCell(value: unknown) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(rows: unknown[][]) {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function getColumn(row: Record<string, string>, names: string[]) {
  for (const name of names) {
    const value = row[normalizeHeader(name)];
    if (value !== undefined) return value;
  }
  return "";
}

export function normalizeLocation(raw: string) {
  const value = raw.toLowerCase();
  if (value.includes("ut")) return "Utah";
  if (value.includes("ga") || value.includes("georgia")) return "Georgia";
  if (value.includes("remote")) return "Remote";
  return raw.trim() || "Remote";
}

export function parseRipplingEmployees(text: string): Employee[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((values, index) => {
    const row = Object.fromEntries(headers.map((header, idx) => [header, values[idx] || ""]));
    const annualPay = Number(getColumn(row, ["Annual Base Pay", "Annual Pay", "Salary", "annual_base_pay"]).replace(/[$,]/g, "")) || undefined;
    const hourlyRate = Number(getColumn(row, ["Hourly Rate", "Base Hourly Rate", "hourly_rate"]).replace(/[$,]/g, "")) || undefined;
    const grossEarnings = Number(getColumn(row, ["Gross Earnings", "Gross Pay", "Base Pay"]).replace(/[$,]/g, "")) || undefined;
    const hoursWorked = Number(getColumn(row, ["Base pay hours", "Hours Worked", "Total hours worked", "Hours"]).replace(/[$,]/g, "")) || undefined;
    const payType: PayType = annualPay ? "salary" : "hourly";
    return {
      id: `csv-employee-${index}`,
      name: getColumn(row, ["Full Name", "Full name", "Name", "Employee Name"]),
      role: getColumn(row, ["Title", "Job Title", "Role"]),
      department: getColumn(row, ["Department name", "Department", "Team"]),
      location: normalizeLocation(getColumn(row, ["Work location name", "Work Location", "Location"])),
      manager: getColumn(row, ["Manager", "Supervisor"]),
      payType,
      annualPay,
      hourlyRate,
      grossEarnings,
      hoursWorked,
      isManager: getColumn(row, ["Is a manager", "Is Manager?", "Is Manager"]).toLowerCase() === "true",
      employmentType: getColumn(row, ["Employment type name", "Employment Type"])
    };
  }).filter((employee) => employee.name);
}

export function scorecardsToCsv(scorecards: Scorecard[]) {
  const rows: unknown[][] = [
    ["Employee", "Role", "Department", "Location", "Manager", "Pay Type", "Base Earnings", "Bonus Amount", "Weighted Achievement", "Period"]
  ];
  for (const scorecard of scorecards) {
    rows.push([
      scorecard.employeeName,
      scorecard.role,
      scorecard.department,
      scorecard.location,
      scorecard.manager || "",
      scorecard.payType,
      scorecard.baseEarnings,
      scorecard.bonusAmount,
      scorecard.weightedAchievement,
      scorecard.scorecardMonth
    ]);
  }
  return toCsv(rows);
}

export function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
