/**
 * Camada fina de acesso a dados sobre o Cloudflare D1.
 *
 * `initDb` guarda o binding do D1 no isolate (chamado uma vez no cold start,
 * ver src/worker.ts); os helpers `all`/`first`/`run`/`insert` expõem a
 * superfície assíncrona usada por src/db/repository.ts.
 *
 * O mesmo contrato de shapes é cumprido pelo shim de desenvolvimento
 * (src/db/devD1.ts, better-sqlite3) usado no `npm run dev` — estes helpers não
 * sabem (nem precisam saber) qual dos dois está por trás.
 */

let d1: D1Database | null = null;

/** Guarda o binding do D1 para o isolate atual. Chamar uma vez no boot. */
export function initDb(d1Binding: D1Database): void {
  d1 = d1Binding;
}

function requireD1(): D1Database {
  if (!d1) {
    throw new Error(
      "Banco de dados nao inicializado: chame initDb(d1) no boot antes de usar o repositorio."
    );
  }
  return d1;
}

/** SELECT de varias linhas → array de rows. */
export async function all<T = Record<string, unknown>>(
  sql: string,
  ...binds: unknown[]
): Promise<T[]> {
  const result = await requireD1().prepare(sql).bind(...binds).all<T>();
  return result.results;
}

/** SELECT de uma linha → row ou null. */
export function first<T = Record<string, unknown>>(
  sql: string,
  ...binds: unknown[]
): Promise<T | null> {
  return requireD1().prepare(sql).bind(...binds).first<T>();
}

/** INSERT/UPDATE/DELETE → { changes }. */
export async function run(sql: string, ...binds: unknown[]): Promise<{ changes: number }> {
  const result = await requireD1().prepare(sql).bind(...binds).run();
  return { changes: result.meta.changes };
}

/** INSERT → { lastRowId } (equivalente ao lastInsertRowid do better-sqlite3). */
export async function insert(sql: string, ...binds: unknown[]): Promise<{ lastRowId: number }> {
  const result = await requireD1().prepare(sql).bind(...binds).run();
  return { lastRowId: result.meta.last_row_id };
}

// Re-export do contrato: src/worker.ts e src/index.ts importam { initDb, migrate } de "./db".
export { migrate } from "./migrate";
