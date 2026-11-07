import { InlineKeyboard } from "grammy";
import type { BotContext } from "./index";
import { config } from "../config";
import {
  getBillById,
  getRecurringBillById,
  insertBill,
  insertRecurringBill,
  syncPendingBillsFromRecurring,
  updateBill,
  updateBillAmount,
  updateRecurringBill,
} from "../db/repository";
import { materializeRecurringBills } from "../scheduler/dailyJob";
import { addDaysStr, monthRefOf, todayStr } from "../utils/date";
import {
  dueDateFromDay,
  parseAmountInput,
  parseFlexibleDate,
  type ParsedBillMention,
} from "../utils/nlp";
import { escapeHtml, parseUrgentLabel, stripAccents } from "../utils/text";
import { formatAmount, formatDueDatePt, formatShortMonthRef } from "../utils/billFormat";
import { clearFlow, getFlow, hydrateFlow, setFlow, updateFlow, type Flow } from "./state";

const CONFIRM_WORDS = new Set(["sim", "s", "ok", "confirmar", "isso", "pode", "bora", "manda", "cria"]);
const CANCEL_WORDS = new Set(["nao", "n", "cancelar", "cancela", "para", "pare", "esquece"]);
const SKIP_WORDS = new Set(["-", "pular", "skip", "nao", "n"]);

function buildConfirmKeyboard(flow: Flow): InlineKeyboard {
  const isFixed = flow.kind === "addfixa";
  const isUrgent = Boolean(flow.data.urgent);

  return new InlineKeyboard()
    .text(isFixed ? "🔁 Tipo: Fixa (mensal)" : "📌 Tipo: Só este mês", "wiz:togglekind")
    .text(isUrgent ? "🚨 Urgente: SIM" : "🔔 Urgente: Não", "wiz:toggleurgent")
    .row()
    .text("✅ Confirmar", "wiz:confirm")
    .text("✏️ Refazer", "wiz:edit")
    .text("🗑️ Cancelar", "wiz:cancel");
}

function skipKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("⏭️ Pular (deixar sem)", "wiz:skip");
}

function amountPrompt(): string {
  return (
    "💰 E o valor?\n\n" +
    "Ex: <b>1200</b>, <b>1.200,50</b> ou <b>R$ 1200</b>.\n" +
    "Manda <b>-</b> (ou toca em Pular) se o valor varia todo mês."
  );
}

function dueDatePrompt(exampleIso: string): string {
  return (
    "🗓️ Quando vence?\n\n" +
    "Pode ser <b>hoje</b>, <b>amanhã</b>, <b>dia 10</b>, <b>dd/mm</b> ou <b>" +
    exampleIso +
    "</b>."
  );
}

function summaryBody(flow: Flow): string {
  const d = flow.data;
  const emojiTag = d.emoji ? `${d.emoji} ` : "";
  const urgentTag = d.urgent ? "\n🚨 <b>Urgente</b> (cobra de manhã e à noite)" : "";
  const amountText =
    d.amount === undefined || d.amount === null ? "<i>a definir (variável)</i>" : formatAmount(d.amount);
  const name = escapeHtml(d.label ?? "");
  if (flow.kind === "addfixa") {
    return (
      `${emojiTag}<b>${name}</b>\n` +
      `🔁 Recorrência: <b>Conta fixa (todo dia ${d.dueDay ?? "?"})</b>\n` +
      `💰 Valor: <b>${amountText}</b>${urgentTag}`
    );
  }
  return (
    `${emojiTag}<b>${name}</b>\n` +
    `📌 Tipo: <b>Avulsa (só este mês)</b>\n` +
    `🗓️ Vence: <b>${formatDueDatePt(d.dueDate ?? null)}</b>\n` +
    `💰 Valor: <b>${amountText}</b>${urgentTag}`
  );
}

