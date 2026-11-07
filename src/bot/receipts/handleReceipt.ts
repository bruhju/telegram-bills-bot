import path from "node:path";
import { InlineKeyboard } from "grammy";
import type { BotContext } from "../index";
import { config } from "../../config";
import { monthRefOf, todayStr } from "../../utils/date";
import {
  insertReceipt,
  linkReceiptToBill,
  listPendingBills,
  markBillPaid,
} from "../../db/repository";
import { saveReceipt } from "../../services/fileStorage";
import { formatAmount, formatDueDateShortPt, formatShortMonthRef } from "../../utils/billFormat";
import { parseAmountInput } from "../../utils/nlp";
import { escapeHtml, stripAccents } from "../../utils/text";
import { findBestMatch } from "./match";

const MAX_RECEIPT_BYTES = 15 * 1024 * 1024; // 15 MB

const GENERIC_FILENAMES = new Set([
  "comprovante",
  "recibo",
  "pagamento",
  "pix",
  "boleto",
  "document",
  "documento",
  "image",
  "imagem",
  "foto",
  "photo",
  "scan",
  "arquivo",
  "file",
  "whatsapp",
  "telegram",
]);

function extractFileNameHint(fileName?: string): string | null {
  if (!fileName) return null;
  const base = fileName.replace(/\.[^.]+$/, "");
  const tokens = stripAccents(base)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !GENERIC_FILENAMES.has(t));
  if (tokens.length === 0) return null;
  return tokens.join(" ");
}

function extractAmountFromText(text?: string | null): number | null {
  if (!text) return null;
  const tokens = text.split(/\s+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const cleaned = tokens[i]
      .replace(/[.,!?;:]+$/, "")
      .replace(/^(?:r\$|rs)[:\-]?/i, "");
    const val = parseAmountInput(cleaned);
    // Avoid mistaking a year like 2026 for an amount if preceded by "/" or month name
    if (val !== null && val !== 2025 && val !== 2026 && val !== 2027) {
      return val;
    }
  }
  return null;
}

