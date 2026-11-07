# Telegram Bills Bot

Bot pessoal de Telegram para lembretes de contas mensais, com registro de comprovantes. O bot fala com você no tom do Julius (personagem de "Todo Mundo Odeia o Chris") — sério, sovina e sem paciência pra conta atrasada. O texto é original (não reproduz falas do seriado), só a personalidade é inspirada nele.

## Funcionalidades

- Contas fixas (recorrentes): cadastra uma vez com o dia do vencimento, e todo mês o bot cria a conta daquele mês automaticamente.
- Todo dia 5, envia a lista de contas ainda pendentes do mês.
- Lembra individualmente de cada conta pendente um dia antes e no dia do vencimento, e depois de vencida manda um lembrete por dia até ela ser marcada como paga.
- Contas urgentes (prefixo `urgente:` no nome) cobram em dobro: um dia antes e no dia do vencimento, o lembrete sai duas vezes — uma de manhã (9h) e outra à noite (20h) — em vez de uma vez só.
- Emoji por conta é definido por você no cadastro (campo `emoji`), não é escolhido automaticamente pelo bot.
- Valor é sempre o último campo e é opcional: se não informar (ex: contas de cartão de crédito, que variam todo mês), o bot trata como "indefinido".
- Quando você manda um comprovante (foto ou PDF) com uma legenda (ex: "financiamento fevereiro de 2026"), o bot salva uma cópia do arquivo, tenta casar com uma conta pendente e marca essa conta como paga automaticamente.
- Cadastro rápido de novas contas direto pelo chat: por comando, por wizard passo a passo ou por texto livre.

## Comandos

- `/start` — abre o menu com botões (contas do mês, contas fixas, adicionar conta, ajuda).
- `/addconta` — cria uma conta **passo a passo**: o bot pergunta nome, vencimento (aceita "hoje", "amanhã", "dd/mm" ou data ISO), emoji e valor, e mostra um resumo pra você confirmar com botão. Atalho direto: `/addconta <nome> | <vencimento YYYY-MM-DD ou -> | <emoji ou -> | <valor ou ->` (ex: `/addconta Internet | 2026-02-10 | 🌐 | 120.00`). Prefixe o nome com `urgente:` pra marcar como urgente.
- `/addfixa` — cria uma conta fixa (recorrente) passo a passo, perguntando o **dia do mês** do vencimento. Atalho direto: `/addfixa <nome> | <dia 1-31> | <emoji ou -> | <valor ou ->` (ex: `/addfixa Financiamento | 10 | 🏠 | 1500.00`). O bot cria a instância do mês atual na hora, e dos meses seguintes automaticamente. Também aceita `urgente:`.
- Texto livre — sem comando nenhum, escreva algo como **`aluguel 1200 dia 5`** e o bot interpreta (nome, valor e dia do vencimento) e pede confirmação com botão. Se ele não entender, ele diz e sugere o formato.
- `/contas` — painel do mês (com resumo de valores pagos/pendentes, status de atraso, navegação entre meses `⬅️` / `➡️` e botões para pagar ou editar/excluir)
- `/fixas` — lista as contas fixas cadastradas com o total mensal e botões para editar valor/dia ou excluir
- `/listamensal` — manda a lista mensal de pendências com total e botões de baixa rápida
- `/pago [nome] [valor]` — marca uma conta como paga (ex: `/pago luz 185,90`); sem argumento, mostra botões com as contas pendentes
- `/reabrir [nome]` — volta uma conta paga para pendente (sem argumento, mostra botões com as contas pagas)
- `/comprovantes [busca]` — lista os comprovantes registrados e permite baixar a foto/PDF original direto no chat
- `/apagar [nome]` — exclui uma conta do mês atual
- `/cancelar` — cancela a conversa em andamento (wizard ou confirmação) sem cadastrar nada
- `/ajuda` — lista todos os comandos e dicas de uso
- `/debugrun [YYYY-MM-DD] [morning|evening]` — roda a checagem diária de verdade (com todos os efeitos: materializa contas fixas, loga lembretes), simulando a data e o turno informados (padrão: hoje, manhã). Não aparece no menu de `/` pra não confundir o uso do dia a dia, mas funciona normalmente se digitado
- Enviar `paguei <conta> [valor]` no texto livre = dá baixa na conta e atualiza o valor
- Enviar foto/PDF (com ou sem legenda) = registrar comprovante de pagamento (se vier sem legenda, o bot mostra botões com as contas pendentes para vincular com 1 toque)

Conversas do wizard expiram sozinhas após 5 minutos de inatividade.

## Arquitetura (Cloudflare Workers)

O bot roda 100% na camada gratuita do Cloudflare, sem servidor dedicado:

