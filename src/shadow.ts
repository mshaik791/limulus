import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeReference, runChecks } from "./checks.ts";
import { canonical, publicKeyPem, sha256, signHash, verifySignature } from "./record.ts";
import { loadAuthorization, policyId } from "./policy-store.ts";
import { ingestEvent } from "./monitor.ts";
import type { Authorization, CheckResult, Declaration, DecisionOutcome, Document, PaymentOrder } from "./types.ts";

// Shadow mode: the customer's production decisions, re-decided by us, with no
// authority to change any of them.
//
// A customer sends what their agent declared, what reached their rail, and what
// their own controls did about it. We run the same three-way match the gate
// runs and record what we would have done. The record says "agree" or "would
// have held", never "held": nothing here touches a payment, and the money in an
// exposure figure is the customer's payment that their system released, not
// ours.
//
// The point of the mode is the disagreement list. "Production released it, we
// would have held it, and here is the check that failed" is the sentence that
// earns the right to sit in the enforcement path later. So is the other
// direction: "we would have held it and a person reviewed it as a false
// positive" is what tunes the checks before they can block anything.
//
// History is kept separately from the real decision chain. The duplicate and
// similar-payment checks need to know what this customer has already released,
// and that is what their production events say, not what our gate released.

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.LIMULUS_DATA_DIR ?? join(here, "..", "data");
const shadowPath = join(dataDir, "shadow.jsonl");

export type ProductionOutcome = "released" | "held" | "escalated";

export type ShadowInput = {
  /** The customer's agent, so events from several agents can be told apart. */
  agentId?: string;
  /** Customer org. Defaults to "default". */
  org?: string;
  /** What a person authorized. Defaults to the stored policy for this deployment. */
  authorization?: Authorization;
  declaration: Declaration;
  paymentOrder: PaymentOrder;
  documents?: Document[];
  /** What the customer's own system did with this payment. */
  production: { outcome: ProductionOutcome; reference?: string; at?: string };
};

/**
 * How our answer relates to production's.
 *
 * `agree` covers both "both released" and "both stopped it" — held versus
 * escalated is a difference of process, not of whether money moved.
 */
export type Agreement = "agree" | "would_have_held" | "would_have_escalated" | "would_have_released";

export type ShadowReview = { verdict: "false_positive" | "confirmed" | "unsure"; note: string; at: string };

export type ShadowRecord = {
  kind: "limulus.shadow.v1";
  id: string;
  createdAt: string;
  agentId: string;
  org: string;
  wouldHave: DecisionOutcome;
  production: ShadowInput["production"];
  agreement: Agreement;
  checks: CheckResult[];
  reasons: string[];
  /**
   * The production payment's amount, when production released it and we would
   * not have. This is money the customer's system moved; it is reported as
   * what we would have stopped, never as a loss.
   */
  exposure: number | null;
  payment: { payeeName: string; payeeAccountLast4: string; amount: number; currency: string; invoiceId: string; rail: PaymentOrder["rail"] };
  authorizationPolicyId: string;
  documentHashes: { name: string; sha256: string }[];
  review?: ShadowReview;
  prevHash: string | null;
  hash: string;
  signature: string;
  publicKey: string;
};

export function readShadow(): ShadowRecord[] {
  if (!existsSync(shadowPath)) return [];
  return readFileSync(shadowPath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ShadowRecord);
}

function agreementOf(production: ProductionOutcome, ours: DecisionOutcome): Agreement {
  const prodMoved = production === "released";
  const oursMoved = ours === "released";
  if (prodMoved === oursMoved) return "agree";
  if (prodMoved) return ours === "held" ? "would_have_held" : "would_have_escalated";
  return "would_have_released";
}

/** Sealed without the review, so a later review does not break the chain. */
function seal(body: Omit<ShadowRecord, "hash" | "signature" | "publicKey" | "review">): ShadowRecord {
  const hash = sha256(canonical(body));
  return { ...body, hash, signature: signHash(hash), publicKey: publicKeyPem };
}

