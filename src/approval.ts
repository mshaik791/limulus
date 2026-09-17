import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { canonical, publicKeyPem, readChain, sha256, signHash } from "./record.ts";
import { readLinks } from "./rails/reconcile.ts";
import { rail, type Rail } from "./rails/increase.ts";
import type { DecisionRecord } from "./types.ts";

// The human half of the gate.
//
// ESCALATE only means something if a person can actually answer it, and the
// answer has to be as provable as the decision was — "who approved the
// $64,000 payment" is the first question an auditor asks, and an answer that
// lives in someone's memory is not an answer. So an approval is its own
// signed, hash-chained record.
//
// The rule that matters most here is what is NOT approvable.

const dataDir = join(import.meta.dirname, "..", "data");
const approvalsPath = join(dataDir, "approvals.jsonl");

export type ApprovalAction = "approved" | "rejected";

export type ApprovalRecord = {
  kind: "approval";
  id: string;
  createdAt: string;
  decisionId: string;
  decisionHash: string;
  action: ApprovalAction;
  /** The person, not the agent. An agent must never appear here. */
  approvedBy: string;
  note?: string;
  transferId: string | null;
  railStatusBefore: string | null;
  railStatusAfter: string | null;
  railError?: string;
  prevHash: string | null;
  hash: string;
  signature: string;
  publicKey: string;
};

export function readApprovals(): ApprovalRecord[] {
  if (!existsSync(approvalsPath)) return [];
  const rows: ApprovalRecord[] = [];
  for (const line of readFileSync(approvalsPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as ApprovalRecord);
    } catch {
      // A malformed line is a corrupted append, not a reason to fail a read.
    }
  }
  return rows;
}

export const approvalFor = (decisionId: string): ApprovalRecord | undefined =>
  readApprovals().find((a) => a.decisionId === decisionId);

export type QueueItem = {
  decisionId: string;
  createdAt: string;
  invoiceId?: string;
  poId?: string;
  payeeName: string;
  payeeAccountLast4: string;
  amount: number;
  currency: string;
  rail: string;
  agentId: string;
  principal: string;
  /** Why a person is being asked. The codes, not prose about them. */
  reasons: string[];
  failedChecks: { id: string; name: string; status: string; detail: string }[];
  transferId: string | null;
  /** Set once somebody has answered. */
  resolved: { action: ApprovalAction; approvedBy: string; at: string } | null;
};

const linkFor = (decisionId: string): string | null =>
  readLinks().find((l) => l.decisionId === decisionId)?.transferId ?? null;

function toQueueItem(r: DecisionRecord, resolvedBy?: ApprovalRecord): QueueItem {
  return {
    decisionId: r.id,
    createdAt: r.createdAt,
    invoiceId: r.declaration.invoiceId,
    poId: r.declaration.poId,
    payeeName: r.declaration.payeeName ?? r.paymentOrder.payeeName,
    payeeAccountLast4: r.declaration.payeeAccountLast4 ?? r.paymentOrder.payeeAccountLast4,
    amount: r.declaration.amount ?? r.paymentOrder.amount,
    currency: r.declaration.currency ?? r.paymentOrder.currency,
    rail: r.paymentOrder.rail,
    agentId: r.declaration.agentId,
    principal: r.authorization.principal,
    reasons: r.reasons ?? [],
    failedChecks: (r.checks ?? []).filter((c) => c.status !== "pass"),
    transferId: linkFor(r.id),
    resolved: resolvedBy
      ? { action: resolvedBy.action, approvedBy: resolvedBy.approvedBy, at: resolvedBy.createdAt }
      : null,
  };
}

/**
 * Everything waiting on a person, newest first.
 *
 * Only escalations appear. A blocked payment is deliberately absent — see
 * actOnDecision.
 */
