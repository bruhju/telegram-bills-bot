import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import { config } from "../config";
import {
  hasInstanceForMonth,
  hasReminderBeenSent,
  insertBill,
  listOverduePendingBills,
  listPendingBillsByDueDate,
  listPendingBillsByMonth,
  listRecurringBills,
  logReminderSent,
} from "../db/repository";
import type { Bill } from "../db/repository";
import { addDaysStr, dueDateForMonth, monthRefOf, todayStr } from "../utils/date";
import {
  formatBillLine,
  formatGroupedBillsList,
  formatMonthRef,
} from "../utils/billFormat";
import { escapeHtml } from "../utils/text";

export type DailySlot = "morning" | "evening";

export interface MonthlyChecklist {
  text: string;
  bills: Bill[];
  keyboard?: InlineKeyboard;
}

export async function buildMonthlyChecklist(monthRef: string): Promise<MonthlyChecklist> {
  await materializeRecurringBills(monthRef);
  const pending = await listPendingBillsByMonth(monthRef);

  const monthLabel = formatMonthRef(monthRef);

  if (pending.length === 0) {
    return {
      text: `🎉 Nenhuma conta pendente em <b>${monthLabel}</b>. Isso é um milagre!\nLembre-se: se eu não comprar nada, o desconto é bem maior.`,
      bills: [],
      keyboard: new InlineKeyboard().text("📋 Ver contas do mês", `month:${monthRef}`),
    };
  }

  const today = todayStr(config.timezone);
  const groupedBody = formatGroupedBillsList(pending, today);

  const keyboard = new InlineKeyboard();
  const list = pending.slice(0, 20);
  for (let i = 0; i < list.length; i += 2) {
    const b1 = list[i];
    const e1 = b1.emoji ? `${b1.emoji} ` : "";
    keyboard.text(`✅ ${e1}${b1.label}`, `paid:${b1.id}`);
    const b2 = list[i + 1];
    if (b2) {
      const e2 = b2.emoji ? `${b2.emoji} ` : "";
      keyboard.text(`✅ ${e2}${b2.label}`, `paid:${b2.id}`);
    }
    keyboard.row();
  }
  keyboard.text("📋 Abrir painel do mês", `month:${monthRef}`);

  const text =
    `\u{1F4C5} <b>${monthLabel} — faltam ${pending.length}</b>\n\n` +
    `${groupedBody}`;

  return { text, bills: pending, keyboard };
}

export async function materializeRecurringBills(monthRef: string): Promise<void> {
  const recurringBills = await listRecurringBills();
  for (const recurring of recurringBills) {
    if (await hasInstanceForMonth(recurring.id, monthRef)) continue;
    await insertBill({
      label: recurring.label,
      amount: recurring.amount,
      dueDate: dueDateForMonth(monthRef, recurring.due_day),
      monthRef,
      emoji: recurring.emoji,
      urgent: recurring.urgent === 1,
      recurringBillId: recurring.id,
    });
  }
}

async function sendMonthlyList(api: Api, monthRef: string): Promise<void> {
  const { text, bills, keyboard } = await buildMonthlyChecklist(monthRef);
  await api.sendMessage(config.chatId, text, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
  for (const bill of bills) {
    await logReminderSent(bill.id, "monthly_list", monthRef);
  }
}

function dueHeadline(bill: Bill, type: "due_tomorrow" | "due_today"): string {
  const urgent = bill.urgent === 1;
  if (type === "due_tomorrow") {
    return urgent
      ? "\u{1F6A8} amanha vence essa!\nVoce acha que dinheiro da em arvore?\nVai dormir so depois de pagar isso!"
      : "Amanha vence essa aqui.\nSe pagar hoje a gente nao da 1 real e 43 centavos de taxa pro gerente do banco.\nQuem paga antes, dorme tranquilo.";
  }
  return urgent
    ? "\u{1F6A8} hoje e o dia, e eu ja to com dor de cabeca!\nEu nao trabalho em dois empregos pra voce esquecer de pagar boleto no dia certo!"
    : `Hoje e o dia da <b>${escapeHtml(bill.label)}</b>. Paga logo!\nNao deixa pra meia-noite porque o sistema cai, vira o dia e la se vao mais 5 reais de multa por atraso!`;
}

async function sendDueReminders(
  api: Api,
  dueDate: string,
  type: "due_tomorrow" | "due_today",
  slot: DailySlot
): Promise<void> {
  const bills = await listPendingBillsByDueDate(dueDate);
  for (const bill of bills) {
    const urgent = bill.urgent === 1;
    if (!urgent && slot !== "morning") continue;

    const referenceDate = urgent ? `${dueDate}:${slot}` : dueDate;
    if (await hasReminderBeenSent(bill.id, type, referenceDate)) continue;

    const keyboard = new InlineKeyboard().text("Marcar como pago", `paid:${bill.id}`);
    await api.sendMessage(config.chatId, `${dueHeadline(bill, type)}\n\n${formatBillLine(bill)}`, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
    await logReminderSent(bill.id, type, referenceDate);
  }
}

async function sendOverdueReminders(api: Api, today: string): Promise<void> {
  const overdue = await listOverduePendingBills(today);
  for (const bill of overdue) {
    if (await hasReminderBeenSent(bill.id, "overdue", today)) continue;

    const keyboard = new InlineKeyboard().text("Marcar como pago", `paid:${bill.id}`);
    await api.sendMessage(
      config.chatId,
      `Essa ai ja venceu! Voce ta me devendo juros!\n` +
        `A cada minuto que passa e o meu dinheiro indo pelo ralo!\n` +
        `Paga isso agora ou eu desconto da sua comida!\n\n${formatBillLine(bill)}`,
      { parse_mode: "HTML", reply_markup: keyboard }
    );
    await logReminderSent(bill.id, "overdue", today);
  }
}

export async function runDailyJob(
  api: Api,
  dateStr?: string,
  slot: DailySlot = "morning"
): Promise<void> {
  const today = dateStr ?? todayStr(config.timezone);
  const monthRef = monthRefOf(today);
  const day = Number(today.slice(8, 10));

  await materializeRecurringBills(monthRef);

  if (slot === "morning" && day === 5) {
    await sendMonthlyList(api, monthRef);
  }

  const tomorrow = addDaysStr(today, 1);
  await sendDueReminders(api, tomorrow, "due_tomorrow", slot);
  await sendDueReminders(api, today, "due_today", slot);

  if (slot === "morning") {
    await sendOverdueReminders(api, today);
  }
}
