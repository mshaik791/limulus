import { canonical, publicKeyPem, readChain, sha256, signHash, verifySignature } from "./record.ts";
import { readOutcomes } from "./outcome.ts";
import type { OutcomeRecord } from "./outcome.ts";
import type { DecisionRecord } from "./types.ts";

// A receipt is the portable form of a decision: small enough to paste into an
// email or attach to a dispute, and verifiable by anyone holding only the
// public key inside it. Verification never calls us.

export type Receipt = {
  kind: "limulus.receipt.v1";
  receiptId: string;
  issuedAt: string;

  decision: {
    id: string;
    at: string;
    outcome: DecisionRecord["outcome"];
    /** The hash of the full decision record this receipt summarizes. */
    recordHash: string;
    reasons: string[];
  };

  payment: {
    payee: string;
    accountLast4: string;
    amount: number;
    currency: string;
    invoiceId: string;
    rail: string;
  };

  /** Which checks ran, and how each ended. Enough to settle an argument. */
  checks: { id: string; status: string; detail: string }[];

  authorization: {
    policyVersion: string;
    principal: string;
    limitPerPayment: number;
  };

  outcome?: {
    id: string;
    status: OutcomeRecord["status"];
    findings: { code: string; severity: string; detail: string }[];
    settlements: { railReference: string; status: string; amount: number; at: string }[];
  };

  hash: string;
  signature: string;
  publicKey: string;
};

/** Builds a receipt from a decision, and the outcome for it if one exists. */
export function buildReceipt(decisionId: string): Receipt {
  const decision = readChain().find((r) => r.id === decisionId);
  if (!decision) throw new Error(`No decision record ${decisionId}`);

  const outcome = readOutcomes().filter((o) => o.decisionId === decisionId).at(-1);

  const body = {
    kind: "limulus.receipt.v1" as const,
    receiptId: `rcp_${decision.id.replace(/^dec_/, "")}`,
    issuedAt: new Date().toISOString(),
    decision: {
      id: decision.id,
      at: decision.createdAt,
      outcome: decision.outcome,
      recordHash: decision.hash,
      reasons: decision.reasons,
    },
    payment: {
      payee: decision.paymentOrder.payeeName,
      accountLast4: decision.paymentOrder.payeeAccountLast4,
      amount: decision.paymentOrder.amount,
      currency: decision.paymentOrder.currency,
      invoiceId: decision.declaration.invoiceId,
      rail: decision.paymentOrder.rail,
    },
    checks: decision.checks.map((c) => ({ id: c.id, status: c.status, detail: c.detail })),
    authorization: {
      policyVersion: decision.authorization.policyVersion,
      principal: decision.authorization.principal,
      limitPerPayment: decision.authorization.limitPerPayment,
    },
    ...(outcome
      ? {
          outcome: {
            id: outcome.id,
            status: outcome.status,
            findings: outcome.findings.map((f) => ({ code: f.code, severity: f.severity, detail: f.detail })),
            settlements: outcome.settlements.map((s) => ({
              railReference: s.railReference,
              status: s.status,
              amount: s.amount,
              at: s.occurredAt,
            })),
          },
        }
      : {}),
  };

  const hash = sha256(canonical(body));
  return { ...body, hash, signature: signHash(hash), publicKey: publicKeyPem };
}

export type ReceiptVerification = {
  valid: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
  /** Present when this Limulus instance also holds the underlying record. */
  matchesOurRecord?: boolean;
};

/**
 * Verifies a receipt on its own terms: the hash covers the contents, and the
 * signature covers the hash. Anyone can run this offline with only the receipt.
 */
export function verifyReceipt(receipt: Receipt): ReceiptVerification {
  const checks: ReceiptVerification["checks"] = [];

  const { hash, signature, publicKey, ...body } = receipt;
  const recomputed = sha256(canonical(body));

  const hashOk = recomputed === hash;
  checks.push({
    name: "Contents match the hash",
    ok: hashOk,
    detail: hashOk ? hash : `receipt says ${hash}, contents hash to ${recomputed}`,
  });

  // Verify the signature over the hash we recomputed, not the one the receipt
  // claims. Otherwise an edited receipt could still show a valid signature.
  const signatureOk = verifySignature(recomputed, signature, publicKey);
  checks.push({
    name: "Signature covers these exact contents",
    ok: signatureOk,
    detail: signatureOk
      ? "Ed25519 signature is valid over the contents as received"
      : "signature does not cover these contents",
  });

  const kindOk = receipt.kind === "limulus.receipt.v1";
  checks.push({
    name: "Receipt format is recognized",
    ok: kindOk,
    detail: receipt.kind,
  });

  // If we happen to hold the decision, confirm the receipt describes it.
  const ourCopy = readChain().find((r) => r.id === receipt.decision.id);
  let matchesOurRecord: boolean | undefined;
  if (ourCopy) {
    matchesOurRecord = ourCopy.hash === receipt.decision.recordHash;
    checks.push({
      name: "Matches the decision record we hold",
      ok: matchesOurRecord,
      detail: matchesOurRecord
        ? `decision ${ourCopy.id} hash matches`
        : `our record hashes to ${ourCopy.hash}, receipt claims ${receipt.decision.recordHash}`,
    });
  }

  return { valid: checks.every((c) => c.ok), checks, matchesOurRecord };
}
