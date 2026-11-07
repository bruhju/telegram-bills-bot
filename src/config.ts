/**
 * Configuração do bot.
 *
 * No Cloudflare Workers as bindings/vars chegam por request/evento (objeto
 * `env`), então a config NÃO pode mais ser resolvida no import: o módulo
 * exporta um objeto `config` mutável e a função `initConfig()` preenche e
 * valida. `initConfig` é idempotente — chamar de novo não faz nada.
 *
 * - Workers: `initConfig(env)` (src/worker.ts) — valida segredos, erro PT-BR.
 * - Node (dev local): `initConfig()` sem argumento — cai no process.env
 *   (carregando .env via dotenv, defensivamente).
 */

export const config = {
  botToken: "",
  chatId: 0,
  // Campos opcionais, só usados no dev local em Node ( Workers usa D1/KV).
  dbPath: "./data/bills.db",
  receiptsDir: "./data/receipts",
  timezone: "America/Sao_Paulo",
};

let initialized = false;

function loadDotenvDefensively(): void {
  // Nunca pode derrubar um isolate do Workers (esta função só roda no caminho
  // Node, mas o bundler do wrangler ainda inclui o módulo — try/catch garante
  // que a ausência de dotenv/fs não quebre nada).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("dotenv/config");
  } catch {
    // Sem dotenv disponível: segue com o que estiver em process.env.
  }
}

function applyBotSettings(botToken: unknown, chatId: unknown, source: "workers" | "node"): void {
  if (!botToken || typeof botToken !== "string") {
    throw new Error(
      source === "workers"
        ? "Configuração ausente: TELEGRAM_BOT_TOKEN. Rode `npx wrangler secret put TELEGRAM_BOT_TOKEN` e faça deploy de novo."
        : "Configuração ausente: TELEGRAM_BOT_TOKEN. Copie .env.example para .env e preencha o token do @BotFather."
    );
  }
  if (chatId === undefined || chatId === null || chatId === "") {
    throw new Error(
      source === "workers"
        ? "Configuração ausente: TELEGRAM_CHAT_ID. Rode `npx wrangler secret put TELEGRAM_CHAT_ID` e faça deploy de novo."
        : "Configuração ausente: TELEGRAM_CHAT_ID. Copie .env.example para .env e preencha o id do seu chat."
    );
  }
  const parsedChatId = Number(chatId);
  if (!Number.isFinite(parsedChatId)) {
    throw new Error("TELEGRAM_CHAT_ID inválido: precisa ser o id numérico do chat.");
  }
  config.botToken = botToken;
  config.chatId = parsedChatId;
}

/**
 * Preenche e valida `config`. Idempotente: só a primeira chamada tem efeito.
 *
 * @param env Objeto `env` do Workers (bindings/vars). Sem argumento, usa
 *            process.env no Node.
 */
export function initConfig(env?: Record<string, unknown>): void {
  if (initialized) return;

  if (env) {
    applyBotSettings(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, "workers");
    if (typeof env.TZ === "string" && env.TZ) config.timezone = env.TZ;
    initialized = true;
    return;
  }

  // Caminho Node (dev local).
  loadDotenvDefensively();
  applyBotSettings(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID, "node");
  if (process.env.DB_PATH) config.dbPath = process.env.DB_PATH;
  if (process.env.RECEIPTS_DIR) config.receiptsDir = process.env.RECEIPTS_DIR;
  if (process.env.TZ) config.timezone = process.env.TZ;
  initialized = true;
}