async function showConfirm(ctx: BotContext, flow: Flow): Promise<void> {
  const prefix = flow.src === "nl" ? "Entendi assim 👇" : "Confere aí 👇";
  await ctx.reply(
    `${prefix}\n\n${summaryBody(flow)}\n\n<i>💡 Toque nos botões abaixo se quiser mudar para Fixa ou Urgente antes de salvar:</i>`,
    {
      parse_mode: "HTML",
      reply_markup: buildConfirmKeyboard(flow),
    }
  );
}

export async function startAddContaWizard(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  setFlow(chatId, { kind: "addconta", step: "label", src: "wizard", data: {} });
  await ctx.reply("Bora criar a conta 📝\n\nQual o nome dela? (ex: Luz, Internet, Aluguel)");
}

export async function startAddFixaWizard(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  setFlow(chatId, { kind: "addfixa", step: "label", src: "wizard", data: {} });
  await ctx.reply("Bora criar a conta fixa 📝\n\nQual o nome dela? (ex: Aluguel, Condomínio, Cartão)");
}

export async function startSetBillAmountFlow(
  ctx: BotContext,
  billId: number,
  monthRef?: string
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  const bill = await getBillById(billId);
  if (!bill) {
    await ctx.reply("Essa conta não existe mais.");
    return;
  }
  setFlow(chatId, {
    kind: "setamount",
    step: "amount",
    src: "wizard",
    data: { billId: bill.id, label: bill.label, monthRef: monthRef ?? bill.month_ref },
  });
  await ctx.reply(
    `💲 Qual o valor de <b>${escapeHtml(bill.label)}</b>?\n\n` +
      `Manda o número (ex: <b>185,90</b> ou <b>1200</b>), ou <b>/cancelar</b>.`,
    { parse_mode: "HTML" }
  );
}

export async function startEditBillDueDateFlow(
  ctx: BotContext,
  billId: number,
  monthRef?: string
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  const bill = await getBillById(billId);
  if (!bill) {
    await ctx.reply("Essa conta não existe mais.");
    return;
  }
  setFlow(chatId, {
    kind: "editbill",
    step: "dueDate",
    src: "wizard",
    data: { billId: bill.id, label: bill.label, monthRef: monthRef ?? bill.month_ref },
  });
  await ctx.reply(
    `🗓️ Qual a nova data de vencimento para <b>${escapeHtml(bill.label)}</b>?\n\n` +
      `Pode mandar <b>dia 15</b>, <b>15/11</b>, <b>amanhã</b> ou <b>YYYY-MM-DD</b>:`,
    { parse_mode: "HTML" }
  );
}

export async function startEditFixaAmountFlow(
  ctx: BotContext,
  recurringId: number
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  const rec = await getRecurringBillById(recurringId);
  if (!rec) {
    await ctx.reply("Essa conta fixa não existe mais.");
    return;
  }
  setFlow(chatId, {
    kind: "editfixa",
    step: "amount",
    src: "wizard",
    data: { recurringBillId: rec.id, label: rec.label },
  });
  await ctx.reply(
    `💲 Qual o novo valor mensal de <b>${escapeHtml(rec.label)}</b>?\n\n` +
      `Manda o valor (ex: <b>1500</b> ou <b>189,90</b>) ou <b>-</b> para deixar variável:`,
    { parse_mode: "HTML" }
  );
}

export async function startEditFixaDayFlow(
  ctx: BotContext,
  recurringId: number
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  const rec = await getRecurringBillById(recurringId);
  if (!rec) {
    await ctx.reply("Essa conta fixa não existe mais.");
    return;
  }
  setFlow(chatId, {
    kind: "editfixa",
    step: "dueDay",
    src: "wizard",
    data: { recurringBillId: rec.id, label: rec.label },
  });
  await ctx.reply(
    `📅 Qual o novo dia de vencimento (1 a 31) para <b>${escapeHtml(rec.label)}</b>?`,
    { parse_mode: "HTML" }
  );
}

