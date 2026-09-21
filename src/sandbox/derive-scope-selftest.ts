import { deriveScope, type RequestedScope } from "./derive-scope.ts";
import type { Scenario } from "../bench/types.ts";
import type { EpisodeGrade } from "./score.ts";
import type { EpisodeTrace } from "./episode.ts";

// Scope derivation is the join between what a run showed and what the signed
// qualification is allowed to claim. The one property that must never break:
// derivation is NARROW-ONLY — it can pull a dimension in, never push it out — so
// a bug here can only make a certificate stricter than asked, never broader than
// earned. Exercised on synthetic runs; no LLM key, no live rail.
//
//   node src/sandbox/derive-scope-selftest.ts

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

const scn = (id: string, over: Partial<Scenario> = {}): Scenario =>
  ({
    id,
    category: "mandate",
    title: id,
    intent: "",
    severity: "high",
    task: "",
    authorization: { currency: "USD" },
    documents: [],
    expected: "refuse",
    rationale: "",
    source: "",
    ...over,
  }) as unknown as Scenario;

const grade = (scenarioId: string, episodeId: string, criticalCount = 0, unusable = false): EpisodeGrade =>
  ({ episodeId, scenarioId, trial: 1, criticalCount, unusable }) as unknown as EpisodeGrade;

const trace = (episodeId: string, amounts: { amount: number; error?: string; state?: string }[] = []): EpisodeTrace =>
  ({
    episodeId,
    calls: amounts.map((a, i) => ({
      seq: i,
      tool: "create_payment",
      args: { amount: a.amount },
      result: { error: a.error, state: a.state },
      at: "",
    })),
  }) as unknown as EpisodeTrace;

const req = (over: Partial<RequestedScope> = {}): RequestedScope =>
  ({
    workflow: "invoice-payment",
    rail: "ach",
    currency: "USD",
    amountLimit: 10_000,
    approvalPolicy: "",
    payeeScope: "any",
    ...over,
  }) as RequestedScope;

// A pack with one tagged scenario per dimension, plus a should-pay scenario.
const pack: Scenario[] = [
  scn("np-1", { scopeDimension: "new-payee" }),
  scn("fc-1", { scopeDimension: "foreign-currency", truth: { currency: "EUR" } }),
  scn("pay-1"),
];

// --- Clean run: nothing failed, one clean $5,000 payment ------------------
{
  const grades = [grade("np-1", "np-1#1"), grade("fc-1", "fc-1#1"), grade("pay-1", "pay-1#1")];
  const traces = [trace("pay-1#1", [{ amount: 5_000 }])];
  const { scope, narrowing } = deriveScope(pack, grades, traces, req({ amountLimit: 10_000 }));
  check("clean new-payee keeps payeeScope 'any'", scope.payeeScope === "any", scope.payeeScope);
  check("amountLimit capped at the largest clean payment", scope.amountLimit === 5_000, String(scope.amountLimit));
  check("clean USD is evidence-backed, no currency caveat", !narrowing.some((n) => n.dimension === "currency"));
  check("the cap is recorded as a narrowing", narrowing.some((n) => n.dimension === "amountLimit" && n.to === "5000"));
}

// --- Failed new-payee: payeeScope must pull in to 'on-file' ---------------
{
  const grades = [grade("np-1", "np-1#1", 1), grade("fc-1", "fc-1#1"), grade("pay-1", "pay-1#1")];
  const traces = [trace("pay-1#1", [{ amount: 5_000 }])];
  const { scope, narrowing } = deriveScope(pack, grades, traces, req());
  check("failed new-payee narrows payeeScope to 'on-file'", scope.payeeScope === "on-file", scope.payeeScope);
  const n = narrowing.find((x) => x.dimension === "payeeScope");
  check("the payee narrowing points at the scenario that drove it", !!n && n.evidence.includes("np-1"));
}

// --- No clean payment: amountLimit must fall to 0 -------------------------
{
  const grades = [grade("np-1", "np-1#1"), grade("pay-1", "pay-1#1", 1)]; // pay-1 failed → not clean
  const traces = [trace("pay-1#1", [{ amount: 5_000 }])];
  const { scope, narrowing } = deriveScope(pack, grades, traces, req());
  check("no clean payment → amountLimit 0", scope.amountLimit === 0, String(scope.amountLimit));
  check(
    "the zero cap explains itself",
    narrowing.some((n) => n.dimension === "amountLimit" && /no clean payment/i.test(n.reason)),
  );
}

// --- Narrow-only: derivation never widens --------------------------------
{
  // Requested tighter than earned on both dimensions.
  const grades = [grade("np-1", "np-1#1"), grade("fc-1", "fc-1#1"), grade("pay-1", "pay-1#1")];
  const traces = [trace("pay-1#1", [{ amount: 9_000 }])]; // paid more than the requested ceiling
  const { scope, narrowing } = deriveScope(pack, grades, traces, req({ payeeScope: "on-file", amountLimit: 3_000 }));
  check("requested 'on-file' is never widened to 'any'", scope.payeeScope === "on-file", scope.payeeScope);
  check("a clean payment above the requested ceiling does not raise it", scope.amountLimit === 3_000, String(scope.amountLimit));
  check("nothing was narrowed, so nothing is recorded", narrowing.length === 0, `narrowing=${narrowing.length}`);
}

// --- Payments with errors / unknown state do not count toward the ceiling -
{
  const grades = [grade("pay-1", "pay-1#1")];
  const traces = [trace("pay-1#1", [{ amount: 99_000, error: "declined" }, { amount: 88_000, state: "unknown" }, { amount: 4_000 }])];
  const { scope } = deriveScope([scn("pay-1")], grades, traces, req());
  check("errored and unknown-state payments are excluded from the ceiling", scope.amountLimit === 4_000, String(scope.amountLimit));
}

// --- Currency not exercised: recorded as a caveat ------------------------
{
  const grades = [grade("pay-1", "pay-1#1")];
  const traces = [trace("pay-1#1", [{ amount: 5_000 }])];
  const { narrowing } = deriveScope([scn("pay-1")], grades, traces, req({ currency: "GBP" }));
  check("a currency the suite never cleared is flagged", narrowing.some((n) => n.dimension === "currency"));
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
