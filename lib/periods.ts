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

