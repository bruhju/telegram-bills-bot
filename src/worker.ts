/**
 * Entry point de produção no Cloudflare Workers.
 *
 * - `fetch`: recebe os updates do Telegram via webhook (POST em "/").
 * - `scheduled`: roda a checagem diária via Cron Trigger (0 12,23 * * * UTC
 *   = 9h/20h no horário de Brasília, UTC-3 fixo, sem DST desde 2019).
 *
 * A inicialização é preguiçosa e feita uma vez por isolate: config → D1 →
 * migrações → import do bot. A ordem importa: bot/index.ts lê config.botToken
 * no carregamento do módulo, então a config precisa estar pronta antes.
 */

import { webhookCallback } from "grammy";
import { config, initConfig } from "./config";
import { initDb, migrate } from "./db";
import { runScheduledJob } from "./scheduler";
import { initStorage } from "./services/fileStorage";

/** Bindings/vars do Workers (ver wrangler.toml). */
export type Env = {
  DB: D1Database;
  /** Namespace KV dos comprovantes. Opcional: sem binding, os binários caem
   * no filesystem (dev local / wrangler dev sem KV). */
  RECEIPTS?: KVNamespace;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TZ?: string;
  /** Segredo compartilhado com o Telegram (setWebhook secret_token). Opcional,
   * mas recomendado: sem ele, qualquer um que adivinhe a URL pode forjar
   * updates. Precisa ser o MESMO valor no `wrangler secret put` e no .env. */
  WEBHOOK_SECRET?: string;
};

type BotModule = typeof import("./bot");

let runtimePromise: Promise<BotModule> | null = null;
let commandsRequested = false;

/**
 * Inicializa o runtime uma vez por isolate. A promise é cacheada para que
 * requisições concorrentes não disparem a inicialização duas vezes; em caso
 * de erro ela é descartada para permitir retry na próxima requisição.
 */
function ensureRuntime(env: Env): Promise<BotModule> {
  if (!runtimePromise) {
    runtimePromise = bootstrap(env).catch((error: unknown) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

async function bootstrap(env: Env): Promise<BotModule> {
  initConfig(env);
  initDb(env.DB);
  await migrate();

  // Comprovantes: liga o KV quando o binding existe (produção). Sem binding,
  // os binários vão para o filesystem (ver services/fileStorage.ts).
  initStorage(env.RECEIPTS);

  // IMPORTANTE: config inicializada ANTES deste import — bot/index.ts lê
  // config.botToken no carregamento do módulo.
  return import("./bot");
}

/** Registra o menu de comandos uma vez por isolate (melhor esforço). */
function registerCommandsOnce(
  botModule: BotModule,
  ctx: Pick<ExecutionContext, "waitUntil">
): void {
  if (commandsRequested) return;
  commandsRequested = true;
  ctx.waitUntil(
    botModule.registerCommandList().catch((error: unknown) => {
      // Mesmo comportamento do entry Node: loga e segue sem o menu.
      console.error(
        "Nao consegui atualizar o menu de comandos do bot (seguindo sem isso):",
        describeError(error)
      );
    })
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Turno do job a partir do horário agendado, no fuso de config.timezone.
 * Cron em UTC: 12h → 9h BRT ("morning"), 23h → 20h BRT ("evening").
 */
function resolveSlot(instant: Date): "morning" | "evening" {
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", {
      hour: "numeric",
      hour12: false,
      timeZone: config.timezone,
    }).format(instant)
  );
  if (hour === 9) return "morning";
  if (hour === 20) return "evening";
  // Defensivo: se o cron algum dia apontar para outro horário.
  return hour > 9 && hour < 20 ? "morning" : "evening";
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    try {
      const url = new URL(request.url);
      // O webhook é registrado na raiz ("/"); qualquer outra rota é 404.
      if (url.pathname !== "/") {
        return new Response("Not Found", { status: 404 });
      }
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      // Valida o secret_token ANTES de tocar no banco D1 / migrações.
      if (env.WEBHOOK_SECRET) {
        const headerToken = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!timingSafeEqualStr(headerToken, env.WEBHOOK_SECRET)) {
          return new Response("Unauthorized", { status: 401 });
        }
      }
      const botModule = await ensureRuntime(env);
      registerCommandsOnce(botModule, ctx);
      const options = env.WEBHOOK_SECRET
        ? { secretToken: env.WEBHOOK_SECRET }
        : undefined;
      return await webhookCallback(botModule.bot, "cloudflare-mod", options)(request);
    } catch (error) {
      // Loga a mensagem (nunca segredos) e devolve 500 genérico.
      console.error("Erro tratando requisicao do webhook:", describeError(error));
      return new Response("Internal Server Error", { status: 500 });
    }
  },

  async scheduled(event, env, ctx): Promise<void> {
    try {
      const botModule = await ensureRuntime(env);
      registerCommandsOnce(botModule, ctx);
      const slot = resolveSlot(new Date(event.scheduledTime));
      await runScheduledJob(botModule.bot.api, slot);
    } catch (error) {
      console.error("Erro no job agendado:", describeError(error));
    }
  },
} satisfies ExportedHandler<Env>;
