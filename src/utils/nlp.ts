import { parseUrgentLabel, stripAccents } from "./text";
import { addDaysStr, dueDateForMonth, monthRefOf, nextMonthRef } from "./date";

export interface ParsedBillMention {
  label: string;
  urgent: boolean;
  amount: number | null;
  /** ISO date YYYY-MM-DD, or null when no date/day was mentioned. */
  dueDate: string | null;
  /** Day of month (1-31) if inferred from date or "dia N". */
  dueDay: number | null;
  /** True when user wrote "todo dia N" or "fixa". */
  recurring: boolean;
}

export interface ParsedPaymentMention {
  query: string;
  amount: number | null;
}

/** Builds a validated ISO date, or null when the day/month combo does not exist. */
export function buildIsoOrNull(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parses loose money input: "1200", "1.200,50", "R$ 1200", "1200,50", "1200.50", "1.200.000".
 * Returns null when it does not look like a plausible value.
 */
export function parseAmountInput(raw: string): number | null {
  let s = raw
    .trim()
    .toLowerCase()
    .replace(/^r\$\s*/, "")
    .replace(/\s+/g, "");
  if (!s) return null;

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma) {
    // pt-BR style: dot is thousands, comma is decimal.
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    const dotCount = (s.match(/\./g) ?? []).length;
    if (dotCount > 1) {
      s = s.replace(/\./g, ""); // 1.200.000
    } else if (/^\d{1,3}\.\d{3}$/.test(s)) {
      s = s.replace(".", ""); // 1.200 → 1200 (thousands)
    }
  }

  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const value = Number(s);
  if (!Number.isFinite(value) || value <= 0 || value > 9_999_999) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Accepts "hoje", "amanha", "depois de amanha", "dia N", "dd/mm", "dd/mm/yyyy", "dd/mm/yy" and "YYYY-MM-DD".
 * Returns ISO YYYY-MM-DD or null. Bare dd/mm rolls to next year when already past.
 */
export function parseFlexibleDate(raw: string, today: string): string | null {
  const t = stripAccents(raw).toLowerCase().trim();

  if (t === "hoje") return today;
  if (t === "amanha" || t === "de amanha") return addDaysStr(today, 1);
  if (t === "depois de amanha") return addDaysStr(today, 2);

  const dayOnlyMatch = t.match(/^(?:dia\s+)?(\d{1,2})$/);
  if (dayOnlyMatch) {
    const day = Number(dayOnlyMatch[1]);
    if (day >= 1 && day <= 31) {
      return dueDateFromDay(day, today);
    }
  }

  let match = t.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(today.slice(0, 4));
    const iso = buildIsoOrNull(year, month, day);
    if (!iso) return null;
    return iso < today ? buildIsoOrNull(year + 1, month, day) : iso;
  }

  match = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    return buildIsoOrNull(year, Number(match[2]), Number(match[1]));
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const [year, month, day] = t.split("-").map(Number);
    return buildIsoOrNull(year, month, day);
  }

  return null;
}

export function dueDateFromDay(day: number, today: string): string {
  const monthRef = monthRefOf(today);
  const thisMonth = dueDateForMonth(monthRef, day);
  const todayDay = Number(today.slice(8, 10));
  if (Number(thisMonth.slice(8, 10)) >= todayDay) return thisMonth;
  return dueDateForMonth(nextMonthRef(monthRef), day);
}

/**
 * Detects natural-language payment notifications like:
 * "paguei luz", "paguei a luz 185,90", "pago aluguel", "quitei internet 120"
 */
export function parsePaymentMention(rawText: string): ParsedPaymentMention | null {
  const trimmed = rawText.trim();
  const prefixMatch = stripAccents(trimmed).match(
    /^(?:paguei|pago|quitei|quitar)\s+(?:(?:a|o)\s+)?(?:conta\s+(?:d[eao]\s+)?)?(.+)$/i
  );
  if (!prefixMatch) return null;

  // Keep original accents/casing for the rest by slicing after prefix length
  const fullPrefixRe =
    /^(?:paguei|pago|quitei|quitar)\s+(?:(?:a|o)\s+)?(?:conta\s+(?:d[eao]\s+)?)?/i;
  const rest = trimmed.replace(fullPrefixRe, "").trim();
  if (!rest) return null;

  const tokens = rest.split(/\s+/).filter(Boolean);
  let amount: number | null = null;
  let valueIdx = -1;

  if (tokens.length >= 2) {
    const lastIdx = tokens.length - 1;
    const cleaned = tokens[lastIdx]
      .replace(/[.,!?;:]+$/, "")
      .replace(/^(?:r\$|rs)[:\-]?/i, "");
    const candidate = parseAmountInput(cleaned);
    if (candidate !== null) {
      amount = candidate;
      valueIdx = lastIdx;
    }
  }

  let queryTokens = valueIdx !== -1 ? tokens.slice(0, valueIdx) : tokens;
  while (
    queryTokens.length > 0 &&
    /^(?:r\$|rs|\$|reais?|brl|por|de|no\s+valor\s+de)$/i.test(queryTokens[queryTokens.length - 1])
  ) {
    queryTokens = queryTokens.slice(0, -1);
  }

  const query = queryTokens.join(" ").trim();
  if (!query) return null;
  return { query, amount };
}

/**
 * Parses free text like:
 * - "aluguel 1200 dia 5"
 * - "aluguel 1200 todo dia 5" (recurring)
 * - "urgente: luz 89,90 10/11"
 * - "internet 120 amanha"
 * - "netflix R$ 55,90 fixa dia 15"
 * Only succeeds when BOTH a plausible value and a name (2+ chars) exist.
 */
