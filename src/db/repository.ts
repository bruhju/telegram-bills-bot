import { all, first, insert, run } from "./index";
import { dueDateForMonth } from "../utils/date";

export type BillStatus = "pending" | "paid";

export interface Bill {
  id: number;
  label: string;
  amount: number | null;
  due_date: string | null;
  month_ref: string;
  status: BillStatus;
  emoji: string | null;
  urgent: number;
  recurring_bill_id: number | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewBill {
  label: string;
  amount: number | null;
  dueDate: string | null;
  monthRef: string;
  emoji?: string | null;
  urgent?: boolean;
  recurringBillId?: number | null;
}

export async function insertBill(bill: NewBill): Promise<Bill> {
  const result = await insert(
    `INSERT INTO bills (label, amount, due_date, month_ref, emoji, urgent, recurring_bill_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    bill.label,
    bill.amount,
    bill.dueDate,
    bill.monthRef,
    bill.emoji ?? null,
    bill.urgent ? 1 : 0,
    bill.recurringBillId ?? null
  );
  return (await getBillById(result.lastRowId))!;
}

export interface UpdateBillPatch {
  label?: string;
  amount?: number | null;
  dueDate?: string | null;
  monthRef?: string;
  emoji?: string | null;
  urgent?: boolean;
}

export async function updateBill(id: number, patch: UpdateBillPatch): Promise<Bill | undefined> {
  const existing = await getBillById(id);
  if (!existing) return undefined;

  const label = patch.label !== undefined ? patch.label : existing.label;
  const amount = patch.amount !== undefined ? patch.amount : existing.amount;
  const dueDate = patch.dueDate !== undefined ? patch.dueDate : existing.due_date;
  const monthRef = patch.monthRef !== undefined ? patch.monthRef : existing.month_ref;
  const emoji = patch.emoji !== undefined ? patch.emoji : existing.emoji;
  const urgent = patch.urgent !== undefined ? (patch.urgent ? 1 : 0) : existing.urgent;

  await run(
    `UPDATE bills
     SET label = ?, amount = ?, due_date = ?, month_ref = ?, emoji = ?, urgent = ?, updated_at = datetime('now')
     WHERE id = ?`,
    label,
    amount,
    dueDate,
    monthRef,
    emoji,
    urgent,
    id
  );
  return getBillById(id);
}

export async function updateBillAmount(id: number, amount: number | null): Promise<Bill | undefined> {
  await run(`UPDATE bills SET amount = ?, updated_at = datetime('now') WHERE id = ?`, amount, id);
  return getBillById(id);
}

export async function deleteBill(id: number): Promise<boolean> {
  const res = await run(`DELETE FROM bills WHERE id = ?`, id);
  return res.changes > 0;
}

export interface RecurringBill {
  id: number;
  label: string;
  due_day: number;
  amount: number | null;
  emoji: string | null;
  urgent: number;
  created_at: string;
}

export interface NewRecurringBill {
  label: string;
  dueDay: number;
  amount: number | null;
  emoji?: string | null;
  urgent?: boolean;
}

export async function insertRecurringBill(recurringBill: NewRecurringBill): Promise<RecurringBill> {
  const result = await insert(
    `INSERT INTO recurring_bills (label, due_day, amount, emoji, urgent) VALUES (?, ?, ?, ?, ?)`,
    recurringBill.label,
    recurringBill.dueDay,
    recurringBill.amount,
    recurringBill.emoji ?? null,
    recurringBill.urgent ? 1 : 0
  );
  return (await getRecurringBillById(result.lastRowId))!;
}

export interface UpdateRecurringBillPatch {
  label?: string;
  dueDay?: number;
  amount?: number | null;
  emoji?: string | null;
  urgent?: boolean;
}

export async function updateRecurringBill(
  id: number,
  patch: UpdateRecurringBillPatch
): Promise<RecurringBill | undefined> {
  const existing = await getRecurringBillById(id);
  if (!existing) return undefined;

  const label = patch.label !== undefined ? patch.label : existing.label;
  const dueDay = patch.dueDay !== undefined ? patch.dueDay : existing.due_day;
  const amount = patch.amount !== undefined ? patch.amount : existing.amount;
  const emoji = patch.emoji !== undefined ? patch.emoji : existing.emoji;
  const urgent = patch.urgent !== undefined ? (patch.urgent ? 1 : 0) : existing.urgent;

  await run(
    `UPDATE recurring_bills SET label = ?, due_day = ?, amount = ?, emoji = ?, urgent = ? WHERE id = ?`,
    label,
    dueDay,
    amount,
    emoji,
    urgent,
    id
  );
  return getRecurringBillById(id);
}

export async function syncPendingBillsFromRecurring(recurring: RecurringBill): Promise<void> {
  const pendingInstances = await all<Bill>(
    `SELECT * FROM bills WHERE recurring_bill_id = ? AND status = 'pending'`,
    recurring.id
  );
  for (const instance of pendingInstances) {
    const newDueDate = dueDateForMonth(instance.month_ref, recurring.due_day);
    await run(
      `UPDATE bills
       SET label = ?, amount = ?, due_date = ?, emoji = ?, urgent = ?, updated_at = datetime('now')
       WHERE id = ?`,
      recurring.label,
      recurring.amount,
      newDueDate,
      recurring.emoji,
      recurring.urgent,
      instance.id
    );
  }
}

export async function deleteRecurringBill(id: number, deletePendingInstances = false): Promise<boolean> {
  if (deletePendingInstances) {
    await run(`DELETE FROM bills WHERE recurring_bill_id = ? AND status = 'pending'`, id);
  }
  const res = await run(`DELETE FROM recurring_bills WHERE id = ?`, id);
  return res.changes > 0;
}

export async function getRecurringBillById(id: number): Promise<RecurringBill | undefined> {
  return (await first<RecurringBill>(`SELECT * FROM recurring_bills WHERE id = ?`, id)) ?? undefined;
}

export async function listRecurringBills(): Promise<RecurringBill[]> {
  return all<RecurringBill>(`SELECT * FROM recurring_bills ORDER BY due_day ASC, id ASC`);
}

export async function hasInstanceForMonth(
  recurringBillId: number,
  monthRef: string
): Promise<boolean> {
  const row = await first(
    `SELECT 1 FROM bills WHERE recurring_bill_id = ? AND month_ref = ?`,
    recurringBillId,
    monthRef
  );
  return row !== null;
}

export async function getBillById(id: number): Promise<Bill | undefined> {
  return (await first<Bill>(`SELECT * FROM bills WHERE id = ?`, id)) ?? undefined;
}

export async function listBillsByMonth(monthRef: string): Promise<Bill[]> {
  return all<Bill>(
    `SELECT * FROM bills WHERE month_ref = ? ORDER BY due_date IS NULL, due_date ASC, id ASC`,
    monthRef
  );
}

export async function listPendingBillsByMonth(monthRef: string): Promise<Bill[]> {
  return all<Bill>(
    `SELECT * FROM bills WHERE month_ref = ? AND status = 'pending' ORDER BY due_date IS NULL, due_date ASC, id ASC`,
    monthRef
  );
}

export async function listPriorOverdueBills(currentMonthRef: string): Promise<Bill[]> {
  return all<Bill>(
    `SELECT * FROM bills WHERE month_ref < ? AND status = 'pending' ORDER BY due_date IS NULL, due_date ASC, id ASC`,
    currentMonthRef
  );
}

export async function listPendingBillsByDueDate(dueDate: string): Promise<Bill[]> {
  return all<Bill>(
    `SELECT * FROM bills WHERE due_date = ? AND status = 'pending' ORDER BY id ASC`,
    dueDate
  );
}

export async function listOverduePendingBills(today: string): Promise<Bill[]> {
  return all<Bill>(
    `SELECT * FROM bills WHERE due_date IS NOT NULL AND due_date < ? AND status = 'pending' ORDER BY due_date ASC`,
    today
  );
}

export async function listPendingBills(): Promise<Bill[]> {
  return all<Bill>(
    `SELECT * FROM bills WHERE status = 'pending' ORDER BY due_date IS NULL, due_date ASC, id ASC`
  );
}

export async function listPaidBills(): Promise<Bill[]> {
  return all<Bill>(`SELECT * FROM bills WHERE status = 'paid' ORDER BY paid_at DESC, id DESC`);
}

export async function markBillPaid(id: number, amount?: number): Promise<Bill | undefined> {
  if (amount !== undefined) {
    await run(
      `UPDATE bills SET status = 'paid', amount = ?, paid_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      amount,
      id
    );
  } else {
    await run(
      `UPDATE bills SET status = 'paid', paid_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      id
    );
  }
  return getBillById(id);
}

export async function reopenBill(id: number): Promise<Bill | undefined> {
  await run(
    `UPDATE bills SET status = 'pending', paid_at = NULL, updated_at = datetime('now') WHERE id = ?`,
    id
  );
  return getBillById(id);
}

export interface Receipt {
  id: number;
  bill_id: number | null;
  label: string;
  telegram_file_id: string;
  telegram_file_unique_id: string;
  file_type: "photo" | "document";
  local_path: string;
  matched: number;
  received_at: string;
}

export interface ReceiptWithBill extends Receipt {
  bill_label: string | null;
  bill_month_ref: string | null;
  bill_amount: number | null;
}

export interface NewReceipt {
  billId: number | null;
  label: string;
  telegramFileId: string;
  telegramFileUniqueId: string;
  fileType: "photo" | "document";
  localPath: string;
  matched: boolean;
}

export async function insertReceipt(receipt: NewReceipt): Promise<number> {
  const result = await insert(
    `INSERT INTO receipts (bill_id, label, telegram_file_id, telegram_file_unique_id, file_type, local_path, matched)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    receipt.billId,
    receipt.label,
    receipt.telegramFileId,
    receipt.telegramFileUniqueId,
    receipt.fileType,
    receipt.localPath,
    receipt.matched ? 1 : 0
  );
  return result.lastRowId;
}

export async function linkReceiptToBill(receiptId: number, billId: number): Promise<void> {
  await run(`UPDATE receipts SET bill_id = ?, matched = 1 WHERE id = ?`, billId, receiptId);
}

export async function getReceiptById(id: number): Promise<ReceiptWithBill | undefined> {
  return (
    (await first<ReceiptWithBill>(
      `SELECT r.*, b.label AS bill_label, b.month_ref AS bill_month_ref, b.amount AS bill_amount
       FROM receipts r
       LEFT JOIN bills b ON b.id = r.bill_id
       WHERE r.id = ?`,
      id
    )) ?? undefined
  );
}

export async function listReceiptsByBillId(billId: number): Promise<Receipt[]> {
  return all<Receipt>(`SELECT * FROM receipts WHERE bill_id = ? ORDER BY received_at DESC, id DESC`, billId);
}

export async function listRecentReceipts(limit = 15): Promise<ReceiptWithBill[]> {
  return all<ReceiptWithBill>(
    `SELECT r.*, b.label AS bill_label, b.month_ref AS bill_month_ref, b.amount AS bill_amount
     FROM receipts r
     LEFT JOIN bills b ON b.id = r.bill_id
     ORDER BY r.received_at DESC, r.id DESC
     LIMIT ?`,
    limit
  );
}

export async function listBillIdsWithReceiptsForMonth(monthRef: string): Promise<Set<number>> {
  const rows = await all<{ bill_id: number }>(
    `SELECT DISTINCT r.bill_id
     FROM receipts r
     INNER JOIN bills b ON b.id = r.bill_id
     WHERE b.month_ref = ? AND r.bill_id IS NOT NULL`,
    monthRef
  );
  return new Set(rows.map((r) => r.bill_id));
}

export type ReminderType = "monthly_list" | "due_tomorrow" | "due_today" | "overdue";

export async function hasReminderBeenSent(
  billId: number,
  type: ReminderType,
  referenceDate: string
): Promise<boolean> {
  const row = await first(
    `SELECT 1 FROM reminder_log WHERE bill_id = ? AND reminder_type = ? AND reference_date = ?`,
    billId,
    type,
    referenceDate
  );
  return row !== null;
}

export async function logReminderSent(
  billId: number,
  type: ReminderType,
  referenceDate: string
): Promise<void> {
  await run(
    `INSERT OR IGNORE INTO reminder_log (bill_id, reminder_type, reference_date) VALUES (?, ?, ?)`,
    billId,
    type,
    referenceDate
  );
}

export async function getWizardStateRow(
  chatId: number
): Promise<{ flow_json: string; updated_at: number } | null> {
  return first<{ flow_json: string; updated_at: number }>(
    `SELECT flow_json, updated_at FROM wizard_state WHERE chat_id = ?`,
    chatId
  );
}

export async function saveWizardStateRow(
  chatId: number,
  flowJson: string,
  updatedAt: number
): Promise<void> {
  await run(
    `INSERT INTO wizard_state (chat_id, flow_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET flow_json = excluded.flow_json, updated_at = excluded.updated_at`,
    chatId,
    flowJson,
    updatedAt
  );
}

export async function deleteWizardStateRow(chatId: number): Promise<void> {
  await run(`DELETE FROM wizard_state WHERE chat_id = ?`, chatId);
}