export function pendingQueue(limit = 100): QueueItem[] {
  const answered = new Map(readApprovals().map((a) => [a.decisionId, a]));
  return readChain()
    .filter((r) => r.outcome === "escalated")
    .filter((r) => !answered.has(r.id))
    .reverse()
    .slice(0, limit)
    .map((r) => toQueueItem(r));
}

/** Escalations that have been answered, for the audit trail. */
export function resolvedQueue(limit = 50): QueueItem[] {
  const answered = new Map(readApprovals().map((a) => [a.decisionId, a]));
  return readChain()
    .filter((r) => answered.has(r.id))
    .reverse()
    .slice(0, limit)
    .map((r) => toQueueItem(r, answered.get(r.id)));
}

export class ApprovalError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Records a person's answer to an escalation, and moves the money or doesn't.
 *
 * A blocked decision is not approvable here, and that is the point rather than
 * a missing feature. BLOCK means the three records disagree — a different
 * account, an amount that drifted, an invoice already settled. Letting someone
 * clear that with one click would rebuild, inside the product, exactly the
 * bypass that reconciliation exists to catch; the override would look identical
 * to an insider approving a held transfer directly at the bank. The correct
 * path for a genuine false positive is to fix the underlying record and submit
 * again, so the new payment gets its own decision and its own receipt.
 */
export async function actOnDecision(
  decisionId: string,
  action: ApprovalAction,
  approvedBy: string,
  note?: string,
  using: Rail = rail(),
): Promise<ApprovalRecord> {
  const person = (approvedBy ?? "").trim();
  if (!person) {
    throw new ApprovalError(400, "approver_required", "An approval has to name the person making it.");
  }

  const decision = readChain().find((r) => r.id === decisionId);
  if (!decision) {
    throw new ApprovalError(404, "unknown_decision", `No decision ${decisionId}.`);
  }

  if (decision.outcome === "held") {
    throw new ApprovalError(
      409,
      "blocked_not_overridable",
      "This payment was blocked, not escalated: the authorization, the declaration and the payment order disagree. " +
        "There is deliberately no override — correct the underlying record and submit the payment again so it gets " +
        "its own decision and its own receipt.",
    );
  }

  if (decision.outcome !== "escalated") {
    throw new ApprovalError(
      409,
      "not_awaiting_approval",
      `This payment was ${decision.outcome}; nobody is being asked to approve it.`,
    );
  }

  const already = approvalFor(decisionId);
  if (already) {
    throw new ApprovalError(
      409,
      "already_answered",
      `${already.approvedBy} already ${already.action} this on ${already.createdAt}.`,
    );
  }

  const transferId = linkFor(decisionId);
  let railStatusBefore: string | null = null;
  let railStatusAfter: string | null = null;
  let railError: string | undefined;

  if (transferId) {
    try {
      railStatusBefore = (await using.get(transferId)).status;
      const moved = action === "approved" ? await using.approve(transferId) : await using.cancel(transferId);
      railStatusAfter = moved.status;
    } catch (error) {
      // The answer is still worth recording even when the rail refused it —
      // otherwise a failed approval leaves no trace of having been attempted.
      railError = error instanceof Error ? error.message : String(error);
    }
  }

  const previous = readApprovals().at(-1) ?? null;
  const body = {
    kind: "approval" as const,
    id: `apr_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    createdAt: new Date().toISOString(),
    decisionId,
    decisionHash: decision.hash,
    action,
    approvedBy: person,
    ...(note ? { note } : {}),
    transferId,
    railStatusBefore,
    railStatusAfter,
    ...(railError ? { railError } : {}),
    prevHash: previous ? previous.hash : null,
  };

  const hash = sha256(canonical(body));
  const record: ApprovalRecord = { ...body, hash, signature: signHash(hash), publicKey: publicKeyPem };

  mkdirSync(dataDir, { recursive: true });
  appendFileSync(approvalsPath, `${JSON.stringify(record)}\n`);
  return record;
}

export const approvalsFile = approvalsPath;
