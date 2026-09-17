import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readChain } from "../record.ts";
import { readSettlements, recordSettlement, verifyOutcomeForDecision } from "../outcome.ts";
import { rail, type IncreaseStatus } from "./increase.ts";

// Ask the bank what happened, rather than waiting to be told.
//
// Until now a settlement reached us because someone called report_settlement.
// That is weakest exactly where it matters most: a payment that settled although
// we held it is the one case nobody would think to report. The customer's own
// system has no reason to mention it, and if their agent is the thing that went
// around us, it certainly will not.
//
// So the facts are pulled from the rail and compared with what we decided. Three
// things can be true, and only one of them is fine.

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "..", "data");
const indexPath = join(dataDir, "rail-index.jsonl");

/** Which decision a bank transfer belongs to. Written when the gate creates it. */
export type RailLink = { transferId: string; decisionId: string; at: string };

export function linkTransfer(transferId: string, decisionId: string) {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  appendFileSync(indexPath, `${JSON.stringify({ transferId, decisionId, at: new Date().toISOString() })}\n`);
}

export function readLinks(): RailLink[] {
  if (!existsSync(indexPath)) return [];
  return readFileSync(indexPath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as RailLink);
}

export type Drift = {
  transferId: string;
  status: IncreaseStatus;
  amount: number;
  decisionId?: string;
  /** What our record says should have happened. */
  decided?: "released" | "held" | "escalated";
  code: "unauthorized" | "unknown_payment" | "released_but_cancelled" | "amount_mismatch";
  detail: string;
};

/** Money moved, or is about to, for one of these statuses. */
const MOVED: IncreaseStatus[] = ["pending_submission", "submitted", "returned"];

/**
 * Compares every transfer at the bank against the decision chain.
 *
 * The finding that matters is `unauthorized`: a transfer on its way to the rail
 * under a decision that held or escalated it. That means something executed
 * outside the control, and it is the one thing a payment gate cannot learn from
 * its own records.
 */
export async function reconcile(limit = 100): Promise<{ checked: number; drift: Drift[]; mode: string }> {
  const using = rail();
  if (using.mode === "simulated") {
    return { checked: 0, drift: [], mode: "simulated" };
  }

  const key = process.env.INCREASE_API_KEY!;
  const base = using.mode === "production" ? "https://api.increase.com" : "https://sandbox.increase.com";
  const response = await fetch(`${base}/ach_transfers?limit=${limit}`, {
    headers: { authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`Increase ${response.status} listing transfers`);

  const { data } = (await response.json()) as { data: { id: string; status: IncreaseStatus; amount: number }[] };
  const links = new Map(readLinks().map((l) => [l.transferId, l.decisionId]));
  const chain = readChain();
  const settlements = readSettlements();
  const drift: Drift[] = [];

  for (const transfer of data) {
    const moved = MOVED.includes(transfer.status);
    const decisionId = links.get(transfer.id);
    const amount = transfer.amount / 100;

    if (!decisionId) {
      // A payment the gate never saw. Either it predates us or something paid
      // around us; both are worth a person's attention.
      if (moved) {
        drift.push({
          transferId: transfer.id,
          status: transfer.status,
          amount,
          code: "unknown_payment",
          detail: `${transfer.status} at the bank with no decision behind it`,
        });
      }
      continue;
    }

    const decision = chain.find((r) => r.id === decisionId);
    if (!decision) continue;

    if (moved && decision.outcome !== "released") {
      drift.push({
        transferId: transfer.id,
        status: transfer.status,
        amount,
        decisionId,
        decided: decision.outcome,
        code: "unauthorized",
        detail: `money moved although the decision ${decision.outcome} it`,
      });
    } else if (!moved && transfer.status === "canceled" && decision.outcome === "released") {
      drift.push({
        transferId: transfer.id,
        status: transfer.status,
        amount,
        decisionId,
        decided: decision.outcome,
        code: "released_but_cancelled",
        detail: "we allowed it and the bank shows it cancelled",
      });
    } else if (moved && Math.abs(amount - decision.paymentOrder.amount) > 0.005) {
      drift.push({
        transferId: transfer.id,
        status: transfer.status,
        amount,
        decisionId,
        decided: decision.outcome,
        code: "amount_mismatch",
        detail: `bank shows ${amount.toLocaleString()}, decision was for ${decision.paymentOrder.amount.toLocaleString()}`,
      });
    }

    // Record what the rail says, so outcome verification runs on facts from the
    // bank rather than on anything the customer chose to send us.
    const known = settlements.some((s) => s.railReference === transfer.id && s.status !== "pending");
    if (!known && (transfer.status === "submitted" || transfer.status === "returned")) {
      recordSettlement({
        decisionId,
        status: transfer.status === "returned" ? "returned" : "settled",
        amount,
        currency: decision.paymentOrder.currency,
        payeeAccountLast4: decision.paymentOrder.payeeAccountLast4,
        railReference: transfer.id,
        occurredAt: new Date().toISOString(),
      });
      verifyOutcomeForDecision(decisionId);
    }
  }

  return { checked: data.length, drift, mode: using.mode };
}

export const railIndexFile = indexPath;
