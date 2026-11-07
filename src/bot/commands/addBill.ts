import type { BotContext } from "../index";
import { config } from "../../config";
import { insertBill } from "../../db/repository";
import { monthRefOf, todayStr } from "../../utils/date";
import { parseUrgentLabel } from "../../utils/text";
import { formatAmount, formatDueDate } from "../../utils/billFormat";
import { startAddContaWizard } from "../wizard";
import { clearFlow } from "../state";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function addBillCommand(ctx: BotContext): Promise<void> {
  const text = ctx.match?.toString().trim() ?? "";
  if (!text) {
    await startAddContaWizard(ctx);
    return;
  }

  const [rawLabel, dueDateRaw, emojiRaw, amountRaw] = text.split("|").map((part) => part.trim());

  if (!rawLabel) {
    await ctx.reply(
      "Conta sem nome?\nQuem e que vai pagar isso, o perigo?\nConta nao e fantasma, e a de luz nao vem no nome do Gasparzinho."
    );
    return;
  }

  const { label, urgent } = parseUrgentLabel(rawLabel);

  let dueDate: string | null = null;
  if (dueDateRaw && dueDateRaw !== "-") {
    if (!DATE_RE.test(dueDateRaw)) {
      await ctx.reply(
        "Essa data nao existe.\nNem naquele calendario de 1987 que eu comprei por 12 centavos na liquidacao e uso ate hoje."
      );
      return;
    }
    dueDate = dueDateRaw;
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

  const monthRef = dueDate ? monthRefOf(dueDate) : monthRefOf(todayStr(config.timezone));
  const bill = await insertBill({ label, amount, dueDate, monthRef, emoji, urgent });
  if (ctx.chat) clearFlow(ctx.chat.id);

  const due = formatDueDate(bill.due_date);
  const amountText = formatAmount(bill.amount);
  const emojiTag = bill.emoji ? `${bill.emoji} ` : "";
  const urgentTag = urgent ? "\u{1F6A8} " : "";

  const message = urgent
    ? `Conta anotada: ${urgentTag}${emojiTag}${bill.label}.\n` +
      `Vencimento ${due}.\n` +
      `Valor ${amountText}.\n\n` +
      `Urgente pra mim significa: "paga logo antes que o banco me roube 2 reais e 15 centavos de juros".`
    : `Conta anotada: ${emojiTag}${bill.label}.\n` +
      `Vencimento ${due}.\n` +
      `Valor ${amountText}.\n\n` +
      `Anotei aqui. E eu nunca esqueco, eu sei exatamente por onde andou cada centavo meu nos ultimos 15 anos.`;

  await ctx.reply(message);
}
