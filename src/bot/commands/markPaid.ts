import { InlineKeyboard } from "grammy";
import type { BotContext } from "../index";
import { getBillById, listPendingBills, markBillPaid } from "../../db/repository";
import { formatAmount, formatDueDateShortPt, formatShortMonthRef } from "../../utils/billFormat";
import { parsePaymentMention } from "../../utils/nlp";
import { escapeHtml } from "../../utils/text";
import { findBestMatch } from "../receipts/match";

export async function markBillPaidAndReply(
  ctx: BotContext,
  billId: number,
  amount?: number
): Promise<void> {
  const existing = await getBillById(billId);
  if (!existing) {
    await ctx.reply(
      "Essa conta não existe.\nVocê tá inventando conta pra jogar dinheiro fora? Me dá esse dinheiro aqui então!"
    );
    return;
  }
  const bill = (await markBillPaid(billId, amount))!;
  const kb = new InlineKeyboard()
    .text("↩️ Desfazer", `reopen:${bill.id}`)
    .text(`📋 Contas (${formatShortMonthRef(bill.month_ref)})`, `month:${bill.month_ref}`);

  const emoji = bill.emoji ? `${bill.emoji} ` : "";
  const amountNote = bill.amount !== null ? ` (${formatAmount(bill.amount)})` : "";

  await ctx.reply(
    `✅ <b>${emoji}${escapeHtml(bill.label)}</b>${amountNote} paga! Menos uma pra me dar dor de cabeça.`,
    { parse_mode: "HTML", reply_markup: kb }
  );
}

export async function markPaidCommand(ctx: BotContext): Promise<void> {
  const arg = ctx.match?.toString().trim();
  const pending = await listPendingBills();

  if (!arg) {
    if (pending.length === 0) {
      await ctx.reply(
        "🎉 Não tem nenhuma conta pendente no momento! Isso é um milagre — guarda esse dinheiro!"
      );
      return;
    }
    const kb = new InlineKeyboard();
    const list = pending.slice(0, 20);
    for (let i = 0; i < list.length; i += 2) {
      const b1 = list[i];
      const e1 = b1.emoji ? `${b1.emoji} ` : "";
      kb.text(`✅ ${e1}${b1.label}`, `paid:${b1.id}`);
      const b2 = list[i + 1];
      if (b2) {
        const e2 = b2.emoji ? `${b2.emoji} ` : "";
        kb.text(`✅ ${e2}${b2.label}`, `paid:${b2.id}`);
      }
      kb.row();
    }
    await ctx.reply(
      "Qual conta você pagou? Toca aí embaixo 👇\n<i>(Dica: você também pode mandar <code>/pago luz 185,90</code> ou só escrever <code>paguei luz 185,90</code>)</i>",
      { parse_mode: "HTML", reply_markup: kb }
    );
    return;
  }

  // If the full argument (e.g. "enel 1503") directly matches a single bill whose label
  // contains that number, prefer matching the full label over treating the number as R$.
  const fullMatchCandidates = findBestMatch(arg, pending);
  if (
    fullMatchCandidates.length === 1 &&
    /\d/.test(fullMatchCandidates[0].label)
  ) {
    await markBillPaidAndReply(ctx, fullMatchCandidates[0].id);
    return;
  }

  const parsed = parsePaymentMention(`pago ${arg}`);
  const query = parsed?.query ?? arg;
  const amount = parsed?.amount ?? undefined;

  const billId = Number(query);
  if (!Number.isNaN(billId) && Number.isInteger(billId) && billId > 0) {
    await markBillPaidAndReply(ctx, billId, amount);
    return;
  }

  const candidates = findBestMatch(query, pending);

  if (candidates.length === 1) {
    await markBillPaidAndReply(ctx, candidates[0].id, amount);
    return;
  }

  if (candidates.length === 0) {
    const kb = new InlineKeyboard();
    for (const bill of pending.slice(0, 6)) {
      kb.text(`✅ ${bill.label} (${formatAmount(bill.amount)})`, `paid:${bill.id}`).row();
    }
    await ctx.reply(
      `Não achei nenhuma conta pendente parecida com "<b>${escapeHtml(query)}</b>".\n` +
        (pending.length > 0 ? "Era alguma dessas aqui embaixo? 👇" : "Nenhuma conta pendente!"),
      { parse_mode: "HTML", reply_markup: pending.length > 0 ? kb : undefined }
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const bill of candidates.slice(0, 6)) {
    keyboard
      .text(
        `✅ ${bill.label} (${formatDueDateShortPt(bill.due_date)} · ${formatAmount(bill.amount)})`,
        `paid:${bill.id}`
      )
      .row();
  }
  await ctx.reply(`Achei mais de uma parecida com "<b>${escapeHtml(query)}</b>". Qual delas?`, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
}
