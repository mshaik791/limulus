import { readChain } from "./record.ts";
import { readSettlements } from "./outcome.ts";
import { checkScope, type ScopeCheck, type ScopeRequest } from "./qualification.ts";
import type { CheckResult, DecisionRecord } from "./types.ts";

// The release gate's answer, in the four words a caller can act on.
//
// ALLOW     release it
// BLOCK     do not release, and do not retry — something is wrong
// ESCALATE  a person decides
// WAIT      we cannot say yet; poll, and do not resubmit
//
// WAIT exists because the alternative is worse. An agent told "no" while an
// earlier payment is still in flight will usually try again, and that is how
// invoices get paid twice.

export type Verdict = "ALLOW" | "BLOCK" | "ESCALATE" | "WAIT";

/** Stable codes, so a caller can branch on them without parsing prose. */
export type ExplanationCode =
  | "all_checks_passed"
  | "payee_not_authorized"
  | "amount_above_limit"
  | "no_human_approval"
  | "execution_drift"
  | "payee_account_mismatch"
  | "recent_bank_change"
  | "duplicate_invoice"
  | "instruction_in_document"
  | "evidence_incomplete"
  | "check_failed"
  | "check_needs_review"
  | "settlement_in_flight"
  | "qualification_required"
  | `qualification:${string}`;

export type Explanation = {
  code: ExplanationCode;
  /** What a person reading the audit log needs to know. */
  message: string;
  severity: "info" | "review" | "blocking";
};

export type ReleaseVerdict = {
  verdict: Verdict;
  explanation: Explanation[];
  /** The signed decision this verdict came from. */
  decisionId: string;
  decisionHash: string;
  signature: string;
  createdAt: string;
  /** Present when the caller referenced a qualification. */
  qualification?: {
    id: string;
    level?: string;
    withinScope: boolean;
    codes: string[];
  };
  /** On WAIT, how long to hold off before asking again. */
  retryAfterMs?: number;
  /** Where the portable receipt for this decision lives. */
  receipt: string;
};

/** Which explanation code a failed or flagged check maps to. */
const CHECK_CODES: Record<string, ExplanationCode> = {
  vendor_approved: "payee_not_authorized",
  within_limit: "amount_above_limit",
  invoice_approved: "no_human_approval",
  declaration_matches_order: "execution_drift",
  payee_account: "payee_account_mismatch",
  bank_detail_change: "recent_bank_change",
  duplicate: "duplicate_invoice",
  embedded_instructions: "instruction_in_document",
  sources_cited: "evidence_incomplete",
};

const codeFor = (check: CheckResult): ExplanationCode =>
  CHECK_CODES[check.id] ?? (check.status === "fail" ? "check_failed" : "check_needs_review");

/**
 * Is an earlier payment for this invoice still unresolved? A released decision
 * with no settlement event yet means the rail has not told us what happened.
 * Answering BLOCK there invites a retry; WAIT does not.
 */
function settlementInFlight(record: DecisionRecord): boolean {
  const invoiceId = record.declaration.invoiceId;
  const settlements = readSettlements();

  // Previews are questions, not payments, so they cannot be in flight.
  const earlier = readChain().filter(
    (r) => r.id !== record.id && r.declaration.invoiceId === invoiceId && r.outcome === "released" && !r.preview,
  );
  if (earlier.length === 0) return false;

  return earlier.some((prior) => {
    const forPrior = settlements.filter((s) => s.decisionId === prior.id);
    // No word from the rail, or the last word was "pending".
    return forPrior.length === 0 || forPrior.at(-1)?.status === "pending";
  });
}

export type VerdictOptions = {
  /** The qualification the caller is relying on, if any. */
  qualificationId?: string;
  scope?: Omit<ScopeRequest, "amount" | "currency">;
  /**
   * When true, a payment with no valid qualification is never allowed. Off by
   * default so the gate can be used on its own; on is what the product argues
   * for, since testing an agent means nothing if untested agents can release.
   */
  requireQualification?: boolean;
  baseUrl?: string;
};

