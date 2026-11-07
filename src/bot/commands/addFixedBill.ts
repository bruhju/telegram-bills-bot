import type { BotContext } from "../index";
import { insertRecurringBill } from "../../db/repository";
import { materializeRecurringBills } from "../../scheduler/dailyJob";
import { config } from "../../config";
import { monthRefOf, todayStr } from "../../utils/date";
import { parseUrgentLabel } from "../../utils/text";
import { formatAmount } from "../../utils/billFormat";
import { startAddFixaWizard } from "../wizard";
import { clearFlow } from "../state";

export async function addFixedBillCommand(ctx: BotContext): Promise<void> {
  const text = ctx.match?.toString().trim() ?? "";
  if (!text) {
    await startAddFixaWizard(ctx);
    return;
  }

  const [rawLabel, dueDayRaw, emojiRaw, amountRaw] = text.split("|").map((part) => part.trim());

  if (!rawLabel) {
    await ctx.reply("Conta fixa sem nome nao existe.\nMe fala o nome, eu nao adivinho boleto de ninguem.");
    return;
  }

  const { label, urgent } = parseUrgentLabel(rawLabel);

  const dueDay = Number(dueDayRaw);
  if (!dueDayRaw || Number.isNaN(dueDay) || dueDay < 1 || dueDay > 31) {
    await ctx.reply(
      "Dia de vencimento vai de 1 a 31.\n" +
        "Mes nao tem dia 45.\n" +
        "Se quiser inventar dia pra atrasar pagamento e pagar multa, vai fazer isso com o seu dinheiro!"
    );
    return;
  }

  const emoji = emojiRaw && emojiRaw !== "-" ? emojiRaw : null;

  let amount: number | null = null;
  if (amountRaw && amountRaw !== "-") {
    const parsed = Number(amountRaw.replace(",", "."));
    if (Number.isNaN(parsed)) {
      await ctx.reply(
        "Isso ai nao e numero, e invencao.\nE la em casa, invencao nao quita boleto.\nColoca o valor exato, ate os centavos."
      );
      return;
    }
    amount = parsed;
  }

  const recurring = await insertRecurringBill({ label, dueDay, amount, emoji, urgent });
  await materializeRecurringBills(monthRefOf(todayStr(config.timezone)));
  if (ctx.chat) clearFlow(ctx.chat.id);

  const amountText = formatAmount(recurring.amount);
  const emojiTag = recurring.emoji ? `${recurring.emoji} ` : "";
  const urgentTag = urgent ? "\u{1F6A8} " : "";

  const message = urgent
    ? `Conta fixa anotada: ${urgentTag}${emojiTag}${recurring.label}.\n` +
      `Vence todo dia ${recurring.due_day}.\n` +
      `Valor ${amountText}.\n\n` +
      `Urgente pra mim significa: "paga logo antes que o banco me roube 2 reais e 15 centavos de juros".`
    : `Conta fixa anotada: ${emojiTag}${recurring.label}.\n` +
      `Vence todo dia ${recurring.due_day}.\n` +
      `Valor ${amountText}.\n\n` +
      `Pode se preparar que ela vai voltar mes que vem, e ela nao aceita vale-refeicao.`;

  await ctx.reply(message);
}