- **Workers** (webhook): o Telegram entrega cada mensagem via HTTPS para o Worker (`src/worker.ts`), que responde na hora — não há processo nem long-polling em produção.
- **D1** (banco): SQLite gerenciado do Cloudflare (binding `DB`). É aqui que moram contas, fixas e comprovantes — **os dados não somem mais a cada deploy**, porque o D1 é persistente e replicado, não um arquivo num filesystem efêmero.
- **KV** (comprovantes): fotos/PDFs enviados como comprovante ficam num namespace KV (binding `RECEIPTS`) — também persistente, e grátis sem cartão de crédito (free tier: 1 GB). É um archive write-only: o bot nunca reenvia o arquivo guardado (usa o file_id do Telegram); o KV guarda só a cópia durável — o comprovante original continua no chat do Telegram. No dev local os comprovantes ficam no filesystem, em `./data/receipts`.
- **Cron Triggers**: `0 12,23 * * *` em UTC = **9h e 20h no horário de Brasília** (UTC-3 fixo, o Brasil não tem horário de verão desde 2019). Cada disparo escolhe o turno (`morning` às 9h, `evening` às 20h) pelo horário no fuso `America/Sao_Paulo` e roda a mesma checagem diária de sempre.
- Migrações de banco rodam no boot do Worker (uma vez por isolate), então o deploy já sobe com o schema em dia.

## Deploy

1. `npx wrangler login` (abre o navegador pra autorizar sua conta Cloudflare)
2. `npx wrangler d1 create bills-db` — **copie o `database_id` que o comando imprime e cole no `wrangler.toml`** (campo `database_id` do bloco `[[d1_databases]]`)
3. Namespace KV `RECEIPTS` — **já criada**, com o `id` já preenchido no `wrangler.toml` (bloco `[[kv_namespaces]]`); é nela que o Worker guarda a cópia de cada comprovante (foto/PDF) que você manda no chat, com chave `receipts/<file_unique_id>.<ext>`. Para recriar em outra conta: `npx wrangler kv namespace create RECEIPTS` e cole o `id` impresso no `wrangler.toml`
4. `npx wrangler secret put TELEGRAM_BOT_TOKEN` — cole o token do [@BotFather](https://t.me/BotFather)
5. `npx wrangler secret put TELEGRAM_CHAT_ID` — cole o id do seu chat (veja como pegar em "Desenvolvimento local")
6. `npx wrangler secret put WEBHOOK_SECRET` (opcional, recomendado) — gere um segredo aleatório (ex.: `openssl rand -hex 24`), cole no prompt do wrangler e coloque o MESMO valor no `.env` (`WEBHOOK_SECRET=`). Sem esse par, quem adivinhar a URL do Worker pode forjar updates.
7. `npm run deploy`
8. `npm run webhook:set` — aponta o webhook do Telegram para a URL do Worker. Antes, coloque no `.env` a `WORKER_URL` (o `wrangler deploy` imprime a URL, no formato `https://telegram-bills-bot.<sua-subdominio>.workers.dev`) e, se gerou o segredo, também o `WEBHOOK_SECRET` (o script envia o `secret_token` junto — os dois lados precisam do mesmo valor)
9. Pronto — mande `/start` pro bot.

## Desenvolvimento local

1. `npm install`
2. `cp .env.example .env` e preencha:
   - `TELEGRAM_BOT_TOKEN`: token do bot criado no [@BotFather](https://t.me/BotFather)
   - `TELEGRAM_CHAT_ID`: mande qualquer mensagem para o bot e veja o id em `https://api.telegram.org/bot<TOKEN>/getUpdates`, ou use um bot utilitário como @getidsbot
   - `DB_PATH`/`RECEIPTS_DIR` (opcionais): onde o SQLite local e os comprovantes ficam
3. `npm run dev` — sobe o bot em modo Node: long-polling + banco SQLite local (via shim que imita a API do D1) + scheduler local nos mesmos horários de Brasília. Migrações rodam no boot.
4. Para testar o Worker de verdade localmente: `npm run cf:dev` (usa o `wrangler dev`, com D1 local).
5. `npm run seed` — popula o banco local com dados de exemplo.

**Atenção**: o Telegram só permite um "consumidor" por token. Se o webhook estiver ativo em produção e você rodar `npm run dev`, o Telegram pode dar `409 Conflict` (as entregas vão pra um ou outro). Para testar localmente com folga, rode `npm run webhook:set` apontando pra outro Worker/URL ou remova o webhook temporariamente e recadastre depois.

## Limitações conhecidas

- Não há comando para editar uma conta já criada — se errar algum campo, apague (não há `/apagar` ainda) e recrie com `/addconta`.
- O matching de comprovante é por similaridade de texto na legenda; se a legenda for muito diferente do nome da conta, o bot vai pedir para você escolher manualmente entre as contas pendentes.
- Comprovantes (fotos/PDFs) são guardados como binários duráveis no KV em produção (namespace `RECEIPTS` — grátis, sem cartão); no dev local ficam em `./data/receipts`. O KV é write-only pra esse bot: nenhum comando reenvia o arquivo guardado — o bot sempre usa o file_id do Telegram.
- O free tier do Workers tem limites de execução por dia; para uso pessoal de um bot, o consumo típico fica muito abaixo do limite.
