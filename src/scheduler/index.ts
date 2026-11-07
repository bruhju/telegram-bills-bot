import type { Api as BotApi } from "grammy";
import { config } from "../config";
import { runDailyJob } from "./dailyJob";
import type { DailySlot } from "./dailyJob";
import { todayStr } from "../utils/date";

const CHECK_INTERVAL_MS = 60_000;
const MORNING_HOUR = 9;
const EVENING_HOUR = 20;

/**
 * Entrada usada pelo cron trigger do Workers (src/worker.ts). O `/debugrun`
 * usa `runDailyJob` direto pra passar data simulada; aqui é sempre "agora".
 */
export async function runScheduledJob(botApi: BotApi, slot: DailySlot): Promise<void> {
  await runDailyJob(botApi, undefined, slot);
}

/** Hora local (0-23) no fuso configurado, via Intl (sem dependência de cron). */
function localHourIn(timezone: string, date: Date): number {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return Number(formatted);
}

/**
 * Dev-only (`npm run dev`): substitui o node-cron por um setInterval de 60s.
 * Dispara o turno da manhã às 9h e o da noite às 20h no fuso de
 * config.timezone, com guarda em memória de um disparo por dia.
 */
export function startLocalScheduler(botApi: BotApi): void {
  let lastMorningDay: string | null = null;
  let lastEveningDay: string | null = null;

  const runSlotSafely = (slot: DailySlot): void => {
    runDailyJob(botApi, undefined, slot).catch((error) => {
      console.error(`Erro rodando a checagem diaria (turno: ${slot}):`, error);
    });
  };

  const tick = (): void => {
    const now = new Date();
    const hour = localHourIn(config.timezone, now);
    const day = todayStr(config.timezone, now);

    if (hour === MORNING_HOUR && lastMorningDay !== day) {
      lastMorningDay = day;
      runSlotSafely("morning");
    }
    if (hour === EVENING_HOUR && lastEveningDay !== day) {
      lastEveningDay = day;
      runSlotSafely("evening");
    }
  };

  // Paridade com o scheduler antigo (node-cron): roda o turno da manhã já no
  // boot (materializa recorrentes + lembretes). A guarda do dia evita que o
  // primeiro tick repita o disparo se o boot cair dentro das 9h.
  lastMorningDay = todayStr(config.timezone);
  runSlotSafely("morning");

  setInterval(tick, CHECK_INTERVAL_MS);
}
