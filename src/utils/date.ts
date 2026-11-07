import { stripAccents } from "./text";

export function todayStr(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  return `${map.year}-${map.month}-${map.day}`;
}

export function addDaysStr(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Difference in whole days: (toDateStr - fromDateStr). */
export function diffDaysStr(fromDateStr: string, toDateStr: string): number {
  const [fy, fm, fd] = fromDateStr.split("-").map(Number);
  const [ty, tm, td] = toDateStr.split("-").map(Number);
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

export function monthRefOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function dueDateForMonth(monthRef: string, day: number): string {
  const [year, month] = monthRef.split("-").map(Number);
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfMonth);
  return `${monthRef}-${String(clampedDay).padStart(2, "0")}`;
}

export function nextMonthRef(monthRef: string): string {
  const [year, month] = monthRef.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  date.setUTCMonth(date.getUTCMonth() + 1);
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${nextYear}-${nextMonth}`;
}

export function prevMonthRef(monthRef: string): string {
  const [year, month] = monthRef.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  date.setUTCMonth(date.getUTCMonth() - 1);
  const prevYear = date.getUTCFullYear();
  const prevMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${prevYear}-${prevMonth}`;
}

const MONTH_NAME_MAP: Record<string, string> = {
  jan: "01",
  janeiro: "01",
  fev: "02",
  fevereiro: "02",
  mar: "03",
  marco: "03",
  abr: "04",
  abril: "04",
  mai: "05",
  maio: "05",
  jun: "06",
  junho: "06",
  jul: "07",
  julho: "07",
  ago: "08",
  agosto: "08",
  set: "09",
  setembro: "09",
  out: "10",
  outubro: "10",
  nov: "11",
  novembro: "11",
  dez: "12",
  dezembro: "12",
};

/**
 * Parses flexible month input: "2026-12", "12/2026", "12", "dezembro", "dez 2026", "proximo".
 */
export function parseMonthRefInput(raw: string, today: string): string | null {
  const t = stripAccents(raw).toLowerCase().trim();
  if (!t) return null;

  const currentMonth = monthRefOf(today);
  const currentYear = today.slice(0, 4);

  if (t === "atual" || t === "hoje" || t === "este mes") return currentMonth;
  if (t === "proximo" || t === "mes que vem" || t === "seguinte") return nextMonthRef(currentMonth);
  if (t === "anterior" || t === "mes passado" || t === "passado") return prevMonthRef(currentMonth);

  const isoMatch = t.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;

  const slashMatch = t.match(/^(0?[1-9]|1[0-2])\/(\d{2,4})$/);
  if (slashMatch) {
    let year = Number(slashMatch[2]);
    if (year < 100) year += 2000;
    const month = String(Number(slashMatch[1])).padStart(2, "0");
    return `${year}-${month}`;
  }

  const numMatch = t.match(/^(0?[1-9]|1[0-2])$/);
  if (numMatch) {
    const month = String(Number(numMatch[1])).padStart(2, "0");
    return `${currentYear}-${month}`;
  }

  for (const [name, monthNum] of Object.entries(MONTH_NAME_MAP)) {
    const re = new RegExp(`^${name}(?:[\\s/\\-]+(\\d{2,4}))?$`);
    const m = t.match(re);
    if (m) {
      let year = m[1] ? Number(m[1]) : Number(currentYear);
      if (year < 100) year += 2000;
      return `${year}-${monthNum}`;
    }
  }

  return null;
}
