const COMBINING_MARK_START = String.fromCharCode(0x0300);
const COMBINING_MARK_END = String.fromCharCode(0x036f);
const COMBINING_MARKS = new RegExp(`[${COMBINING_MARK_START}-${COMBINING_MARK_END}]`, "g");

export function stripAccents(text: string): string {
  return text.normalize("NFD").replace(COMBINING_MARKS, "");
}

export function slugify(label: string): string {
  const slug = stripAccents(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
  return slug || "comprovante";
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const URGENT_PREFIX_RE = /^urgente[:\s]+/i;

export function parseUrgentLabel(rawLabel: string): { label: string; urgent: boolean } {
  if (URGENT_PREFIX_RE.test(rawLabel)) {
    return { label: rawLabel.replace(URGENT_PREFIX_RE, "").trim(), urgent: true };
  }
  return { label: rawLabel, urgent: false };
}