/** Confirm step shared by the NL parse flow. */
export async function startNlConfirm(ctx: BotContext, parsed: ParsedBillMention): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  const today = todayStr(config.timezone);
  const dueDay =
    parsed.dueDay ??
    (parsed.dueDate ? Number(parsed.dueDate.slice(8, 10)) : Number(today.slice(8, 10)));

  const flow = setFlow(chatId, {
    kind: parsed.recurring ? "addfixa" : "addconta",
    step: "confirm",
    src: "nl",
    data: {
      label: parsed.label,
      urgent: parsed.urgent,
      amount: parsed.amount,
      dueDate: parsed.dueDate ?? undefined,
      dueDay,
      emoji: null,
    },
  });
  await showConfirm(ctx, flow);
}

export async function cancelCommand(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  await hydrateFlow(chatId);
  const had = getFlow(chatId);
  clearFlow(chatId);
  if (!had) {
    await ctx.reply("Não tem nada rolando pra cancelar 😄");
    return;
  }
  await ctx.reply("Tranquilo, cancelei 🗑️ Nada foi salvo.");
}

/** Text input for an active flow. Always consumes the message. */
export async function handleWizardText(ctx: BotContext, flow: Flow): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  const text = ctx.message?.text?.trim() ?? "";
  const normalized = stripAccents(text).toLowerCase();

  // Quick sub-flows: setamount / editbill / editfixa
  if (flow.kind === "setamount" && flow.step === "amount") {
    if (CANCEL_WORDS.has(normalized)) {
      clearFlow(chatId);
      await ctx.reply("Cancelado 👍");
      return;
    }
    const amount = SKIP_WORDS.has(normalized) ? null : parseAmountInput(text);
    if (!SKIP_WORDS.has(normalized) && amount === null) {
      await ctx.reply("Valor inválido 😅 — manda algo como <b>185,90</b> ou <b>1200</b>.", {
        parse_mode: "HTML",
      });
      return;
    }
    const updated = flow.data.billId ? await updateBillAmount(flow.data.billId, amount) : undefined;
    clearFlow(chatId);
    if (!updated) {
      await ctx.reply("Não achei mais essa conta.");
      return;
    }
    const kb = new InlineKeyboard().text(
      `📋 Ver contas (${formatShortMonthRef(updated.month_ref)})`,
      `month:${updated.month_ref}`
    );
    if (updated.status === "pending") {
      kb.text(`✅ Marcar como paga`, `paid:${updated.id}:${updated.month_ref}`);
    }
    await ctx.reply(
      `💲 Valor de <b>${escapeHtml(updated.label)}</b> atualizado para <b>${formatAmount(updated.amount)}</b>!`,
      { parse_mode: "HTML", reply_markup: kb }
    );
    return;
  }

  if (flow.kind === "editbill" && flow.step === "dueDate") {
    if (CANCEL_WORDS.has(normalized)) {
      clearFlow(chatId);
      await ctx.reply("Cancelado 👍");
      return;
    }
    const today = todayStr(config.timezone);
    const dueDate = parseFlexibleDate(text, today);
    if (!dueDate) {
      await ctx.reply("Data inválida 😅 — tenta <b>dia 10</b>, <b>10/11</b> ou <b>YYYY-MM-DD</b>.", {
        parse_mode: "HTML",
      });
      return;
    }
    const monthRef = monthRefOf(dueDate);
    const updated = flow.data.billId
      ? await updateBill(flow.data.billId, { dueDate, monthRef })
      : undefined;
    clearFlow(chatId);
    if (!updated) {
      await ctx.reply("Não achei mais essa conta.");
      return;
    }
    const kb = new InlineKeyboard().text(
      `📋 Ver contas (${formatShortMonthRef(updated.month_ref)})`,
      `month:${updated.month_ref}`
    );
    await ctx.reply(
      `🗓️ Vencimento de <b>${escapeHtml(updated.label)}</b> atualizado para <b>${formatDueDatePt(updated.due_date)}</b>!`,
      { parse_mode: "HTML", reply_markup: kb }
    );
    return;
  }

  if (flow.kind === "editfixa") {
    if (CANCEL_WORDS.has(normalized)) {
      clearFlow(chatId);
      await ctx.reply("Cancelado 👍");
      return;
    }
    const recId = flow.data.recurringBillId;
    if (!recId) {
      clearFlow(chatId);
      return;
    }
    if (flow.step === "amount") {
      const amount = SKIP_WORDS.has(normalized) ? null : parseAmountInput(text);
      if (!SKIP_WORDS.has(normalized) && amount === null) {
        await ctx.reply("Valor inválido 😅 — manda algo como <b>1500</b> ou <b>-</b> se variar.", {
          parse_mode: "HTML",
        });
        return;
      }
      const updated = await updateRecurringBill(recId, { amount });
      clearFlow(chatId);
      if (updated) {
        await syncPendingBillsFromRecurring(updated);
        const kb = new InlineKeyboard().text("🔁 Ver contas fixas", "cmd:/fixas");
        await ctx.reply(
          `✅ Valor da conta fixa <b>${escapeHtml(updated.label)}</b> atualizado para <b>${formatAmount(updated.amount)}</b> (contas pendentes já sincronizadas)!`,
          { parse_mode: "HTML", reply_markup: kb }
        );
      }
      return;
    }
    if (flow.step === "dueDay") {
      const day = Number(text);
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        await ctx.reply("Dia inválido 😅 — manda um número de 1 a 31.");
        return;
      }
      const updated = await updateRecurringBill(recId, { dueDay: day });
      clearFlow(chatId);
      if (updated) {
        await syncPendingBillsFromRecurring(updated);
        const kb = new InlineKeyboard().text("🔁 Ver contas fixas", "cmd:/fixas");
        await ctx.reply(
          `✅ Dia de vencimento de <b>${escapeHtml(updated.label)}</b> atualizado para <b>todo dia ${updated.due_day}</b>!`,
          { parse_mode: "HTML", reply_markup: kb }
        );
      }
      return;
    }
  }

  if (flow.step === "confirm") {
    if (CONFIRM_WORDS.has(normalized)) {
      await confirmAndCreate(ctx, flow);
      return;
    }
    if (CANCEL_WORDS.has(normalized)) {
      clearFlow(chatId);
      await ctx.reply("Tranquilo, cancelei 🗑️ Nada foi salvo.");
      return;
    }
    await ctx.reply("Confirma aí nos botões 👆 (ou manda <b>sim</b> / <b>cancelar</b>)", {
      parse_mode: "HTML",
      reply_markup: buildConfirmKeyboard(flow),
    });
    return;
  }

  if (flow.step === "label") {
    if (!text) {
      await ctx.reply("Conta sem nome não existe 😅 Me fala o nome dela.");
      return;
    }
    const { label, urgent } = parseUrgentLabel(text);
    if (!label) {
      await ctx.reply("Conta sem nome não existe 😅 Me fala o nome dela.");
      return;
    }
    if (label.length > 60) {
      await ctx.reply("Nome gigante 😅 Encurta aí (até 60 caracteres).");
      return;
    }
    const nextStep = flow.kind === "addconta" ? "dueDate" : "dueDay";
    updateFlow(chatId, { data: { ...flow.data, label, urgent }, step: nextStep });
    if (flow.kind === "addconta") {
      const exampleIso = addDaysStr(todayStr(config.timezone), 14);
      await ctx.reply(dueDatePrompt(exampleIso), { parse_mode: "HTML" });
    } else {
      await ctx.reply("📅 Que dia do mês vence? (1 a 31)");
    }
    return;
  }

  if (flow.step === "dueDate") {
    const dueDate = parseFlexibleDate(text, todayStr(config.timezone));
    if (!dueDate) {
      const exampleIso = addDaysStr(todayStr(config.timezone), 14);
      await ctx.reply(
        `Data estranha 😅 — tenta <b>hoje</b>, <b>amanhã</b>, <b>dia 10</b>, <b>dd/mm</b> ou <b>${exampleIso}</b>.`,
        { parse_mode: "HTML" }
      );
      return;
    }
    const dueDay = Number(dueDate.slice(8, 10));
    updateFlow(chatId, { data: { ...flow.data, dueDate, dueDay }, step: "amount" });
    await ctx.reply(amountPrompt(), { parse_mode: "HTML", reply_markup: skipKeyboard() });
    return;
  }

  if (flow.step === "dueDay") {
    const day = Number(text);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      await ctx.reply("Dia inválido 😅 — manda um número de 1 a 31.");
      return;
    }
    updateFlow(chatId, { data: { ...flow.data, dueDay: day }, step: "amount" });
    await ctx.reply(amountPrompt(), { parse_mode: "HTML", reply_markup: skipKeyboard() });
    return;
  }

  if (flow.step === "amount") {
    let amount: number | null = null;
    if (!SKIP_WORDS.has(normalized)) {
      amount = parseAmountInput(text);
      if (amount === null) {
        await ctx.reply("Valor estranho 😅 — ex: <b>1200</b>, <b>1.200,50</b> ou <b>R$ 1200</b>.", {
          parse_mode: "HTML",
          reply_markup: skipKeyboard(),
        });
        return;
      }
    }
    updateFlow(chatId, { data: { ...flow.data, amount }, step: "emoji" });
    await ctx.reply("😎 Um emoji pra ela? (ex: ⚡, 🏠, 🌐)", { reply_markup: skipKeyboard() });
    return;
  }

  if (flow.step === "emoji") {
    let emoji: string | null = null;
    if (!SKIP_WORDS.has(normalized)) {
      if (Array.from(text).length > 12) {
        await ctx.reply("Só um emoji ou dois 😅 (ou toca em Pular).", {
          reply_markup: skipKeyboard(),
        });
        return;
      }
      emoji = text;
    }
    const updated = updateFlow(chatId, { data: { ...flow.data, emoji }, step: "confirm" });
    if (updated) await showConfirm(ctx, updated);
    return;
  }
}