export function verdictFor(record: DecisionRecord, options: VerdictOptions = {}): ReleaseVerdict {
  const explanation: Explanation[] = [];
  const failed = record.checks.filter((c) => c.status === "fail");
  const review = record.checks.filter((c) => c.status === "review");

  for (const check of failed) {
    explanation.push({ code: codeFor(check), message: `${check.name}: ${check.detail}`, severity: "blocking" });
  }
  for (const check of review) {
    explanation.push({ code: codeFor(check), message: `${check.name}: ${check.detail}`, severity: "review" });
  }

  // Qualification, when the caller named one.
  let scopeCheck: ScopeCheck | undefined;
  if (options.qualificationId) {
    scopeCheck = checkScope(options.qualificationId, {
      agentName: options.scope?.agentName ?? "unknown",
      agentVersion: options.scope?.agentVersion ?? "unknown",
      promptHash: options.scope?.promptHash,
      toolConfigHash: options.scope?.toolConfigHash,
      identitySource: options.scope?.identitySource ?? "asserted",
      workflow: options.scope?.workflow ?? "invoice-payment",
      rail: options.scope?.rail ?? record.paymentOrder.rail,
      payeeOnFile:
        options.scope?.payeeOnFile ??
        record.authorization.approvedVendors.some(
          (v) => v.name.toLowerCase() === record.paymentOrder.payeeName.toLowerCase(),
        ),
      currency: record.paymentOrder.currency,
      amount: record.paymentOrder.amount,
    });

    for (const [index, code] of scopeCheck.codes.entries()) {
      explanation.push({
        code: `qualification:${code}`,
        message: scopeCheck.reasons[index] ?? code,
        // A qualification gap means a person decides. It is not evidence that
        // this particular payment is wrong.
        severity: "review",
      });
    }
  } else if (options.requireQualification) {
    explanation.push({
      code: "qualification_required",
      message: "This gate requires a qualification identifier. Run the agent through the Lab first.",
      severity: "review",
    });
  }

  const inFlight = settlementInFlight(record);
  if (inFlight) {
    explanation.push({
      code: "settlement_in_flight",
      message: `An earlier payment for ${record.declaration.invoiceId} has not been confirmed by the rail. Poll rather than resubmit.`,
      severity: "review",
    });
  }

  // The duplicate check fires on any second attempt at an invoice, which covers
  // two different situations. If the rail confirmed the first payment, this is a
  // genuine duplicate and the answer is BLOCK. If the rail has not answered yet,
  // nobody knows whether it was paid, and telling the caller "no" invites
  // another attempt — so that case is WAIT.
  const onlyDuplicateFailed = failed.length > 0 && failed.every((c) => c.id === "duplicate");
  const unresolvedDuplicate = onlyDuplicateFailed && inFlight;

  if (unresolvedDuplicate) {
    // Report it as something to wait on rather than something that is wrong.
    for (const item of explanation) {
      if (item.code === "duplicate_invoice") item.severity = "review";
    }
  }

  // Order matters. A blocking check otherwise wins: it is the one case where we
  // know the payment itself is wrong.
  let verdict: Verdict;
  if (unresolvedDuplicate) verdict = "WAIT";
  else if (failed.length > 0) verdict = "BLOCK";
  else if (inFlight) verdict = "WAIT";
  else if (review.length > 0 || (scopeCheck && !scopeCheck.withinScope) || (options.requireQualification && !scopeCheck)) {
    verdict = "ESCALATE";
  } else verdict = "ALLOW";

  if (explanation.length === 0) {
    explanation.push({
      code: "all_checks_passed",
      message: "Authorization, declaration and payment order agree, and every check passed.",
      severity: "info",
    });
  }

  const base = options.baseUrl ?? "";
  return {
    verdict,
    explanation,
    decisionId: record.id,
    decisionHash: record.hash,
    signature: record.signature,
    createdAt: record.createdAt,
    ...(scopeCheck
      ? {
          qualification: {
            id: options.qualificationId!,
            level: scopeCheck.level,
            withinScope: scopeCheck.withinScope,
            codes: scopeCheck.codes,
          },
        }
      : {}),
    ...(verdict === "WAIT" ? { retryAfterMs: 30_000 } : {}),
    receipt: `${base}/v1/receipts/${record.id}`,
  };
}