export function parseBillMention(rawText: string, today: string): ParsedBillMention | null {
  let text = rawText.trim();
  if (!text) return null;
  let dueDate: string | null = null;
  let dueDay: number | null = null;
  let recurring = false;
  let extraUrgent = false;

  // Detect recurring markers: "todo dia N", "toda dia N", "fixa", "fixo", "mensal", "recorrente"
  const todoDiaMatch = text.match(/(?:^|\s)tod[oa]\s+dia\s+(\d{1,2})(?=\s|$|[,.;!?])/i);
  if (todoDiaMatch) {
    const day = Number(todoDiaMatch[1]);
    if (day >= 1 && day <= 31) {
      recurring = true;
      dueDay = day;
      dueDate = dueDateFromDay(day, today);
      text = text.replace(todoDiaMatch[0], " ");
    }
  }

  const recurringWordRe = /(?:^|\s)(?:conta\s+fixa|fixa|fixo|recorrente|mensal)(?:[:\s]|$)/i;
  if (recurringWordRe.test(stripAccents(text))) {
    recurring = true;
    text = text.replace(/(?:^|\s)(?:conta\s+fixa|fixa|fixo|recorrente|mensal)[:\s]*/i, " ");
  }

  // Detect standalone "urgente" anywhere in the text
  const urgentAnywhereRe = /(?:^|\s)urgente(?=[:\s]|$|[,.;!?])/i;
  if (urgentAnywhereRe.test(stripAccents(text))) {
    extraUrgent = true;
    text = text.replace(/(?:^|\s)urgente[:\s]*/i, " ");
  }

  // "dia N" (relative day of month) — only when it reads like an explicit "dia 5".
  if (!dueDate) {
    const dayMatch = text.match(/(?:^|\s)(?:vence\s+)?dia\s+(\d{1,2})(?=\s|$|[,.;!?])/i);
    if (dayMatch) {
      const day = Number(dayMatch[1]);
      if (day >= 1 && day <= 31) {
        dueDay = day;
        dueDate = dueDateFromDay(day, today);
        text = text.replace(dayMatch[0], " ");
      }
    }
  }

  // Relative words: "depois de amanha", "amanha", "hoje"
  if (!dueDate) {
    const relMatch = stripAccents(text).match(/(?:^|\s)(depois\s+de\s+amanha|amanha|hoje)(?=\s|$|[,.;!?])/i);
    if (relMatch) {
      const word = relMatch[1].toLowerCase().replace(/\s+/g, " ");
      if (word === "hoje") dueDate = today;
      else if (word === "amanha") dueDate = addDaysStr(today, 1);
      else if (word === "depois de amanha") dueDate = addDaysStr(today, 2);
      if (dueDate) {
        dueDay = Number(dueDate.slice(8, 10));
        text = text.replace(/(?:^|\s)(?:depois\s+de\s+amanh[aã]|amanh[aã]|hoje)(?=\s|$|[,.;!?])/i, " ");
      }
    }
  }

  // dd/mm[/yy[yy]]
  if (!dueDate) {
    const ddmmyyyy = text.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s|$|[,.;!?])/);
    if (ddmmyyyy) {
      const day = Number(ddmmyyyy[1]);
      const month = Number(ddmmyyyy[2]);
      let year = ddmmyyyy[3] ? Number(ddmmyyyy[3]) : Number(today.slice(0, 4));
      if (ddmmyyyy[3] && year < 100) year += 2000;
      const iso = buildIsoOrNull(year, month, day);
      if (iso) {
        dueDate = !ddmmyyyy[3] && iso < today ? buildIsoOrNull(year + 1, month, day) : iso;
        dueDay = day;
        text = text.replace(ddmmyyyy[0], " ");
      }
    }
  }

  // YYYY-MM-DD
  if (!dueDate) {
    const isoMatch = text.match(/(?:^|\s)(\d{4}-\d{2}-\d{2})(?=\s|$|[,.;!?])/);
    if (isoMatch) {
      const [year, month, day] = isoMatch[1].split("-").map(Number);
      const iso = buildIsoOrNull(year, month, day);
      if (iso) {
        dueDate = iso;
        dueDay = day;
        text = text.replace(isoMatch[0], " ");
      }
    }
  }

  // Value: scan tokens from the end, take the first that looks like money.
  const tokens = text.split(/\s+/).filter(Boolean);
  let valueIdx = -1;
  let amount: number | null = null;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const cleaned = tokens[i]
      .replace(/[.,!?;:]+$/, "")
      .replace(/^(?:r\$|rs)[:\-]?/i, "");
    const candidate = parseAmountInput(cleaned);
    if (candidate !== null) {
      valueIdx = i;
      amount = candidate;
      break;
    }
  }
  // Must have either a plausible value OR an explicit date/day
  if ((valueIdx === -1 || amount === null) && !dueDate) return null;

  // Allow words both before and after value (in case user wrote "aluguel dia 5 1200" or "1200 aluguel")
  let labelTokens = valueIdx !== -1 ? tokens.filter((_, idx) => idx !== valueIdx) : tokens;
  while (
    labelTokens.length > 0 &&
    /^(?:r\$|rs|\$|reais?|brl|vence|no|em|por|valor)$/i.test(labelTokens[labelTokens.length - 1])
  ) {
    labelTokens = labelTokens.slice(0, -1);
  }

  const { label, urgent } = parseUrgentLabel(labelTokens.join(" ").trim());
  if (stripAccents(label).replace(/\W/g, "").length < 2) return null;

  return {
    label,
    urgent: urgent || extraUrgent,
    amount,
    dueDate,
    dueDay,
    recurring,
  };
}
