import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, readChain, sha256, signHash, publicKeyPem } from "./record.ts";
import type { DecisionRecord } from "./types.ts";

// Pillar three: outcome verification.
//
// A decision says what should have happened. A settlement says what did. This
// module compares them, and its most important job is catching a payment that
// settled even though the decision held it, which means something executed
// outside the control.

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");
const settlementsPath = join(dataDir, "settlements.jsonl");
const outcomesPath = join(dataDir, "outcomes.jsonl");

export type SettlementStatus = "settled" | "returned" | "reversed" | "pending";

/** What the bank or payment platform reports back about a payment. */
export type SettlementEvent = {
  id: string;
  /** The decision this settlement claims to correspond to. */
  decisionId: string;
  status: SettlementStatus;
  amount: number;
  currency: string;
  payeeAccountLast4: string;
  occurredAt: string;
  /** The rail's own identifier, for example an ACH trace number. */
  railReference: string;
  /** Nacha return code, when the status is returned. */
  returnCode?: string;
};

export type OutcomeStatus =
  /** Settled once, for the right amount, to the right account, under a released decision. */
  | "verified"
  /** Settled although the decision held or escalated the payment. */
  | "unauthorized"
  /** Settled more than once. */
  | "duplicate"
  /** Settled, but the amount or account differs from the decision. */
  | "mismatch"
  /** Returned or reversed by the rail; needs reconciliation. */
  | "returned"
  /** Nothing has settled yet. */
  | "unsettled";

export type OutcomeFinding = {
  severity: "info" | "warning" | "critical";
  code: string;
  detail: string;
};

export type OutcomeRecord = {
  id: string;
  createdAt: string;
  decisionId: string;
  /** Binds this outcome to the exact decision record it was checked against. */
  decisionHash: string;
  decisionOutcome: DecisionRecord["outcome"];
  status: OutcomeStatus;
  findings: OutcomeFinding[];
  settlements: SettlementEvent[];
  prevHash: string | null;
  hash: string;
  signature: string;
  publicKey: string;
};

function ensureDataDir() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

export const readSettlements = () => readJsonl<SettlementEvent>(settlementsPath);
export const readOutcomes = () => readJsonl<OutcomeRecord>(outcomesPath);

export function recordSettlement(event: Omit<SettlementEvent, "id">): SettlementEvent {
  ensureDataDir();
  const stored: SettlementEvent = { ...event, id: `stl_${randomUUID().replace(/-/g, "").slice(0, 16)}` };
  appendFileSync(settlementsPath, `${JSON.stringify(stored)}\n`);
  return stored;
}

const money = (amount: number, currency: string) =>
  `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

/**
 * Compares a decision with everything the rail reported about it.
 *
 * Order matters: an unauthorized settlement outranks every other finding,
 * because it means the control was bypassed rather than wrong.
 */
export function evaluateOutcome(
  decision: DecisionRecord,
  settlements: SettlementEvent[],
): { status: OutcomeStatus; findings: OutcomeFinding[] } {
  const findings: OutcomeFinding[] = [];
  const settled = settlements.filter((s) => s.status === "settled");
  const returned = settlements.filter((s) => s.status === "returned" || s.status === "reversed");

  // The control was bypassed: money moved on a payment we did not release.
  if (settled.length > 0 && decision.outcome !== "released") {
    findings.push({
      severity: "critical",
      code: "settled_without_release",
      detail: `The decision was ${decision.outcome}, but ${settled.length} settlement(s) were reported. Money moved outside the control.`,
    });
  }

  if (settled.length > 1) {
    findings.push({
      severity: "critical",
      code: "duplicate_settlement",
      detail: `${settled.length} settlements reference this decision: ${settled
        .map((s) => s.railReference)
        .join(", ")}`,
    });
  }

  for (const event of settled) {
    if (Math.abs(event.amount - decision.paymentOrder.amount) > 0.005) {
      findings.push({
        severity: "critical",
        code: "amount_mismatch",
        detail: `Decision approved ${money(decision.paymentOrder.amount, decision.paymentOrder.currency)}, rail settled ${money(
          event.amount,
          event.currency,
        )} (${event.railReference})`,
      });
    }
    if (event.payeeAccountLast4 !== decision.paymentOrder.payeeAccountLast4) {
      findings.push({
        severity: "critical",
        code: "account_mismatch",
        detail: `Decision approved account ****${decision.paymentOrder.payeeAccountLast4}, rail settled to ****${event.payeeAccountLast4} (${event.railReference})`,
      });
    }
    if (event.currency !== decision.paymentOrder.currency) {
      findings.push({
        severity: "warning",
        code: "currency_mismatch",
        detail: `Decision in ${decision.paymentOrder.currency}, settlement in ${event.currency}`,
      });
    }
  }

  for (const event of returned) {
    findings.push({
      severity: "warning",
      code: event.status === "returned" ? "payment_returned" : "payment_reversed",
      detail: `${event.railReference}${event.returnCode ? ` (${event.returnCode})` : ""} on ${event.occurredAt}. Reconcile before any retry, and never to a new account.`,
    });
  }

  if (settlements.length === 0) {
    findings.push({
      severity: "info",
      code: "no_settlement",
      detail:
        decision.outcome === "released"
          ? "Released, but the rail has not reported a settlement yet."
          : "No settlement reported, which is correct for a payment that was not released.",
    });
  }

  // Precedence: bypass, then duplicate, then mismatch, then returned.
  const has = (code: string) => findings.some((f) => f.code === code);
  const status: OutcomeStatus = has("settled_without_release")
    ? "unauthorized"
    : has("duplicate_settlement")
      ? "duplicate"
      : has("amount_mismatch") || has("account_mismatch")
        ? "mismatch"
        : returned.length > 0
          ? "returned"
          : settled.length === 1 && decision.outcome === "released"
            ? "verified"
            : "unsettled";

  return { status, findings };
}

/** Runs the comparison for one decision and seals the result. */
export function verifyOutcomeForDecision(decisionId: string): OutcomeRecord {
  const decision = readChain().find((r) => r.id === decisionId);
  if (!decision) throw new Error(`No decision record ${decisionId}`);

  const settlements = readSettlements().filter((s) => s.decisionId === decisionId);
  const { status, findings } = evaluateOutcome(decision, settlements);

  const previous = readOutcomes().at(-1) ?? null;
  const body = {
    id: `out_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    createdAt: new Date().toISOString(),
    decisionId,
    decisionHash: decision.hash,
    decisionOutcome: decision.outcome,
    status,
    findings,
    settlements,
    prevHash: previous ? previous.hash : null,
  };

  const hash = sha256(canonical(body));
  const record: OutcomeRecord = { ...body, hash, signature: signHash(hash), publicKey: publicKeyPem };

  ensureDataDir();
  appendFileSync(outcomesPath, `${JSON.stringify(record)}\n`);
  return record;
}

export const settlementsFile = settlementsPath;
export const outcomesFile = outcomesPath;
