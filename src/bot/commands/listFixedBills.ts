import { InlineKeyboard } from "grammy";
import type { BotContext } from "../index";
import { getRecurringBillById, listRecurringBills } from "../../db/repository";
import { formatAmount } from "../../utils/billFormat";
import { escapeHtml } from "../../utils/text";

export async function renderFixedBillsView(
  ctx: BotContext,
  editInPlace = false
): Promise<void> {
  const recurring = await listRecurringBills();
  const kb = new InlineKeyboard();

  if (recurring.length === 0) {
    kb.text("➕ Adicionar conta fixa", "cmd:/addfixa");
    const emptyText =
      "🔁 <b>Contas fixas</b>\n\n" +
      "Nenhuma conta fixa? Isso não existe.\n" +
      "Bota uma com /addfixa ou tocando no botão abaixo.\n" +
      "Se eu acordo às 5 da manhã pros meus dois empregos, você também tem que ter boleto pra pagar.";
    if (editInPlace) {
      try {
        await ctx.editMessageText(emptyText, { parse_mode: "HTML", reply_markup: kb });
        return;
      } catch {
        // Fallback
      }
    }
    await ctx.reply(emptyText, { parse_mode: "HTML", reply_markup: kb });
    return;
  }

  const groups = new Map<number, typeof recurring>();
  for (const bill of recurring) {
    const list = groups.get(bill.due_day) ?? [];
    list.push(bill);
    groups.set(bill.due_day, list);
  }

  const blocks: string[] = [];
  for (const [day, groupBills] of groups.entries()) {
    const dayStr = String(day).padStart(2, "0");
    const items = groupBills.map((bill) => {
      const emojiTag = bill.emoji ? `${bill.emoji} ` : "";
      const amountPart = bill.amount !== null ? ` — ${formatAmount(bill.amount)}` : "";
      return `• ${emojiTag}${escapeHtml(bill.label)}${amountPart}`;
    });
    blocks.push(`⚪ <b>Dia ${dayStr}</b>\n${items.join("\n")}`);
  }

  const hasAnyAmount = recurring.some((b) => b.amount !== null);
  const knownSum = recurring.reduce((acc, b) => acc + (b.amount ?? 0), 0);
  const footer = hasAnyAmount
    ? `\n\n───────────────\n💰 <b>Total fixo:</b> ${formatAmount(knownSum)}`
    : "";

  const text = `🔁 <b>Contas fixas (${recurring.length})</b>\n\n` + `${blocks.join("\n\n")}${footer}`;

  kb.text("⚙️ Editar / Excluir", "managefixas")
    .text("➕ Nova fixa", "cmd:/addfixa")
    .row()
    .text("📋 Ver contas do mês", "cmd:/contas");

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

export async function renderManageFixedBillsView(
  ctx: BotContext,
  editInPlace = true
): Promise<void> {
  const recurring = await listRecurringBills();
  const kb = new InlineKeyboard();

  for (let i = 0; i < recurring.length; i += 2) {
    const b1 = recurring[i];
    const e1 = b1.emoji ? `${b1.emoji} ` : "";
    kb.text(`✏️ ${e1}${b1.label} (dia ${b1.due_day})`, `editfixa:${b1.id}`);
    const b2 = recurring[i + 1];
    if (b2) {
      const e2 = b2.emoji ? `${b2.emoji} ` : "";
      kb.text(`✏️ ${e2}${b2.label} (dia ${b2.due_day})`, `editfixa:${b2.id}`);
    }
    kb.row();
  }
  kb.text("⬅️ Voltar para contas fixas", "viewfixas");

  const text =
    `⚙️ <b>Gerenciar contas fixas</b>\n\n` +
    `Toque em uma conta fixa abaixo para alterar valor, mudar dia de vencimento ou excluir:`;

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

export async function renderSingleFixedBillEditView(
  ctx: BotContext,
  recurringId: number,
  editInPlace = true
): Promise<void> {
  const rec = await getRecurringBillById(recurringId);
  if (!rec) {
    await ctx.reply("Essa conta fixa não existe mais.");
    return;
  }

  const emoji = rec.emoji ? `${rec.emoji} ` : "";
  const urgentText = rec.urgent === 1 ? "Sim 🚨" : "Não";

  const text =
    `⚙️ <b>Editar conta fixa</b>\n\n` +
    `📌 Nome: ${emoji}<b>${escapeHtml(rec.label)}</b>\n` +
    `📅 Vencimento: <b>todo dia ${rec.due_day}</b>\n` +
    `💰 Valor mensal: <b>${formatAmount(rec.amount)}</b>\n` +
    `🚨 Urgente: <b>${urgentText}</b>`;

  const kb = new InlineKeyboard()
    .text("💲 Mudar valor", `askfixaamount:${rec.id}`)
    .text("📅 Mudar dia", `askfixaday:${rec.id}`)
    .row()
    .text(
      rec.urgent === 1 ? "🔕 Tirar urgência" : "🚨 Marcar urgente",
      `togglefixaurgent:${rec.id}`
    )
    .text("🗑️ Excluir fixa", `delfixa:${rec.id}`)
    .row()
    .text("⬅️ Voltar", "managefixas");

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

export async function listFixedBillsCommand(ctx: BotContext): Promise<void> {
  await renderFixedBillsView(ctx, false);
}
