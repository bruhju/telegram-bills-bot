import { initDb, run } from "./index";
import { SCHEMA_STATEMENTS } from "./schema";

/**
 * DDL idempotente rodado no cold start (ver src/worker.ts). No D1 cada
 * `prepare().run()` aceita uma statement só, por isso o array do schema é
 * executado em sequência — todos são CREATE ... IF NOT EXISTS, então repetir
 * no boot é inofensivo.
 */
export async function migrate(): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await run(statement);
  }
}

if (typeof process !== "undefined" && /migrate\.(ts|js)$/.test(process.argv[1] ?? "")) {
  // Uso via CLI (`npm run migrate`): abre o banco dev local antes de migrar.
  // O specifier é montado em runtime de propósito — o bundler do Workers não
  // pode traçar este import, senão devD1 (e o better-sqlite3 nativo) entraria
  // no bundle de produção. Este ramo nunca roda no worker.
  void (async () => {
    const devModule = "./" + "devD1";
    const { createDevD1 } = (await import(devModule)) as typeof import("./devD1");
    const { config } = await import("../config");
    initDb(createDevD1(config.dbPath));
    await migrate();
    console.log("Migration complete.");
  })().catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
}