export async function handleReceipt(ctx: BotContext): Promise<void> {
  const caption = ctx.message?.caption?.trim() ?? "";
  const photoSizes = ctx.message?.photo;
  const document = ctx.message?.document;
  const isPhoto = Boolean(photoSizes);
  const fileType: "photo" | "document" = isPhoto ? "photo" : "document";

  const fileNameHint = !isPhoto ? extractFileNameHint(document?.file_name) : null;
  const searchHint = caption || fileNameHint || "";
  const receiptLabel = caption || document?.file_name || "comprovante";

  const telegramFileId = isPhoto ? photoSizes![photoSizes!.length - 1].file_id : document!.file_id;
  const telegramFileUniqueId = isPhoto
    ? photoSizes![photoSizes!.length - 1].file_unique_id
    : document!.file_unique_id;

  const yearMonth = monthRefOf(todayStr(config.timezone));

  const declaredSize = isPhoto
    ? photoSizes![photoSizes!.length - 1].file_size
    : document?.file_size;
  if (declaredSize && declaredSize > MAX_RECEIPT_BYTES) {
    await ctx.reply(
      "Esse arquivo é grande demais (máx. 15 MB).\nManda um print ou PDF menor, que armazenamento não dá em árvore!"
    );
    return;
  }

  // Baixa o arquivo direto da API do Telegram (getUrl() + fetch — padrão
  // Cloudflare-safe; file.download() escreveria no fs e quebraria no Worker)
  // e guarda o binário: KV em produção, filesystem no dev local.
  let storagePath: string;
  try {
    const file = await ctx.getFile();
    if (file.file_size && file.file_size > MAX_RECEIPT_BYTES) {
      await ctx.reply(
        "Esse arquivo é grande demais (máx. 15 MB).\nManda um print ou PDF menor!"
      );
      return;
    }
    const extension = path.extname(file.file_path ?? "").replace(".", "") || (isPhoto ? "jpg" : "bin");
    const response = await fetch(file.getUrl());
    if (!response.ok) {
      throw new Error(`Telegram devolveu HTTP ${response.status} ao baixar o arquivo`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_RECEIPT_BYTES) {
      await ctx.reply("Esse arquivo passou do limite de 15 MB.");
      return;
    }
    storagePath = await saveReceipt(bytes, {
      fileUniqueId: telegramFileUniqueId,
      extension,
      yearMonth,
      label: receiptLabel,
    });
  } catch (error) {
    console.error("Erro ao salvar comprovante:", error);
    await ctx.reply(
      "Deu ruim ao guardar o comprovante agora.\nNão marquei nenhuma conta como paga, viu?\nManda o arquivo de novo que eu tento de novo."
    );
    return;
  }

  const pendingBills = await listPendingBills();
  const candidates = searchHint ? findBestMatch(searchHint, pendingBills) : [];

  if (candidates.length === 1) {
    const bill = candidates[0];
    const receiptId = await insertReceipt({
      billId: bill.id,
      label: receiptLabel,
      telegramFileId,
      telegramFileUniqueId,
      fileType,
      localPath: storagePath,
      matched: true,
    });
    await linkReceiptToBill(receiptId, bill.id);

    const captionAmount = extractAmountFromText(caption);
    const updatedBill = (await markBillPaid(
      bill.id,
      bill.amount === null && captionAmount !== null ? captionAmount : undefined
    ))!;

    const kb = new InlineKeyboard().text("↩️ Desfazer", `reopen:${updatedBill.id}`);
    if (updatedBill.amount === null) {
      kb.text("💲 Informar valor pago", `askamount:${updatedBill.id}:${updatedBill.month_ref}`);
    }
    kb.row().text(
      `📋 Ver contas (${formatShortMonthRef(updatedBill.month_ref)})`,
      `month:${updatedBill.month_ref}`
    );

    await ctx.reply(
      `📎 Comprovante guardado e conta <b>${escapeHtml(updatedBill.label)}</b> (${formatAmount(updatedBill.amount)}) marcada como paga!\n\n` +
        `Eu vi aqui... e pelo jeito não sobrou nem 5 centavos de troco, né?`,
      { parse_mode: "HTML", reply_markup: kb }
    );
    return;
  }

  const receiptId = await insertReceipt({
    billId: null,
    label: receiptLabel,
    telegramFileId,
    telegramFileUniqueId,
    fileType,
    localPath: storagePath,
    matched: false,
  });

  if (pendingBills.length === 0) {
    await ctx.reply(
      "📎 Comprovante guardado! Mas ó: todas as contas cadastradas já estão pagas 🎉\n" +
        "Se era de uma conta nova, adiciona com /addconta."
    );
    return;
  }

  const billsToShow = (candidates.length > 1 ? candidates : pendingBills).slice(0, 20);
  const keyboard = new InlineKeyboard();
  if (billsToShow.length <= 5) {
    for (const bill of billsToShow) {
      const emoji = bill.emoji ? `${bill.emoji} ` : "";
      keyboard
        .text(
          `✅ ${emoji}${bill.label} (${formatDueDateShortPt(bill.due_date)})`,
          `matchreceipt:${receiptId}:${bill.id}`
        )
        .row();
    }
  } else {
    for (let i = 0; i < billsToShow.length; i += 2) {
      const b1 = billsToShow[i];
      const e1 = b1.emoji ? `${b1.emoji} ` : "";
      keyboard.text(`✅ ${e1}${b1.label}`, `matchreceipt:${receiptId}:${b1.id}`);
      const b2 = billsToShow[i + 1];
      if (b2) {
        const e2 = b2.emoji ? `${b2.emoji} ` : "";
        keyboard.text(`✅ ${e2}${b2.label}`, `matchreceipt:${receiptId}:${b2.id}`);
      }
      keyboard.row();
    }
  }

  const promptText = !caption
    ? "📎 Guardado! Você mandou sem legenda — de qual conta é esse comprovante?\n" +
      "Escolhe logo, meu tempo é dinheiro e eu tô perdendo 3 centavos por minuto esperando:"
    : candidates.length === 0
      ? `📎 Guardado! Não achei nenhuma conta com o nome "<b>${escapeHtml(caption)}</b>".\nQual dessas contas pendentes você pagou? 👇`
      : "📎 Recebi o comprovante! Achei mais de uma conta parecida — qual dessas é? 👇";

  await ctx.reply(promptText, { parse_mode: "HTML", reply_markup: keyboard });
}
