/**
 * Entry point de DESENVOLVIMENTO LOCAL em Node (`npm run dev`).
 *
 * Diferenças para produção (src/worker.ts): roda com long-polling (bot.start)
 * e banco SQLite local via shim better-sqlite3 que imita a API do D1. Em
 * produção é webhook + D1 gerenciado, sem long-polling.
 */

import { config, initConfig } from "./config";

async function main(): Promise<void> {
  // Ordem importa: config primeiro (bot/index.ts lê config.botToken ao ser
  // carregado), depois banco + migrações, e só então bot/scheduler via
  // import dinâmico.
  initConfig();

  const { initDb, migrate } = await import("./db");
  const { createDevD1 } = await import("./db/devD1");
  initDb(createDevD1(config.dbPath));
  await migrate();

  const { bot, registerCommandList, setupShutdown } = await import("./bot");
  const { startLocalScheduler } = await import("./scheduler");

  setupShutdown();

  try {
    await registerCommandList();
  } catch (error) {
    console.error("Nao consegui atualizar o menu de comandos do bot (seguindo sem isso):", error);
  }

  startLocalScheduler(bot.api);
  await bot.start({
    onStart: (botInfo) => {
      console.log(`Bot @${botInfo.username} rodando e aguardando mensagens.`);
    },
  });
}

main().catch((error) => {
  console.error("Fatal error starting bot:", error);
  process.exit(1);
});
