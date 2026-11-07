import { Bot, Context } from "grammy";
import type { FileFlavor } from "@grammyjs/files";
import { hydrateFiles } from "@grammyjs/files";
import { config } from "../config";
import { addBillCommand } from "./commands/addBill";
import { addFixedBillCommand } from "./commands/addFixedBill";
import { debugRunCommand } from "./commands/debugRun";
import { deleteBillCommand } from "./commands/deleteBill";
import { listBillsCommand } from "./commands/listBills";
import { listFixedBillsCommand } from "./commands/listFixedBills";
import { markPaidCommand } from "./commands/markPaid";
import { monthlyListCommand } from "./commands/monthlyList";
import { listReceiptsCommand } from "./commands/receipts";
import { reopenBillCommand } from "./commands/reopenBill";
import { startCommand, helpCommand } from "./commands/start";
import { handleReceipt } from "./receipts/handleReceipt";
import { handleCallbackQuery } from "./callbacks";
import { cancelCommand } from "./wizard";
import { handleTextMessage } from "./freeText";

export type BotContext = FileFlavor<Context>;

export const bot = new Bot<BotContext>(config.botToken);

bot.api.config.use(hydrateFiles(bot.token));

bot.use(async (ctx, next) => {
  if (ctx.chat?.id !== config.chatId) return;
  await next();
});

bot.command("start", startCommand);
bot.command("ajuda", helpCommand);
bot.command("addconta", addBillCommand);
bot.command("addfixa", addFixedBillCommand);
bot.command("contas", listBillsCommand);
bot.command("fixas", listFixedBillsCommand);
bot.command("listamensal", monthlyListCommand);
bot.command("pago", markPaidCommand);
bot.command("reabrir", reopenBillCommand);
bot.command("comprovantes", listReceiptsCommand);
bot.command("apagar", deleteBillCommand);
bot.command("cancelar", cancelCommand);
bot.command("debugrun", debugRunCommand);
bot.on("message:photo", handleReceipt);
bot.on("message:document", handleReceipt);
bot.on("callback_query:data", handleCallbackQuery);
// Free text must be LAST: commands and media handlers above consume their updates first.
bot.on("message:text", handleTextMessage);

bot.catch((err) => {
  console.error("Bot error:", err.error);
});

export function setupShutdown(): void {
  process.once("SIGINT", () => void bot.stop());
  process.once("SIGTERM", () => void bot.stop());
}

export async function registerCommandList(): Promise<void> {
  await bot.api.setMyCommands([
    { command: "start", description: "Painel inicial e resumo do mes" },
    { command: "contas", description: "Lista as contas do mes atual" },
    { command: "fixas", description: "Lista e gerencia contas fixas" },
    { command: "addconta", description: "Cria uma conta passo a passo" },
    { command: "addfixa", description: "Cria uma conta fixa passo a passo" },
    { command: "pago", description: "Marca uma conta como paga" },
    { command: "comprovantes", description: "Lista e baixa comprovantes salvos" },
    { command: "reabrir", description: "Volta uma conta pra pendente" },
    { command: "apagar", description: "Exclui uma conta do mes" },
    { command: "listamensal", description: "Manda a lista mensal de pendencias" },
    { command: "cancelar", description: "Cancela a conversa em andamento" },
  ]);

  await bot.api.setMyDescription(
    "Eu aviso suas contas antes, no dia e depois de vencer, ate voce pagar. Manda /start pra ver os comandos."
  );

  await bot.api.setMyShortDescription("Lembra suas contas e cobra ate pagar. Sem desculpa.");
}
