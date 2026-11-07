import type { Bill } from "../../db/repository";
import { stripAccents } from "../../utils/text";

const MONTH_NAMES: Record<string, string> = {
  janeiro: "01",
  fevereiro: "02",
  marco: "03",
  abril: "04",
  maio: "05",
  junho: "06",
  julho: "07",
  agosto: "08",
  setembro: "09",
  outubro: "10",
  novembro: "11",
  dezembro: "12",
};

function tokenize(text: string): string[] {
  return stripAccents(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
}

export function extractMonthRef(caption: string): string | null {
  const normalized = stripAccents(caption).toLowerCase();

  const isoMatch = normalized.match(/(\d{4})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;

  const slashMatch = normalized.match(/(\d{2})\/(\d{4})/);
  if (slashMatch) return `${slashMatch[2]}-${slashMatch[1]}`;

  for (const [name, num] of Object.entries(MONTH_NAMES)) {
    if (normalized.includes(name)) {
      const yearMatch = normalized.match(/\b(20\d{2})\b/);
      if (yearMatch) return `${yearMatch[1]}-${num}`;
    }
  }

  return null;
}

export function findBestMatch(caption: string, candidates: Bill[]): Bill[] {
  const captionTokenList = tokenize(caption);
  const captionTokens = new Set(captionTokenList);
  const captionMonthRef = extractMonthRef(caption);

  const scored = candidates
    .filter((bill) => !captionMonthRef || bill.month_ref === captionMonthRef)
    .map((bill) => {
      const billTokens = tokenize(bill.label);
      let score = 0;
      for (const bt of billTokens) {
        if (captionTokens.has(bt)) {
          score += 3;
        } else if (
          bt.length >= 3 &&
          captionTokenList.some(
            (ct) => ct.length >= 3 && (bt.startsWith(ct) || ct.startsWith(bt))
          )
        ) {
          score += 1;
        }
      }
      return { bill, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [];

  const topScore = scored[0].score;
  return scored.filter((entry) => entry.score === topScore).map((entry) => entry.bill);
}
