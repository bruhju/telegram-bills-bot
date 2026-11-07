/**
 * Aponta o webhook do Telegram para o Worker publicado.
 *
 * Uso: preencha TELEGRAM_BOT_TOKEN e WORKER_URL no .env e rode `npm run webhook:set`.
 * WORKER_URL é a URL do deploy (ex.: https://telegram-bills-bot.SUA-SUBDOMINIO.workers.dev).
 * O token NUNCA é impresso.
 */

async function main(): Promise<void> {
  try {
    // Script Node-only: dotenv é seguro aqui.
    require("dotenv/config");
  } catch {
    // dotenv ausente: segue com process.env.
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const workerUrl = process.env.WORKER_URL;

  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN ausente no .env.");
    process.exit(1);
  }
  if (!workerUrl) {
    console.error(
      "WORKER_URL ausente no .env (ex.: https://telegram-bills-bot.SUA-SUBDOMINIO.workers.dev)."
    );
    process.exit(1);
  }

  const webhookUrl = `${workerUrl.replace(/\/+$/, "")}/`;
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    console.error("WEBHOOK_SECRET invalido: use apenas A-Za-z0-9_- (1 a 256 chars).");
    process.exit(1);
  }
  const params = new URLSearchParams({ url: webhookUrl });
  if (secret) params.set("secret_token", secret);

  const response = await fetch(
    `https://api.telegram.org/bot${token}/setWebhook?${params.toString()}`
  );
  const payload = (await response.json()) as { ok: boolean; description?: string };

  if (payload.ok) {
    console.log(`Webhook configurado com sucesso: ${webhookUrl}`);
    if (secret) {
      console.log(
        "secret_token ativo — garanta que WEBHOOK_SECRET tambem esta no Cloudflare (npx wrangler secret put WEBHOOK_SECRET) com o MESMO valor."
      );
    } else {
      console.log(
        "AVISO: sem WEBHOOK_SECRET — a URL do webhook e a unica protecao. Recomendado: gere um segredo, faca wrangler secret put WEBHOOK_SECRET + coloque no .env, e rode de novo."
      );
    }
  } else {
    console.error(`Nao consegui configurar o webhook: ${payload.description ?? response.status}`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error("Erro ao configurar o webhook:", error instanceof Error ? error.message : error);
  process.exit(1);
});
