/**
 * Shim de desenvolvimento: implementa a superfície do D1 consumida pelos
 * helpers de src/db/index.ts (prepare → bind → all/first/run) em cima do
 * better-sqlite3, para que `npm run dev` (Node, long-polling) continue
 * funcionando sem Cloudflare.
 *
 * better-sqlite3 é nativo e nunca pode entrar no bundle do Workers — por isso
 * o `require` acontece SÓ aqui, dentro de createDevD1, e este módulo é
 * importado exclusivamente por src/index.ts e scripts (o grafo de
 * src/worker.ts jamais o alcança).
 */

import fs from "node:fs";
import path from "node:path";

type SqliteDatabase = import("better-sqlite3").Database;
type SqliteStatement = import("better-sqlite3").Statement<unknown[]>;
type SqliteConstructor = new (
  path: string,
  options?: import("better-sqlite3").Options
) => SqliteDatabase;

function emptyMeta(): D1Meta & Record<string, unknown> {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: 0,
    last_row_id: 0,
    changed_db: false,
    changes: 0,
  };
}

/** Statement D1 sobre um Statement do better-sqlite3 (bind encadeado). */
class DevD1Statement {
  constructor(
    private readonly stmt: SqliteStatement,
    private readonly params: unknown[]
  ) {}

  bind(...values: unknown[]): DevD1Statement {
    return new DevD1Statement(this.stmt, values);
  }

  first<T = Record<string, unknown>>(colName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const row = this.stmt.get(...this.params) as Record<string, unknown> | undefined;
    if (row === undefined) return null;
    if (colName !== undefined) return (row[colName] ?? null) as T;
    return row as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const results = this.stmt.all(...this.params) as T[];
    return { results, success: true, meta: emptyMeta() };
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const info = this.stmt.run(...this.params);
    return {
      results: [],
      success: true,
      meta: {
        ...emptyMeta(),
        changes: info.changes,
        last_row_id: Number(info.lastInsertRowid),
        changed_db: info.changes > 0,
      },
    };
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    // .raw() é "sticky" no better-sqlite3: liga e desliga na mesma statement
    // pra não vazar o modo raw para as próximas chamadas.
    const rows = this.stmt.raw(true).all() as T[];
    this.stmt.raw(false);
    if (options?.columnNames) {
      const columns = this.stmt.columns().map((column) => column.name);
      return [columns, ...rows] as unknown as T[];
    }
    return rows;
  }
}

/** D1Database sobre uma conexão better-sqlite3 local. */
class DevD1Database {
  constructor(private readonly db: SqliteDatabase) {}

  prepare(query: string): DevD1Statement {
    return new DevD1Statement(this.db.prepare(query), []);
  }

  async batch<T = Record<string, unknown>>(
    statements: DevD1Statement[]
  ): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const statement of statements) {
      results.push(await statement.run<T>());
    }
    return results;
  }

  async exec(query: string): Promise<D1ExecResult> {
    const startedAt = Date.now();
    const statements = query
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) {
      this.db.exec(statement);
    }
    return { count: statements.length, duration: Date.now() - startedAt };
  }

  withSession(): D1DatabaseSession {
    throw new Error("devD1: withSession() nao e suportado no modo de desenvolvimento.");
  }

  dump(): Promise<ArrayBuffer> {
    return Promise.reject(new Error("devD1: dump() nao e suportado no modo de desenvolvimento."));
  }
}

/**
 * Abre (ou cria) o banco SQLite em `dbPath` com WAL habilitado e devolve um
 * objeto compatível com a superfície de D1Database usada pelos helpers.
 */
export function createDevD1(dbPath: string): D1Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const Database = require("better-sqlite3") as SqliteConstructor;
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return new DevD1Database(sqlite);
}
