import { InlineKeyboard } from "grammy";
import type { BotContext } from "./index";
import {
  deleteBill,
  deleteRecurringBill,
  getBillById,
  getRecurringBillById,
  linkReceiptToBill,
  markBillPaid,
  syncPendingBillsFromRecurring,
  updateBill,
  updateRecurringBill,
} from "../db/repository";
import { formatAmount, formatShortMonthRef } from "../utils/billFormat";
import { escapeHtml } from "../utils/text";
import { markBillPaidAndReply } from "./commands/markPaid";
import { reopenBillAndReply } from "./commands/reopenBill";
import {
  listBillsCommand,
  renderManageBillsView,
  renderMonthBillsView,
  renderSingleBillEditView,
} from "./commands/listBills";
import {
  listFixedBillsCommand,
  renderFixedBillsView,
  renderManageFixedBillsView,
  renderSingleFixedBillEditView,
} from "./commands/listFixedBills";
import { listReceiptsCommand, sendReceiptFile } from "./commands/receipts";
import { startCommand, helpCommand } from "./commands/start";
import {
  startAddContaWizard,
  startAddFixaWizard,
  startEditBillDueDateFlow,
  startEditFixaAmountFlow,
  startEditFixaDayFlow,
  startSetBillAmountFlow,
  handleWizardCallback,
} from "./wizard";

