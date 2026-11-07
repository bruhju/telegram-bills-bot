import { InlineKeyboard } from "grammy";
import type { BotContext } from "../index";
import { config } from "../../config";
import {
  getBillById,
  listBillIdsWithReceiptsForMonth,
  listBillsByMonth,
  listPriorOverdueBills,
  listReceiptsByBillId,
} from "../../db/repository";
import { materializeRecurringBills } from "../../scheduler/dailyJob";
import {
  monthRefOf,
  nextMonthRef,
  parseMonthRefInput,
  prevMonthRef,
  todayStr,
} from "../../utils/date";
import {
  formatAmount,
  formatDueDatePt,
  formatDueDateShortPt,
  formatGroupedBillsList,
  formatMonthRef,
  formatShortMonthRef,
} from "../../utils/billFormat";
import { escapeHtml } from "../../utils/text";

export async function buildMonthBillsView(
  targetMonthRef?: string
): Promise<{ text: string; keyboard: InlineKeyboard; monthRef: string }> {
  const today = todayStr(config.timezone);
  const currentMonthRef = monthRefOf(today);
  const monthRef = targetMonthRef ?? currentMonthRef;
  const monthLabel = formatMonthRef(monthRef);

  // Materializa contas fixas para o mês atual ou futuro
  if (monthRef >= currentMonthRef) {
    await materializeRecurringBills(monthRef);
  }

  const [bills, receiptBillIds, priorOverdue] = await Promise.all([
    listBillsByMonth(monthRef),
    listBillIdsWithReceiptsForMonth(monthRef),
    monthRef === currentMonthRef ? listPriorOverdueBills(currentMonthRef) : Promise.resolve([]),
  ]);

  const keyboard = new InlineKeyboard();
  const sections: string[] = [];

  if (priorOverdue.length > 0) {
    const overdueLines = priorOverdue.map((b) => {
      const emojiTag = b.emoji ? `${b.emoji} ` : "";
      return `🔴 ${emojiTag}<b>${escapeHtml(b.label)}</b> (${formatShortMonthRef(b.month_ref)} · ${formatDueDateShortPt(b.due_date)}) — ${formatAmount(b.amount)}`;
    });
    sections.push(
      `🚨 <b>Atenção! Pendentes de meses anteriores:</b>\n` + overdueLines.join("\n")
    );
    for (const b of priorOverdue.slice(0, 3)) {
      keyboard.text(`✅ Pagar ${b.label} (${formatShortMonthRef(b.month_ref)})`, `paid:${b.id}:${monthRef}`).row();
    }
  }

  if (bills.length === 0) {
    sections.push(
      `📅 <b>${monthLabel}</b>\n\n` +
        `Nenhuma conta cadastrada em ${monthLabel}? Tem certeza?\n` +
        `Porque se eu achar uma fatura escondida de 8 reais e 90 centavos, eu vou descontar da sua mesada.`
    );
  } else {
    const paidCount = bills.filter((b) => b.status === "paid").length;
    const groupedBody = formatGroupedBillsList(bills, today, receiptBillIds);

    sections.push(
      `📅 <b>${monthLabel} — ${paidCount}/${bills.length} pagas</b>\n\n` +
        `${groupedBody}`
    );

    const pendingBills = bills.filter((b) => b.status === "pending");
    for (let i = 0; i < pendingBills.length; i += 2) {
      const first = pendingBills[i];
      const firstEmoji = first.emoji ? `${first.emoji} ` : "";
      keyboard.text(`✅ ${firstEmoji}${first.label}`, `paid:${first.id}:${monthRef}`);
      const second = pendingBills[i + 1];
      if (second) {
        const secondEmoji = second.emoji ? `${second.emoji} ` : "";
        keyboard.text(`✅ ${secondEmoji}${second.label}`, `paid:${second.id}:${monthRef}`);
      }
      keyboard.row();
    }
  }

  // Action bar
  if (bills.length > 0) {
    keyboard.text("⚙️ Editar / Excluir", `managebills:${monthRef}`);
  }
  keyboard.text("➕ Nova conta", "cmd:/addconta");
  if (receiptBillIds.size > 0) {
    keyboard.text("📎 Comprovantes", "cmd:/comprovantes");
  }
  keyboard.row();

  // Month navigation row
  const prev = prevMonthRef(monthRef);
  const next = nextMonthRef(monthRef);
  keyboard.text(`⬅️ ${formatShortMonthRef(prev)}`, `month:${prev}`);
  if (monthRef !== currentMonthRef) {
    keyboard.text("📅 Mês atual", `month:${currentMonthRef}`);
  }
  keyboard.text(`${formatShortMonthRef(next)} ➡️`, `month:${next}`);

  return {
    text: sections.join("\n\n"),
    keyboard,
    monthRef,
  };
}

