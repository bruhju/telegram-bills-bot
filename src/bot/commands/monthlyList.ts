import type { BotContext } from "../index";
import { config } from "../../config";
import { buildMonthlyChecklist } from "../../scheduler/dailyJob";
import { monthRefOf, todayStr } from "../../utils/date";

export async function monthlyListCommand(ctx: BotContext): Promise<void> {
  const monthRef = monthRefOf(todayStr(config.timezone));
  const { text, keyboard } = await buildMonthlyChecklist(monthRef);
  await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
}