export function evaluateShadow(input: ShadowInput): ShadowRecord {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const authorization = input.authorization ?? loadAuthorization();
  const documents = input.documents ?? [];
  const org = input.org ?? "default";
  const agentId = input.agentId ?? input.declaration.agentId;

  // What this customer has already released, from their own events.
  const released = readShadow().filter((r) => r.org === org && r.production.outcome === "released");
  const paidInvoiceIds = new Set(released.map((r) => normalizeReference(r.payment.invoiceId)));
  const recent = released.map((r) => ({ payeeName: r.payment.payeeName, amount: r.payment.amount, at: r.production.at ?? r.createdAt }));

  const checks = runChecks(authorization, input.declaration, input.paymentOrder, documents, paidInvoiceIds, recent);
  const failed = checks.filter((c) => c.status === "fail");
  const review = checks.filter((c) => c.status === "review");
  const wouldHave: DecisionOutcome = failed.length > 0 ? "held" : review.length > 0 ? "escalated" : "released";
  const reasons =
    wouldHave === "released"
      ? ["authorization, declaration and payment order agree; all checks passed"]
      : [...failed, ...review].map((c) => `${c.name}: ${c.detail}`);
  const agreement = agreementOf(input.production.outcome, wouldHave);

  const previous = readShadow().at(-1) ?? null;
  const record = seal({
    kind: "limulus.shadow.v1",
    id: `shd_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    createdAt: new Date().toISOString(),
    agentId,
    org,
    wouldHave,
    production: input.production,
    agreement,
    checks,
    reasons,
    exposure: agreement === "would_have_held" || agreement === "would_have_escalated" ? input.paymentOrder.amount : null,
    payment: {
      payeeName: input.paymentOrder.payeeName,
      payeeAccountLast4: input.paymentOrder.payeeAccountLast4,
      amount: input.paymentOrder.amount,
      currency: input.paymentOrder.currency,
      invoiceId: input.declaration.invoiceId,
      rail: input.paymentOrder.rail,
    },
    authorizationPolicyId: policyId(authorization),
    documentHashes: documents.map((d) => ({ name: d.name, sha256: sha256(`${d.text}\n${d.hiddenText ?? ""}`) })),
    prevHash: previous ? previous.hash : null,
  });
  appendFileSync(shadowPath, `${JSON.stringify(record)}\n`);

  // The Monitor sees every shadow decision, so a disagreement can become a
  // candidate scenario through the same review queue as everything else.
  ingestEvent({
    type: "shadow_decision",
    agentId,
    configHash: policyId(authorization),
    runId: input.production.reference ?? record.id,
    org,
    payload: {
      shadowId: record.id,
      production: input.production.outcome,
      wouldHave,
      agreement,
      codes: failed.map((c) => c.id),
      // Shape, not values: the amount is not copied into the event.
    },
  });

  return record;
}

/** A person's verdict on a disagreement. Recorded beside the sealed body, never inside it. */
export function reviewShadow(id: string, verdict: ShadowReview["verdict"], note: string): ShadowRecord | null {
  const all = readShadow();
  const target = all.find((r) => r.id === id);
  if (!target) return null;
  if (!note || note.trim().length < 3) throw new Error("A review needs a note: what the person found.");
  const reviewed: ShadowRecord = { ...target, review: { verdict, note, at: new Date().toISOString() } };
  writeFileSync(shadowPath, all.map((r) => JSON.stringify(r.id === id ? reviewed : r)).join("\n") + "\n");
  return reviewed;
}

export function verifyShadowRecord(record: ShadowRecord): { ok: boolean; problems: string[] } {
  const { hash, signature, publicKey, review: _review, ...body } = record;
  const problems: string[] = [];
  if (sha256(canonical(body)) !== hash) problems.push("hash does not match the record body");
  if (!verifySignature(hash, signature, publicKey)) problems.push("signature does not verify");
  return { ok: problems.length === 0, problems };
}

export function verifyShadowChain(records = readShadow()): { ok: boolean; count: number; problems: { id: string; problem: string }[] } {
  const problems: { id: string; problem: string }[] = [];
  let prev: string | null = null;
  for (const r of records) {
    for (const p of verifyShadowRecord(r).problems) problems.push({ id: r.id, problem: p });
    if (r.prevHash !== prev) problems.push({ id: r.id, problem: `prevHash ${r.prevHash} does not link to ${prev}` });
    prev = r.hash;
  }
  return { ok: problems.length === 0, count: records.length, problems };
}

export type Counted = { value: number; of: number };

export type ShadowSummary = {
  org: string;
  evaluated: number;
  agreed: Counted;
  wouldHaveHeld: Counted;
  wouldHaveEscalated: Counted;
  wouldHaveReleased: Counted;
  /** Sum of production amounts we would have stopped, and how many payments that is. The customer's money, released by their system. */
  exposureWeWouldHaveStopped: { amount: number; payments: number; currency: string | null };
  reviewed: { falsePositives: number; confirmed: number; unsure: number; of: number };
  /** false positives / reviewed disagreements. null until a person has reviewed one. */
  falsePositiveRate: Counted | null;
  /** The checks that fired most often where we disagreed. */
  topChecks: { id: string; name: string; count: number }[];
  note: string;
};

export function shadowSummary(org = "default", records = readShadow()): ShadowSummary {
  const rs = records.filter((r) => r.org === org);
  const n = rs.length;
  const by = (a: Agreement) => rs.filter((r) => r.agreement === a);
  const disagreements = rs.filter((r) => r.agreement !== "agree");
  const reviewed = disagreements.filter((r) => r.review);
  const stopped = rs.filter((r) => r.exposure !== null);
  const currencies = new Set(stopped.map((r) => r.payment.currency));

  const counts = new Map<string, { name: string; count: number }>();
  for (const r of disagreements) {
    for (const c of r.checks.filter((x) => x.status === "fail" || x.status === "review")) {
      const e = counts.get(c.id) ?? { name: c.name, count: 0 };
      e.count++;
      counts.set(c.id, e);
    }
  }

  return {
    org,
    evaluated: n,
    agreed: { value: by("agree").length, of: n },
    wouldHaveHeld: { value: by("would_have_held").length, of: n },
    wouldHaveEscalated: { value: by("would_have_escalated").length, of: n },
    wouldHaveReleased: { value: by("would_have_released").length, of: n },
    exposureWeWouldHaveStopped: {
      amount: stopped.reduce((s, r) => s + (r.exposure ?? 0), 0),
      payments: stopped.length,
      currency: currencies.size === 1 ? [...currencies][0] : null,
    },
    reviewed: {
      falsePositives: reviewed.filter((r) => r.review!.verdict === "false_positive").length,
      confirmed: reviewed.filter((r) => r.review!.verdict === "confirmed").length,
      unsure: reviewed.filter((r) => r.review!.verdict === "unsure").length,
      of: disagreements.length,
    },
    falsePositiveRate: reviewed.length ? { value: reviewed.filter((r) => r.review!.verdict === "false_positive").length, of: reviewed.length } : null,
    topChecks: [...counts].map(([id, e]) => ({ id, ...e })).sort((a, b) => b.count - a.count).slice(0, 5),
    note:
      "Shadow mode observes. Nothing here held, released or touched a payment; every outcome above is the customer's own system's. " +
      "Exposure is the amount of payments production released that the three-way match would have stopped.",
  };
}

export const shadowFile = shadowPath;
