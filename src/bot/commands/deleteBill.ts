import { InlineKeyboard } from "grammy";
import type { BotContext } from "../index";
import { config } from "../../config";
import { listBillsByMonth } from "../../db/repository";
import { monthRefOf, todayStr } from "../../utils/date";
import { formatAmount, formatDueDateShortPt } from "../../utils/billFormat";
import { escapeHtml } from "../../utils/text";
import { findBestMatch } from "../receipts/match";

export async function deleteBillCommand(ctx: BotContext): Promise<void> {
  const arg = ctx.match?.toString().trim() ?? "";
  const monthRef = monthRefOf(todayStr(config.timezone));
  const bills = await listBillsByMonth(monthRef);

  if (bills.length === 0) {
    await ctx.reply("Não há contas neste mês para apagar. Para gerenciar contas fixas, use /fixas.");
    return;
  }

  const candidates = arg ? findBestMatch(arg, bills) : bills;

  if (candidates.length === 0) {
    await ctx.reply(
      `Não achei nenhuma conta neste mês parecida com "<b>${escapeHtml(arg)}</b>".\nUse /contas ou /fixas para gerenciar.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const kb = new InlineKeyboard();
  for (const bill of candidates.slice(0, 8)) {
    const emoji = bill.emoji ? `${bill.emoji} ` : "";
    kb.text(
      `🗑️ Excluir ${emoji}${bill.label} (${formatDueDateShortPt(bill.due_date)} · ${formatAmount(bill.amount)})`,
      `delbill:${bill.id}:${monthRef}`
    ).row();
  }
  kb.text("⬅️ Cancelar", `month:${monthRef}`);

  await ctx.reply("Qual conta deste mês você quer excluir? 👇", {
    reply_markup: kb,
  });
}
