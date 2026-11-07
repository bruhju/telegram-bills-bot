import type { BotContext } from "../index";
import { runDailyJob } from "../../scheduler/dailyJob";
import type { DailySlot } from "../../scheduler/dailyJob";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function debugRunCommand(ctx: BotContext): Promise<void> {
  const parts = (ctx.match?.toString().trim() ?? "").split(/\s+/).filter(Boolean);
  let simulatedDate: string | undefined;
  let slot: DailySlot = "morning";

  for (const part of parts) {
    if (part === "morning" || part === "evening") {
      slot = part;
      continue;
    }
    if (!DATE_RE.test(part)) {
      await ctx.reply("Data errada. YYYY-MM-DD, nao e dificil.");
      return;
    }
    simulatedDate = part;
  }

  await ctx.reply(`Vou checar como se fosse ${simulatedDate ?? "hoje"} (turno: ${slot}). Espera.`);
  await runDailyJob(ctx.api, simulatedDate, slot);
  await ctx.reply("Pronto. Checado.");
}