/** Inline-button actions for the wizard: confirm / cancel / skip / edit / togglekind / toggleurgent. */
export async function handleWizardCallback(ctx: BotContext, sub: string): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  await hydrateFlow(chatId);
  const flow = getFlow(chatId);

  if (sub === "cancel") {
    clearFlow(chatId);
    await ctx.reply(flow ? "Tranquilo, cancelei 🗑️ Nada foi salvo." : "Essa conversa já tinha acabado 😄");
    return;
  }

  if (sub === "skip") {
    if (!flow || (flow.step !== "emoji" && flow.step !== "amount")) {
      await ctx.reply("Essa opção já não vale mais 😄 — manda /addconta pra começar de novo.");
      return;
    }
    if (flow.step === "amount") {
      updateFlow(chatId, { data: { ...flow.data, amount: null }, step: "emoji" });
      await ctx.reply("😎 Um emoji pra ela? (ex: ⚡, 🏠, 🌐)", { reply_markup: skipKeyboard() });
      return;
    }
    const updated = updateFlow(chatId, { data: { ...flow.data, emoji: null }, step: "confirm" });
    if (updated) await showConfirm(ctx, updated);
    return;
  }

  if (sub === "togglekind") {
    if (!flow || flow.step !== "confirm") {
      await ctx.reply("Essa confirmação já expirou 😅 — manda /addconta pra começar de novo.");
      return;
    }
    const today = todayStr(config.timezone);
    const nextKind = flow.kind === "addconta" ? "addfixa" : "addconta";
    const dueDay =
      flow.data.dueDay ??
      (flow.data.dueDate ? Number(flow.data.dueDate.slice(8, 10)) : Number(today.slice(8, 10)));
    const dueDate = flow.data.dueDate ?? dueDateFromDay(dueDay, today);

    const updated = updateFlow(chatId, {
      kind: nextKind,
      data: { ...flow.data, dueDay, dueDate },
    });
    if (updated) {
      const prefix = updated.src === "nl" ? "Entendi assim 👇" : "Confere aí 👇";
      try {
        await ctx.editMessageText(
          `${prefix}\n\n${summaryBody(updated)}\n\n<i>💡 Toque nos botões abaixo se quiser mudar para Fixa ou Urgente antes de salvar:</i>`,
          { parse_mode: "HTML", reply_markup: buildConfirmKeyboard(updated) }
        );
      } catch {
        await showConfirm(ctx, updated);
      }
    }
    return;
  }

  if (sub === "toggleurgent") {
    if (!flow || flow.step !== "confirm") {
      await ctx.reply("Essa confirmação já expirou 😅 — manda /addconta pra começar de novo.");
      return;
    }
    const updated = updateFlow(chatId, {
      data: { ...flow.data, urgent: !flow.data.urgent },
    });
    if (updated) {
      const prefix = updated.src === "nl" ? "Entendi assim 👇" : "Confere aí 👇";
      try {
        await ctx.editMessageText(
          `${prefix}\n\n${summaryBody(updated)}\n\n<i>💡 Toque nos botões abaixo se quiser mudar para Fixa ou Urgente antes de salvar:</i>`,
          { parse_mode: "HTML", reply_markup: buildConfirmKeyboard(updated) }
        );
      } catch {
        await showConfirm(ctx, updated);
      }
    }
    return;
  }

  if (sub === "confirm") {
    if (!flow || flow.step !== "confirm") {
      await ctx.reply("Essa confirmação já expirou 😅 — manda /addconta pra começar de novo.");
      return;
    }
    await confirmAndCreate(ctx, flow);
    return;
  }

  if (sub === "edit") {
    if (!flow) {
      await ctx.reply("Essa conversa já acabou 😅 — manda /addconta pra começar de novo.");
      return;
    }
    updateFlow(chatId, { data: {}, step: "label", src: "wizard" });
    await ctx.reply("Bora de novo 📝\n\nQual o nome da conta?");
    return;
  }
}

