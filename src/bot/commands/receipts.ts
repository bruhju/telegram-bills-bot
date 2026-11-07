import { InlineKeyboard } from "grammy";
import type { BotContext } from "../index";
import { getReceiptById, listRecentReceipts } from "../../db/repository";
import { formatAmount, formatShortMonthRef } from "../../utils/billFormat";
import { escapeHtml, stripAccents } from "../../utils/text";

export async function sendReceiptFile(ctx: BotContext, receiptId: number): Promise<void> {
  const receipt = await getReceiptById(receiptId);
  if (!receipt) {
    await ctx.reply("Não encontrei esse comprovante no banco.");
    return;
  }

  const title = receipt.bill_label ?? receipt.label;
  const monthInfo = receipt.bill_month_ref ? ` (${formatShortMonthRef(receipt.bill_month_ref)})` : "";
  const amountInfo =
    receipt.bill_amount !== null && receipt.bill_amount !== undefined
      ? ` — ${formatAmount(receipt.bill_amount)}`
      : "";
  const caption = `📎 Comprovante: <b>${escapeHtml(title)}</b>${monthInfo}${amountInfo}`;

  try {
    if (receipt.file_type === "photo") {
      await ctx.replyWithPhoto(receipt.telegram_file_id, {
        caption,
        parse_mode: "HTML",
      });
    } else {
      await ctx.replyWithDocument(receipt.telegram_file_id, {
        caption,
        parse_mode: "HTML",
      });
    }
  } catch (err) {
    console.error("Erro reenviando comprovante do Telegram:", err);
    await ctx.reply("Não consegui reenviar o arquivo pelo Telegram agora 😅");
  }
}

export async function listReceiptsCommand(ctx: BotContext): Promise<void> {
  const query = stripAccents(ctx.match?.toString().trim() ?? "").toLowerCase();
  const allReceipts = await listRecentReceipts(20);

  const filtered = query
    ? allReceipts.filter((r) => {
        const hay = stripAccents(`${r.bill_label ?? ""} ${r.label}`).toLowerCase();
        return hay.includes(query);
      })
    : allReceipts;

  if (filtered.length === 0) {
    await ctx.reply(
      query
        ? `Nenhum comprovante encontrado para "<b>${escapeHtml(query)}</b>".`
        : "📎 Nenhum comprovante salvo ainda.\n\nSempre que pagar uma conta, é só mandar a foto ou PDF aqui no chat (com ou sem legenda) que eu guardo e dou baixa!",
      { parse_mode: "HTML" }
    );
    return;
  }

  const lines = filtered.slice(0, 10).map((r) => {
    const name = escapeHtml(r.bill_label ?? r.label);
    const month = r.bill_month_ref ? ` (${formatShortMonthRef(r.bill_month_ref)})` : "";
    const status = r.bill_id ? "✅" : "⚠️ sem vínculo";
    return `${status} <b>${name}</b>${month}`;
  });

  const kb = new InlineKeyboard();
  for (const r of filtered.slice(0, 8)) {
    const name = r.bill_label ?? r.label;
    const month = r.bill_month_ref ? ` (${formatShortMonthRef(r.bill_month_ref)})` : "";
    kb.text(`📎 Baixar: ${name}${month}`, `sendreceipt:${r.id}`).row();
  }
  kb.text("📋 Voltar para contas do mês", "cmd:/contas");

  await ctx.reply(
    `📎 <b>Comprovantes salvos (${filtered.length})</b>\n` +
      `Toque em qualquer um abaixo que eu te reenvio o arquivo na hora:\n\n` +
      `${lines.join("\n")}`,
    { parse_mode: "HTML", reply_markup: kb }
  );
}
