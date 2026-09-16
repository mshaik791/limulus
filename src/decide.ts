import { randomUUID } from "node:crypto";
import { runChecks } from "./checks.ts";
import { lastRecord, readChain, sealAndAppend, sha256 } from "./record.ts";
import type { DecisionOutcome, DecisionRecord, DecisionRequest } from "./types.ts";

/** Invoices already released, used for the duplicate check. */
function paidInvoiceIds(): Set<string> {
  return new Set(
    readChain()
      .filter((r) => r.outcome === "released")
      .map((r) => r.declaration.invoiceId),
  );
}

/**
 * Runs the three-way match and the fraud checks, then seals the decision.
 *
 * A failed check holds the payment. A check that needs a person escalates it.
 * Only a clean run releases.
 */
export function decide(request: DecisionRequest): DecisionRecord {
  const { authorization, declaration, paymentOrder, documents } = request;

  const checks = runChecks(authorization, declaration, paymentOrder, documents, paidInvoiceIds());

  const failed = checks.filter((c) => c.status === "fail");
  const review = checks.filter((c) => c.status === "review");

  let outcome: DecisionOutcome = "released";
  if (failed.length > 0) outcome = "held";
  else if (review.length > 0) outcome = "escalated";

  const reasons =
    outcome === "released"
      ? ["authorization, declaration and payment order agree; all checks passed"]
      : [...failed, ...review].map((c) => `${c.name}: ${c.detail}`);

  const previous = lastRecord();

  return sealAndAppend({
    id: `dec_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    createdAt: new Date().toISOString(),
    outcome,
    reasons,
    checks,
    authorization,
    declaration,
    paymentOrder,
    documentHashes: documents.map((d) => ({
      name: d.name,
      sha256: sha256(`${d.text ?? ""}${d.hiddenText ?? ""}`),
    })),
    prevHash: previous ? previous.hash : null,
  });
}

/** Short, human-readable summary used by the CLI demo and the API. */
export function summarize(record: DecisionRecord): string {
  const verdict = record.outcome.toUpperCase();
  const lines = [
    `${verdict}  ${record.declaration.currency} ${record.declaration.amount.toLocaleString("en-US", {
      minimumFractionDigits: 2,
    })} to ${record.declaration.payeeName} (${record.id})`,
  ];
  for (const check of record.checks) {
    const mark =
      check.status === "pass" ? "pass" : check.status === "fail" ? "FAIL" : check.status === "review" ? "review" : "skip";
    lines.push(`  ${mark.padEnd(6)} ${check.name}: ${check.detail}`);
  }
  return lines.join("\n");
}
