import { config } from "../src/config";
import { initDb } from "../src/db/index";
import { createDevD1 } from "../src/db/devD1";
import { migrate } from "../src/db/migrate";
import {
  insertRecurringBill,
  listRecurringBills,
  type NewRecurringBill,
} from "../src/db/repository";
import { materializeRecurringBills } from "../src/scheduler/dailyJob";
import { monthRefOf, todayStr } from "../src/utils/date";

export const INITIAL_RECURRING_BILLS: NewRecurringBill[] = [
  { label: "Aluguel", dueDay: 5, amount: 1500, emoji: "🏠", urgent: true },
  { label: "Condomínio", dueDay: 7, amount: 450, emoji: "🏢", urgent: false },
  { label: "Internet", dueDay: 10, amount: 120, emoji: "🌐", urgent: false },
  { label: "Energia", dueDay: 15, amount: null, emoji: "💡", urgent: false },
  { label: "Cartão de Crédito", dueDay: 20, amount: null, emoji: "💳", urgent: true },
];

async function main(): Promise<void> {
  initDb(createDevD1(process.env.DB_PATH ?? "./data/bills.db"));
  await migrate();

  const existing = await listRecurringBills();
  const existingLabels = new Set(existing.map((b) => b.label.toLowerCase()));

  for (const item of INITIAL_RECURRING_BILLS) {
    if (existingLabels.has(item.label.toLowerCase())) {
      console.log(`Já existe conta fixa: ${item.label}`);
      continue;
    }
    const created = await insertRecurringBill(item);
    console.log(
      `Criada conta fixa #${created.id}: ${created.emoji ?? ""} ${created.label} (dia ${created.due_day}${created.urgent ? " 🚨" : ""})`
    );
  }

  const currentMonth = monthRefOf(todayStr(config.timezone));
  await materializeRecurringBills(currentMonth);
  console.log(`Contas materializadas para o mês ${currentMonth}.`);
}

void main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
