import { InlineKeyboard } from "grammy";
import type { BotContext } from "./index";
import { config } from "../config";
import { listPendingBills } from "../db/repository";
import { formatAmount, formatDueDateShortPt } from "../utils/billFormat";
import { todayStr } from "../utils/date";
import { parseBillMention, parsePaymentMention } from "../utils/nlp";
import { escapeHtml } from "../utils/text";
import { markBillPaidAndReply } from "./commands/markPaid";
import { findBestMatch } from "./receipts/match";
import { getFlow, hydrateFlow, takeExpiredFlow } from "./state";
import { handleWizardText, startNlConfirm } from "./wizard";

const fallbackKeyboard = (): InlineKeyboard =>
  new InlineKeyboard()
    .text("📋 Contas do mês", "cmd:/contas")
    .text("➕ Adicionar conta", "cmd:/addconta");

/**
 * Handler for any plain text that survived the command handlers:
 * wizard input when a flow is active, natural-language payment ("paguei luz 180"),
 * or natural-language bill creation ("aluguel 1200 dia 5").
 */
export async function handleTextMessage(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text?.trim();
  // Unknown /commands stay silent (previous behavior).
  if (!text || text.startsWith("/")) return;

  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;

  await hydrateFlow(chatId);

  const flow = getFlow(chatId);
  if (flow) {
    await handleWizardText(ctx, flow);
    return;
  }

  if (takeExpiredFlow(chatId)) {
    await ctx.reply("A conversa anterior expirou ⏰ (10 min). Bora começar de novo?", {
      reply_markup: fallbackKeyboard(),
    });
    return;
  }

  // 1. Check if the user is saying they paid a bill ("paguei luz 185,90", "pago enel 1503")
  const payment = parsePaymentMention(text);
  if (payment) {
    const pending = await listPendingBills();
    const rawAfterVerb = text
      .replace(/^(?:paguei|pago|quitei|quitar)\s+(?:(?:a|o)\s+)?(?:conta\s+(?:d[eao]\s+)?)?/i, "")
      .trim();
    const fullCandidates = findBestMatch(rawAfterVerb, pending);
    if (fullCandidates.length === 1 && /\d/.test(fullCandidates[0].label)) {
      await markBillPaidAndReply(ctx, fullCandidates[0].id);
      return;
    }

    const candidates = findBestMatch(payment.query, pending);

    if (candidates.length === 1) {
      await markBillPaidAndReply(ctx, candidates[0].id, payment.amount ?? undefined);
      return;
    }

    if (candidates.length > 1) {
      const kb = new InlineKeyboard();
      for (const bill of candidates.slice(0, 6)) {
        kb.text(
          `✅ ${bill.label} (${formatDueDateShortPt(bill.due_date)} · ${formatAmount(bill.amount)})`,
          `paid:${bill.id}`
        ).row();
      }
      await ctx.reply(
        `Achei mais de uma conta pendente parecida com "<b>${escapeHtml(payment.query)}</b>". Qual você pagou? 👇`,
        { parse_mode: "HTML", reply_markup: kb }
      );
      return;
    }

    const kb = new InlineKeyboard();
    for (const bill of pending.slice(0, 6)) {
      kb.text(`✅ ${bill.label} (${formatAmount(bill.amount)})`, `paid:${bill.id}`).row();
    }
    await ctx.reply(
      `Não achei conta pendente chamada "<b>${escapeHtml(payment.query)}</b>".` +
        (pending.length > 0 ? "\nEra alguma dessas abaixo? 👇" : "\nNenhuma conta pendente no momento!"),
      { parse_mode: "HTML", reply_markup: pending.length > 0 ? kb : undefined }
    );
    return;
  }

  // 2. Check if the user is creating a bill via free text ("aluguel 1200 dia 5")
  const parsed = parseBillMention(text, todayStr(config.timezone));
  if (parsed) {
    await startNlConfirm(ctx, parsed);
    return;
  }

  await ctx.reply(
    "Não entendi 😅 — você pode:\n" +
      "• Criar conta: <b>aluguel 1200 dia 5</b> ou <b>luz 180 todo dia 10</b>\n" +
      "• Avisar pagamento: <b>paguei luz 185,90</b>\n" +
      "• Ou usar os botões abaixo:",
    { parse_mode: "HTML", reply_markup: fallbackKeyboard() }
  );
}
