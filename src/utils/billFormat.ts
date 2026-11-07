import type { Bill } from "../db/repository";
import { diffDaysStr } from "./date";
import { escapeHtml } from "./text";

const MONTH_NAMES_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

const SHORT_MONTH_NAMES_PT = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

export function formatMonthRef(monthRef: string): string {
  const [year, month] = monthRef.split("-").map(Number);
  return `${MONTH_NAMES_PT[month - 1]} ${year}`;
}

export function formatShortMonthRef(monthRef: string): string {
  const [year, month] = monthRef.split("-").map(Number);
  return `${SHORT_MONTH_NAMES_PT[month - 1]}/${String(year).slice(-2)}`;
}

export function formatAmount(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "indefinido";
  const [intPart, decPart] = Math.abs(amount).toFixed(2).split(".");
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sign = amount < 0 ? "-" : "";
  return `R$ ${sign}${formattedInt},${decPart}`;
}

export function formatDueDate(dueDate: string | null): string {
  return formatDueDatePt(dueDate);
}

/** dd/mm/yyyy for wizard and natural-language replies. */
export function formatDueDatePt(dueDate: string | null): string {
  if (!dueDate) return "indefinido";
  const [year, month, day] = dueDate.split("-");
  return `${day}/${month}/${year}`;
}

/** dd/mm for compact monthly lists. */
export function formatDueDateShortPt(dueDate: string | null): string {
  if (!dueDate) return "sem data";
  const [, month, day] = dueDate.split("-");
  return `${day}/${month}`;
}

export function formatBillLine(bill: Bill): string {
  const emojiTag = bill.emoji ? `${bill.emoji} ` : "";
  const amountSegment = bill.amount !== null ? ` — ${formatAmount(bill.amount)}` : "";
  return `• ${emojiTag}<b>${escapeHtml(bill.label)}</b> (dia ${bill.due_date ? bill.due_date.slice(8, 10) : "?"})${amountSegment}`;
}

/**
 * Formats bills grouped by due day (Option 1 layout):
 *
 * 🔴 Dia 05 (atrasadas)
 * • 🗣️ Inglês Joyce
 * • 🤑 Terapia Joyce
 *
 * 🟡 Dia 07 (vence hoje!)
 * • 🏢 Condomínio
 *
 * ⚪ Dia 10
 * • 🚀 Aviva
 * ...
 *
 * ✅ Pagas (2)
 * • ...
 */
export function formatGroupedBillsList(
  bills: Bill[],
  today: string,
  receiptBillIds: Set<number> = new Set()
): string {
  const pending = bills.filter((b) => b.status === "pending");
  const paid = bills.filter((b) => b.status === "paid");

  const blocks: string[] = [];

  // Group pending bills by due_date
  const groups = new Map<string, Bill[]>();
  for (const bill of pending) {
    const key = bill.due_date ?? "sem-data";
    const list = groups.get(key) ?? [];
    list.push(bill);
    groups.set(key, list);
  }

  for (const [dueDate, groupBills] of groups.entries()) {
    let header: string;
    if (dueDate === "sem-data") {
      header = `⚪ <b>Sem data</b>`;
    } else {
      const dayNum = dueDate.slice(8, 10);
      const diff = diffDaysStr(today, dueDate);
      if (diff < 0) {
        const label = groupBills.length === 1 ? "atrasada" : "atrasadas";
        header = `🔴 <b>Dia ${dayNum} (${label})</b>`;
      } else if (diff === 0) {
        header = `🟡 <b>Dia ${dayNum} (vence hoje!)</b>`;
      } else if (diff === 1) {
        header = `🟡 <b>Dia ${dayNum} (vence amanhã)</b>`;
      } else {
        header = `⚪ <b>Dia ${dayNum}</b>`;
      }
    }

    const itemLines = groupBills.map((b) => {
      const emoji = b.emoji ? `${b.emoji} ` : "";
      const amountPart = b.amount !== null ? ` — ${formatAmount(b.amount)}` : "";
      return `• ${emoji}${escapeHtml(b.label)}${amountPart}`;
    });

    blocks.push(`${header}\n${itemLines.join("\n")}`);
  }

  if (paid.length > 0) {
    const paidLines = paid.map((b) => {
      const emoji = b.emoji ? `${b.emoji} ` : "";
      const receiptTag = receiptBillIds.has(b.id) ? " 📎" : "";
      const amountPart = b.amount !== null ? ` — ${formatAmount(b.amount)}` : "";
      return `• ${emoji}${escapeHtml(b.label)}${amountPart}${receiptTag}`;
    });
    blocks.push(`✅ <b>Pagas (${paid.length})</b>\n${paidLines.join("\n")}`);
  }

  // Only show financial totals if at least one bill has a numeric amount
  const hasAnyAmount = bills.some((b) => b.amount !== null);
  if (hasAnyAmount) {
    const paidSum = paid.reduce((acc, b) => acc + (b.amount ?? 0), 0);
    const pendingSum = pending.reduce((acc, b) => acc + (b.amount ?? 0), 0);
    blocks.push(
      `───────────────\n` +
        `💰 Pago: <b>${formatAmount(paidSum)}</b> · Falta: <b>${formatAmount(pendingSum)}</b>`
    );
  }

  return blocks.join("\n\n");
}
