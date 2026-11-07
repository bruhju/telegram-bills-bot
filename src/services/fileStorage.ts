/**
 * Armazenamento dos binários de comprovante (fotos/PDFs).
 *
 * Dois backends, escolhidos no boot via `initStorage`:
 *
 * - KV (produção, Workers): `initStorage(env.RECEIPTS)` liga o namespace; os
 *   arquivos ficam sob chaves `receipts/<file_unique_id ou uuid>.<ext>`.
 *   É um archive write-only: nenhum código lê o binário de volta — o bot
 *   usa sempre o file_id do Telegram; o KV guarda só a cópia durável.
 *   Limites do free tier do KV (1000 writes/dia, 1 GB) ficam muito acima do
 *   uso pessoal deste bot.
 * - Filesystem (dev local em Node, ou `wrangler dev` sem o binding): grava em
 *   `config.receiptsDir` (RECEIPTS_DIR, padrão ./data/receipts), com o mesmo
 *   layout de antes da migração. Os imports de node:fs/node:path são dinâmicos
 *   e só rodam neste caminho, fora do grafo estático do Worker.
 */

import { config } from "../config";
import { slugify } from "../utils/text";

/** Superfície do namespace KV usada aqui (binding `RECEIPTS` do Workers). */
type ReceiptNamespace = Pick<KVNamespace, "put">;

let kv: ReceiptNamespace | null = null;

/** Liga o armazenamento KV. Sem namespace (ou undefined), usa o filesystem. */
export function initStorage(namespace?: KVNamespace): void {
  kv = namespace ?? null;
}

/** true quando os comprovantes vão para o KV (produção). */
export function hasKV(): boolean {
  return kv !== null;
}

export interface ReceiptSaveHint {
  /** file_unique_id do Telegram — preferido na chave do KV (único e estável). */
  fileUniqueId?: string;
  /** Extensão sem ponto ("jpg", "pdf"); "bin" quando desconhecida. */
  extension: string;
  /** Referência "YYYY-MM" — só usada no layout de pastas do filesystem (dev). */
  yearMonth: string;
  /** Legenda da mensagem — só usada no nome do arquivo no filesystem (dev). */
  label: string;
}

/**
 * Persiste o binário do comprovante e devolve onde ele mora: a chave no
 * KV (`receipts/...`) em produção, ou o caminho local no dev.
 * Esse valor é o que vai para a coluna `local_path` da tabela `receipts`.
 */
export async function saveReceipt(bytes: Uint8Array, hint: ReceiptSaveHint): Promise<string> {
  if (kv) {
    const key = `receipts/${keyStem(hint)}.${kvExtension(hint.extension)}`;
    await kv.put(key, bytes);
    return key;
  }
  return saveToDisk(bytes, hint);
}

/** Parte da chave no KV: file_unique_id sanitizado, com fallback p/ uuid. */
function keyStem(hint: ReceiptSaveHint): string {
  const id = (hint.fileUniqueId ?? "").replace(/[^A-Za-z0-9_-]/g, "_");
  return id || crypto.randomUUID();
}

function kvExtension(extension: string): string {
  const ext = extension.replace(/[^A-Za-z0-9]/g, "");
  return ext || "bin";
}

/**
 * Caminho dev (Node): mesmo comportamento de antes —
 * `<receiptsDir>/<YYYY-MM>/<slug-da-legenda>-<timestamp>.<ext>`.
 */
async function saveToDisk(bytes: Uint8Array, hint: ReceiptSaveHint): Promise<string> {
  // Imports dinâmicos: node:fs/node:path só são carregados no caminho dev
  // (npm run dev), nunca no bundle de produção do Worker.
  const [{ mkdirSync, writeFileSync }, { join }] = await Promise.all([
    import("node:fs"),
    import("node:path"),
  ]);
  const dir = join(config.receiptsDir, hint.yearMonth);
  mkdirSync(dir, { recursive: true });
  const filename = `${slugify(hint.label)}-${Date.now()}.${hint.extension}`;
  const filePath = join(dir, filename);
  writeFileSync(filePath, bytes);
  return filePath;
}