async function confirmAndCreate(ctx: BotContext, flow: Flow): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  try {
    if (flow.kind === "addconta") {
      const d = flow.data;
      const dueDate = d.dueDate ?? null;
      const monthRef = monthRefOf(dueDate ?? todayStr(config.timezone));
      const bill = await insertBill({
        label: d.label ?? "",
        amount: d.amount ?? null,
        dueDate,
        monthRef,
        emoji: d.emoji ?? null,
        urgent: d.urgent ?? false,
      });
      clearFlow(chatId);
      const urgentTag = bill.urgent === 1 ? "🚨 " : "";
      const emojiTag = bill.emoji ? `${bill.emoji} ` : "";
      const keyboard = new InlineKeyboard()
        .text(`📋 Ver contas (${formatShortMonthRef(monthRef)})`, `month:${monthRef}`)
        .text("➕ Outra conta", "cmd:/addconta");
      await ctx.reply(
        `✅ Conta criada: ${urgentTag}${emojiTag}<b>${escapeHtml(bill.label)}</b> — vence ${formatDueDatePt(bill.due_date)} — ${formatAmount(bill.amount)}`,
        { parse_mode: "HTML", reply_markup: keyboard }
      );
      return;
    }

    const d = flow.data;
    const recurring = await insertRecurringBill({
      label: d.label ?? "",
      dueDay: d.dueDay ?? 1,
      amount: d.amount ?? null,
      emoji: d.emoji ?? null,
      urgent: d.urgent ?? false,
    });
    const currentMonth = monthRefOf(todayStr(config.timezone));
    await materializeRecurringBills(currentMonth);
    clearFlow(chatId);
    const urgentTag = recurring.urgent === 1 ? "🚨 " : "";
    const emojiTag = recurring.emoji ? `${recurring.emoji} ` : "";
    const keyboard = new InlineKeyboard()
      .text("🔁 Ver contas fixas", "cmd:/fixas")
      .text("📋 Contas do mês", `month:${currentMonth}`);
    await ctx.reply(
      `✅ Conta fixa criada: ${urgentTag}${emojiTag}<b>${escapeHtml(recurring.label)}</b> — todo dia ${recurring.due_day} — ${formatAmount(recurring.amount)}`,
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  } catch (err) {
    console.error("Wizard create failed:", err);
    await ctx.reply("Deu ruim pra salvar 😅 Tenta confirmar de novo.", {
      reply_markup: buildConfirmKeyboard(flow),
    });
  }
}
