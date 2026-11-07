import { InlineKeyboard } from "grammy";
import type { BotContext } from "../index";
import { getBillById, listPaidBills, reopenBill } from "../../db/repository";
import { formatAmount, formatShortMonthRef } from "../../utils/billFormat";
import { escapeHtml } from "../../utils/text";
import { findBestMatch } from "../receipts/match";

export async function reopenBillAndReply(ctx: BotContext, billId: number): Promise<void> {
  const existing = await getBillById(billId);
  if (!existing) {
    await ctx.reply("Essa conta não existe.");
    return;
  }
  const bill = (await reopenBill(billId))!;
  const kb = new InlineKeyboard()
    .text("✅ Marcar como paga de novo", `paid:${bill.id}`)
    .row()
    .text(`📋 Ver contas (${formatShortMonthRef(bill.month_ref)})`, `month:${bill.month_ref}`);

  await ctx.reply(
    `↩️ Conta <b>${escapeHtml(existing.label)}</b> voltou pra pendente.\n\n` +
      `Ah, você não tinha pago?! Tá brincando com o dinheiro da família? Eu vou cobrar isso de você!`,
    { parse_mode: "HTML", reply_markup: kb }
  );
}

export async function reopenBillCommand(ctx: BotContext): Promise<void> {
  const arg = ctx.match?.toString().trim();
  const paid = await listPaidBills();

  if (!arg) {
    if (paid.length === 0) {
      await ctx.reply("Nenhuma conta paga registrada até agora pra reabrir.");
      return;
    }
    const kb = new InlineKeyboard();
    for (const bill of paid.slice(0, 8)) {
      const emoji = bill.emoji ? `${bill.emoji} ` : "";
      kb.text(
        `↩️ ${emoji}${bill.label} (${formatShortMonthRef(bill.month_ref)} · ${formatAmount(bill.amount)})`,
        `reopen:${bill.id}`
      ).row();
    }
    await ctx.reply("Qual conta paga você quer voltar para pendente? 👇", {
      reply_markup: kb,
    });
    return;
  }

  const billId = Number(arg);
  if (!Number.isNaN(billId) && Number.isInteger(billId) && billId > 0) {
    await reopenBillAndReply(ctx, billId);
    return;
  }

  const candidates = findBestMatch(arg, paid);

  if (candidates.length === 1) {
    await reopenBillAndReply(ctx, candidates[0].id);
    return;
  }

  if (candidates.length === 0) {
    await ctx.reply(`Não achei nenhuma conta paga parecida com "${arg}".`);
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const bill of candidates.slice(0, 6)) {
    keyboard
      .text(
        `↩️ ${bill.label} (${formatShortMonthRef(bill.month_ref)} · ${formatAmount(bill.amount)})`,
        `reopen:${bill.id}`
      )
      .row();
  }
  await ctx.reply(`Achei mais de uma parecida com "${arg}".\nQual delas?`, {
    reply_markup: keyboard,
  });
}
