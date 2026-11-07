import { InlineKeyboard } from "grammy";
import type { BotContext } from "../index";
import { config } from "../../config";
import { listBillsByMonth } from "../../db/repository";
import { materializeRecurringBills } from "../../scheduler/dailyJob";
import { formatAmount, formatMonthRef } from "../../utils/billFormat";
import { monthRefOf, todayStr } from "../../utils/date";

export async function startCommand(ctx: BotContext): Promise<void> {
  const today = todayStr(config.timezone);
  const monthRef = monthRefOf(today);
  await materializeRecurringBills(monthRef);
  const bills = await listBillsByMonth(monthRef);

  const pending = bills.filter((b) => b.status === "pending");
  const paid = bills.filter((b) => b.status === "paid");
  const overdue = pending.filter((b) => b.due_date && b.due_date < today);
  const pendingSum = pending.reduce((acc, b) => acc + (b.amount ?? 0), 0);

  let statusLine = `📅 <b>${formatMonthRef(monthRef)}</b>: `;
  if (bills.length === 0) {
    statusLine += `nenhuma conta cadastrada ainda.`;
  } else if (pending.length === 0) {
    statusLine += `🎉 todas as ${bills.length} contas pagas!`;
  } else {
    const overdueTag = overdue.length > 0 ? ` · 🔴 <b>${overdue.length} atrasada(s)</b>` : "";
    const sumTag = pendingSum > 0 ? ` (${formatAmount(pendingSum)})` : "";
    statusLine += `<b>${paid.length}/${bills.length} pagas</b> · faltam ${pending.length}${sumTag}${overdueTag}`;
  }

  const keyboard = new InlineKeyboard()
    .text("📋 Contas do mês", `month:${monthRef}`)
    .text("🔁 Contas fixas", "cmd:/fixas")
    .row()
    .text("➕ Adicionar conta", "cmd:/addconta")
    .text("➕ Conta fixa", "cmd:/addfixa")
    .row()
    .text("📎 Comprovantes", "cmd:/comprovantes")
    .text("📖 Ajuda", "cmd:/ajuda");

  await ctx.reply(
    "Chegou! Eu tomo conta das suas contas 💪\n\n" +
      `${statusLine}\n\n` +
      "Escolhe aí embaixo, ou escreve direto no chat:\n" +
      "• <b>aluguel 1200 todo dia 5</b> (cria conta)\n" +
      "• <b>paguei luz 185,90</b> (dá baixa na hora)\n" +
      "• Ou só me manda a <b>foto/PDF do comprovante</b>!",
    { parse_mode: "HTML", reply_markup: keyboard }
  );
}

export async function helpCommand(ctx: BotContext): Promise<void> {
  await ctx.reply(
    "📖 <b>Como usar o bot:</b>\n\n" +
      "<b>Comandos principais:</b>\n" +
      "/contas — painel do mês atual (ou <code>/contas 12/2026</code>)\n" +
      "/fixas — lista e edita as contas fixas mensais\n" +
      "/addconta — cria uma conta passo a passo\n" +
      "/addfixa — cria uma conta fixa (recorrente) passo a passo\n" +
      "/pago — mostra botões para dar baixa (ou <code>/pago luz 185,90</code>)\n" +
      "/reabrir — reabre uma conta paga\n" +
      "/comprovantes — lista e baixa os comprovantes salvos\n" +
      "/apagar — exclui uma conta do mês\n" +
      "/listamensal — resumo de pendências do mês\n" +
      "/cancelar — cancela conversa em andamento\n\n" +
      "<b>Atalhos sem comando (só mandar no chat):</b>\n" +
      "💬 <b>aluguel 1200 dia 5</b> — cadastra conta avulsa\n" +
      "🔁 <b>internet 120 todo dia 10</b> — cadastra conta fixa\n" +
      "✅ <b>paguei luz 185,90</b> — marca a conta como paga e atualiza o valor\n" +
      "📸 <b>Foto ou PDF</b> (com ou sem legenda) — salva o comprovante e dá baixa na conta!\n" +
      "🚨 Use <b>urgente</b> no nome pra eu cobrar em dobro (9h e 20h).\n\n" +
      "Agora vai trabalhar.",
    { parse_mode: "HTML" }
  );
}