export async function handleCallbackQuery(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const [action, ...rest] = data.split(":");

  // Central menu/inline-action routing: "cmd:/contas" style.
  if (action === "cmd") {
    const cmd = rest.join(":");
    await ctx.answerCallbackQuery();
    if (cmd === "/contas") {
      await listBillsCommand(ctx);
    } else if (cmd === "/fixas") {
      await listFixedBillsCommand(ctx);
    } else if (cmd === "/addconta") {
      await startAddContaWizard(ctx);
    } else if (cmd === "/addfixa") {
      await startAddFixaWizard(ctx);
    } else if (cmd === "/comprovantes") {
      await listReceiptsCommand(ctx);
    } else if (cmd === "/ajuda") {
      await helpCommand(ctx);
    } else if (cmd === "/start") {
      await startCommand(ctx);
    }
    return;
  }

  // Wizard inline actions
  if (action === "wiz") {
    await ctx.answerCallbackQuery();
    await handleWizardCallback(ctx, rest[0] ?? "");
    return;
  }

  // Month navigation and views
  if (action === "month") {
    const monthRef = rest[0];
    await ctx.answerCallbackQuery();
    await renderMonthBillsView(ctx, monthRef, true);
    return;
  }

  if (action === "managebills") {
    const monthRef = rest[0];
    await ctx.answerCallbackQuery();
    await renderManageBillsView(ctx, monthRef, true);
    return;
  }

  if (action === "editbill") {
    const billId = Number(rest[0]);
    const monthRef = rest[1];
    await ctx.answerCallbackQuery();
    await renderSingleBillEditView(ctx, billId, monthRef, true);
    return;
  }

  if (action === "askamount") {
    const billId = Number(rest[0]);
    const monthRef = rest[1];
    await ctx.answerCallbackQuery();
    await startSetBillAmountFlow(ctx, billId, monthRef);
    return;
  }

  if (action === "askduedate") {
    const billId = Number(rest[0]);
    const monthRef = rest[1];
    await ctx.answerCallbackQuery();
    await startEditBillDueDateFlow(ctx, billId, monthRef);
    return;
  }

  if (action === "togglebillurgent") {
    const billId = Number(rest[0]);
    const monthRef = rest[1];
    const bill = await getBillById(billId);
    if (!bill) {
      await ctx.answerCallbackQuery({ text: "Conta não encontrada." });
      return;
    }
    await updateBill(billId, { urgent: bill.urgent !== 1 });
    await ctx.answerCallbackQuery({
      text: bill.urgent === 1 ? "🔕 Urgência removida" : "🚨 Marcada como urgente!",
    });
    await renderSingleBillEditView(ctx, billId, monthRef, true);
    return;
  }

  if (action === "delbill") {
    const billId = Number(rest[0]);
    const monthRef = rest[1];
    const bill = await getBillById(billId);
    await deleteBill(billId);
    await ctx.answerCallbackQuery({
      text: bill ? `🗑️ ${bill.label} excluída!` : "🗑️ Conta excluída!",
    });
    if (monthRef) {
      await renderMonthBillsView(ctx, monthRef, true);
    }
    return;
  }

  // Fixed bills management
  if (action === "viewfixas") {
    await ctx.answerCallbackQuery();
    await renderFixedBillsView(ctx, true);
    return;
  }

  if (action === "managefixas") {
    await ctx.answerCallbackQuery();
    await renderManageFixedBillsView(ctx, true);
    return;
  }

  if (action === "editfixa") {
    const recId = Number(rest[0]);
    await ctx.answerCallbackQuery();
    await renderSingleFixedBillEditView(ctx, recId, true);
    return;
  }

  if (action === "askfixaamount") {
    const recId = Number(rest[0]);
    await ctx.answerCallbackQuery();
    await startEditFixaAmountFlow(ctx, recId);
    return;
  }

  if (action === "askfixaday") {
    const recId = Number(rest[0]);
    await ctx.answerCallbackQuery();
    await startEditFixaDayFlow(ctx, recId);
    return;
  }

  if (action === "togglefixaurgent") {
    const recId = Number(rest[0]);
    const rec = await getRecurringBillById(recId);
    if (!rec) {
      await ctx.answerCallbackQuery({ text: "Conta fixa não encontrada." });
      return;
    }
    const updated = await updateRecurringBill(recId, { urgent: rec.urgent !== 1 });
    if (updated) await syncPendingBillsFromRecurring(updated);
    await ctx.answerCallbackQuery({
      text: rec.urgent === 1 ? "🔕 Urgência removida" : "🚨 Marcada como urgente!",
    });
    await renderSingleFixedBillEditView(ctx, recId, true);
    return;
  }

  if (action === "delfixa") {
    const recId = Number(rest[0]);
    const rec = await getRecurringBillById(recId);
    await deleteRecurringBill(recId, false);
    await ctx.answerCallbackQuery({
      text: rec ? `🗑️ Fixa "${rec.label}" excluída!` : "🗑️ Conta fixa excluída!",
    });
    await renderFixedBillsView(ctx, true);
    return;
  }

  // Receipts
  if (action === "sendreceipt") {
    const receiptId = Number(rest[0]);
    await ctx.answerCallbackQuery({ text: "📎 Baixando comprovante..." });
    await sendReceiptFile(ctx, receiptId);
    return;
  }

  if (action === "paid") {
    const billId = Number(rest[0]);
    const monthRef = rest[1];
    await ctx.answerCallbackQuery({ text: "✅ Conta marcada como paga!" });

    if (monthRef) {
      const existing = await getBillById(billId);
      if (!existing) {
        await ctx.reply("Essa conta não existe mais.");
        return;
      }
      const bill = (await markBillPaid(billId))!;
      await renderMonthBillsView(ctx, monthRef, true);

      const emoji = bill.emoji ? `${bill.emoji} ` : "";
      const kb = new InlineKeyboard().text("↩️ Desfazer", `reopen:${bill.id}:${monthRef}`);
      await ctx.reply(
        `✅ <b>${emoji}${escapeHtml(bill.label)}</b> paga!`,
        { parse_mode: "HTML", reply_markup: kb }
      );
      return;
    }

    // Clicked from a reminder or /pago list: update button in-place if possible
    try {
      const doneKb = new InlineKeyboard().text("✅ Pago! (toque p/ desfazer)", `reopen:${billId}`);
      await ctx.editMessageReplyMarkup({ reply_markup: doneKb });
    } catch {
      // Ignore if message cannot be edited
    }
    await markBillPaidAndReply(ctx, billId);
    return;
  }

  if (action === "reopen") {
    const billId = Number(rest[0]);
    const monthRef = rest[1];
    await ctx.answerCallbackQuery({ text: "↩️ Conta reaberta!" });
    await reopenBillAndReply(ctx, billId);
    if (monthRef) {
      await renderMonthBillsView(ctx, monthRef, false);
    }
    return;
  }

  if (action === "matchreceipt") {
    const [receiptIdRaw, billIdRaw] = rest;
    const receiptId = Number(receiptIdRaw);
    const billId = Number(billIdRaw);

    const bill = await getBillById(billId);
    if (!bill) {
      await ctx.answerCallbackQuery({ text: "Essa conta não existe (mais)." });
      return;
    }

    await linkReceiptToBill(receiptId, billId);
    const updated = (await markBillPaid(billId))!;
    await ctx.answerCallbackQuery({ text: "✅ Comprovante vinculado!" });

    const kb = new InlineKeyboard().text("↩️ Desfazer", `reopen:${updated.id}`);
    if (updated.amount === null) {
      kb.text("💲 Informar valor pago", `askamount:${updated.id}:${updated.month_ref}`);
    }
    kb.row().text(
      `📋 Ver contas (${formatShortMonthRef(updated.month_ref)})`,
      `month:${updated.month_ref}`
    );

    try {
      await ctx.editMessageText(
        `📎 Comprovante vinculado! Conta <b>${escapeHtml(updated.label)}</b> (${formatAmount(updated.amount)}) marcada como paga.\n\n` +
          `Eu vi aqui... e pelo jeito não sobrou nem 5 centavos de troco, né?`,
        { parse_mode: "HTML", reply_markup: kb }
      );
    } catch {
      await ctx.reply(
        `📎 Comprovante vinculado! Conta <b>${escapeHtml(updated.label)}</b> (${formatAmount(updated.amount)}) marcada como paga.\n\n` +
          `Eu vi aqui... e pelo jeito não sobrou nem 5 centavos de troco, né?`,
        { parse_mode: "HTML", reply_markup: kb }
      );
    }
    return;
  }

  await ctx.answerCallbackQuery();
}
