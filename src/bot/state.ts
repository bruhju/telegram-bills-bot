import {
  deleteWizardStateRow,
  getWizardStateRow,
  saveWizardStateRow,
} from "../db/repository";

// Conversation state with D1 persistence (so Cloudflare Worker isolate restarts never drop flows).

export type FlowKind = "addconta" | "addfixa" | "setamount" | "editbill" | "editfixa";

export type FlowStep = "label" | "dueDate" | "dueDay" | "amount" | "emoji" | "confirm";

export interface FlowData {
  label?: string;
  urgent?: boolean;
  /** ISO date YYYY-MM-DD (conta avulsa). */
  dueDate?: string;
  /** Day of month 1-31 (conta fixa). */
  dueDay?: number;
  amount?: number | null;
  emoji?: string | null;
  /** Target bill ID for setamount / editbill flows. */
  billId?: number;
  /** Target recurring bill ID for editfixa flow. */
  recurringBillId?: number;
  /** Month reference for returning to /contas view. */
  monthRef?: string;
}

export interface Flow {
  kind: FlowKind;
  step: FlowStep;
  /** "wizard" = started via /addconta, /addfixa or menu button; "nl" = parsed from free text. */
  src: "wizard" | "nl";
  data: FlowData;
  updatedAt: number;
}

const FLOW_TTL_MS = 10 * 60 * 1000; // 10 minutes TTL

const flows = new Map<number, Flow>();
const expiredChats = new Set<number>();

function isExpired(flow: Flow): boolean {
  return Date.now() - flow.updatedAt > FLOW_TTL_MS;
}

/** Hydrates memory from D1 if this isolate does not have the chat's flow cached. */
export async function hydrateFlow(chatId: number): Promise<void> {
  if (flows.has(chatId)) return;
  try {
    const row = await getWizardStateRow(chatId);
    if (!row) return;
    const parsed = JSON.parse(row.flow_json) as Flow;
    parsed.updatedAt = row.updated_at;
    if (isExpired(parsed)) {
      expiredChats.add(chatId);
      await deleteWizardStateRow(chatId);
      return;
    }
    flows.set(chatId, parsed);
  } catch {
    // Ignore DB hydration errors if DB isn't ready
  }
}

/** Returns the active flow for the chat, or undefined (expired flows are dropped). */
export function getFlow(chatId: number): Flow | undefined {
  const flow = flows.get(chatId);
  if (!flow) return undefined;
  if (isExpired(flow)) {
    flows.delete(chatId);
    expiredChats.add(chatId);
    void deleteWizardStateRow(chatId).catch(() => {});
    return undefined;
  }
  return flow;
}

/** Returns true (and drops the flow) if a flow existed but expired. */
export function takeExpiredFlow(chatId: number): boolean {
  if (expiredChats.has(chatId)) {
    expiredChats.delete(chatId);
    return true;
  }
  const flow = flows.get(chatId);
  if (flow && isExpired(flow)) {
    flows.delete(chatId);
    void deleteWizardStateRow(chatId).catch(() => {});
    return true;
  }
  return false;
}

/** Replaces the flow for the chat and refreshes the TTL. */
export function setFlow(chatId: number, flow: Omit<Flow, "updatedAt">): Flow {
  expiredChats.delete(chatId);
  const stamped: Flow = { ...flow, updatedAt: Date.now() };
  flows.set(chatId, stamped);
  void saveWizardStateRow(chatId, JSON.stringify(stamped), stamped.updatedAt).catch(() => {});
  return stamped;
}

/** Merges a patch into the active flow and refreshes the TTL. */
export function updateFlow(
  chatId: number,
  patch: Partial<Omit<Flow, "updatedAt">>
): Flow | undefined {
  const current = getFlow(chatId);
  if (!current) return undefined;
  return setFlow(chatId, { ...current, ...patch });
}

export function clearFlow(chatId: number): void {
  expiredChats.delete(chatId);
  flows.delete(chatId);
  void deleteWizardStateRow(chatId).catch(() => {});
}