export async function renderMonthBillsView(
  ctx: BotContext,
  monthRef?: string,
  editInPlace = false
): Promise<void> {
  const { text, keyboard } = await buildMonthBillsView(monthRef);
  if (editInPlace) {
    try {
      await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
      return;
    } catch {
      // Fallback to reply if message cannot be edited
    }
  }
  await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
}

export async function renderManageBillsView(
  ctx: BotContext,
  monthRef: string,
  editInPlace = true
): Promise<void> {
  const bills = await listBillsByMonth(monthRef);
  const monthLabel = formatMonthRef(monthRef);
  const kb = new InlineKeyboard();

  for (let i = 0; i < bills.length; i += 2) {
    const b1 = bills[i];
    const s1 = b1.status === "paid" ? "✅" : "⚪";
    const e1 = b1.emoji ? `${b1.emoji} ` : "";
    kb.text(`✏️ ${s1} ${e1}${b1.label}`, `editbill:${b1.id}:${monthRef}`);
    const b2 = bills[i + 1];
    if (b2) {
      const s2 = b2.status === "paid" ? "✅" : "⚪";
      const e2 = b2.emoji ? `${b2.emoji} ` : "";
      kb.text(`✏️ ${s2} ${e2}${b2.label}`, `editbill:${b2.id}:${monthRef}`);
    }
    kb.row();
  }
  kb.text("⬅️ Voltar para a lista", `month:${monthRef}`);

  const text =
    `⚙️ <b>Gerenciar contas — ${monthLabel}</b>\n\n` +
    `Toque em uma conta abaixo para editar valor, vencimento, ver comprovante ou excluir:`;

  if (editInPlace) {
    try {
      await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
      return;
    } catch {
      // Fallback
    }
  }
  await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
}

export async function renderSingleBillEditView(
  ctx: BotContext,
  billId: number,
  monthRef: string,
  editInPlace = true
): Promise<void> {
  const bill = await getBillById(billId);
  if (!bill) {
    await ctx.reply("Essa conta não existe mais.");
    return;
  }

  const receipts = await listReceiptsByBillId(bill.id);
  const emoji = bill.emoji ? `${bill.emoji} ` : "";
  const urgentText = bill.urgent === 1 ? "Sim 🚨" : "Não";
  const statusText = bill.status === "paid" ? "✅ Paga" : "⏳ Pendente";

  const text =
    `⚙️ <b>Detalhes da conta</b>\n\n` +
    `📌 Nome: ${emoji}<b>${escapeHtml(bill.label)}</b>\n` +
    `📊 Status: <b>${statusText}</b>\n` +
    `🗓️ Vencimento: <b>${formatDueDatePt(bill.due_date)}</b>\n` +
    `💰 Valor: <b>${formatAmount(bill.amount)}</b>\n` +
    `🚨 Urgente: <b>${urgentText}</b>\n` +
    `📎 Comprovantes vinculados: <b>${receipts.length}</b>`;

  const kb = new InlineKeyboard()
    .text("💲 Alterar valor", `askamount:${bill.id}:${monthRef}`)
    .text("🗓️ Alterar vencimento", `askduedate:${bill.id}:${monthRef}`)
    .row()
    .text(
      bill.urgent === 1 ? "🔕 Tirar urgência" : "🚨 Marcar urgente",
      `togglebillurgent:${bill.id}:${monthRef}`
    );

  if (bill.status === "pending") {
    kb.text("✅ Marcar paga", `paid:${bill.id}:${monthRef}`);
  } else {
    kb.text("↩️ Reabrir conta", `reopen:${bill.id}:${monthRef}`);
  }
  kb.row();

  for (const r of receipts.slice(0, 2)) {
    kb.text(`📎 Ver comprovante #${r.id}`, `sendreceipt:${r.id}`).row();
  }

  kb.text("🗑️ Excluir conta", `delbill:${bill.id}:${monthRef}`)
    .text("⬅️ Voltar", `managebills:${monthRef}`);

  if (editInPlace) {
    try {
      await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
      return;
    } catch {
      // Fallback
    }
  }
  await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
}

export async function listBillsCommand(ctx: BotContext): Promise<void> {
  const arg = ctx.match?.toString().trim() ?? "";
  const today = todayStr(config.timezone);
  let targetMonth = monthRefOf(today);

  if (arg) {
    const parsed = parseMonthRefInput(arg, today);
    if (!parsed) {
      await ctx.reply(
        `Não entendi o mês "${arg}".\nUse algo como <code>/contas 12/2026</code>, <code>/contas dez</code> ou apenas <code>/contas</code>.`,
        { parse_mode: "HTML" }
      );
      return;
    }
    targetMonth = parsed;
  }

  await renderMonthBillsView(ctx, targetMonth, false);
}
