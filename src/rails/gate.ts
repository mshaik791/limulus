import { decide } from "../decide.ts";
import { verdictFor, type ReleaseVerdict } from "../verdict.ts";
import { recordSettlement } from "../outcome.ts";
import { rail, stoppable, type IncreaseTransfer, type Rail } from "./increase.ts";
import { linkTransfer } from "./reconcile.ts";
import type { DecisionRequest } from "../types.ts";

// Gating a real payment at the bank.
//
// Everything before this was a recommendation: Limulus said hold, and something
// else had to honour it. Here the decision is the thing that moves the money or
// does not, because the transfer sits in pending_approval until we approve it
// and expires if we never do.
//
// Failing closed is therefore the default. If this service is down, unreachable
// or simply wrong, the payment does not go out — which is the right direction
// for a control to fail in.

export type GateResult = {
  verdict: ReleaseVerdict;
  transfer: {
    id: string;
    statusBefore: string;
    statusAfter: string;
    /** Whether money can still be stopped at this point. */
    stoppable: boolean;
  };
  rail: { name: string; mode: string };
  /** What we did at the bank, in a sentence. */
  action: string;
};

export type GateInput = {
  request: DecisionRequest;
  /** The Increase account the money leaves from. */
  accountId: string;
  /** Where it goes: an external account, or a routing and account number. */
  externalAccountId?: string;
  routingNumber?: string;
  accountNumber?: string;
  qualificationId?: string;
  agent?: { name?: string; version?: string };
  /** "key" when a credential proved the agent version, "asserted" when it said so. */
  identitySource?: "key" | "asserted";
  idempotencyKey?: string;
};

/**
 * Creates the transfer held, decides, then approves or cancels it.
 *
 * The order matters and is not arbitrary: the transfer is created *before* the
 * decision, so the payment exists in a stopped state while we think about it.
 * Deciding first and creating afterwards would mean the moment between decision
 * and creation is unguarded, and would also give us nothing to cancel when the
 * answer is no.
 */
export async function gatePayment(input: GateInput, using: Rail = rail()): Promise<GateResult> {
  const { request } = input;

  const transfer = await using.create({
    accountId: input.accountId,
    amount: request.paymentOrder.amount,
    statementDescriptor: (request.declaration.invoiceId ?? "payment").slice(0, 10),
    externalAccountId: input.externalAccountId,
    routingNumber: input.routingNumber,
    accountNumber: input.accountNumber,
    individualName: request.paymentOrder.payeeName,
    idempotencyKey: input.idempotencyKey,
  });

  const statusBefore = transfer.status;

  // Record what the rail actually holds, so the decision is matched against the
  // real transfer rather than only against what the agent said it would send.
  const record = decide({ ...request, documents: request.documents ?? [] });

  const verdict = verdictFor(record, {
    qualificationId: input.qualificationId,
    scope: input.qualificationId
      ? {
          agentName: input.agent?.name ?? request.declaration.agentId,
          agentVersion: input.agent?.version ?? "unknown",
          workflow: "invoice-payment",
          rail: "ach",
          identitySource: input.identitySource ?? "asserted",
          payeeOnFile: request.authorization.approvedVendors.some(
            (v) => v.name.toLowerCase() === request.paymentOrder.payeeName.toLowerCase(),
          ),
        }
      : undefined,
  });

  // Remember which decision this transfer belongs to, so reconciliation can
  // compare the bank against the chain later, including for payments we held.
  linkTransfer(transfer.id, record.id);

  let after: IncreaseTransfer = transfer;
  let action: string;

  switch (verdict.verdict) {
    case "ALLOW":
      after = await using.approve(transfer.id);
      action = "Approved at the bank. The transfer is now on its way to the rail.";
      // An approved transfer is a payment we released, so the outcome record
      // starts here rather than waiting for someone to tell us about it.
      recordSettlement({
        decisionId: record.id,
        status: "pending",
        amount: request.paymentOrder.amount,
        currency: request.paymentOrder.currency,
        payeeAccountLast4: request.paymentOrder.payeeAccountLast4,
        railReference: after.id,
        occurredAt: new Date().toISOString(),
      });
      break;

    case "BLOCK":
      after = await using.cancel(transfer.id);
      action = "Cancelled at the bank. This money cannot now move.";
      break;

    case "ESCALATE":
      action = "Left held at the bank, waiting for a person. It expires unapproved rather than settling.";
      break;

    case "WAIT":
      action = "Left held at the bank while an earlier payment is confirmed. Nothing was submitted.";
      break;
  }

  return {
    verdict,
    transfer: {
      id: after.id,
      statusBefore,
      statusAfter: after.status,
      stoppable: stoppable(after.status),
    },
    rail: { name: using.name, mode: using.mode },
    action,
  };
}
