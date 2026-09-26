import "./selftest-env.ts";
import { runSuite } from "./sandbox/lab.ts";
import { referenceToolAgents } from "./sandbox/agents.ts";
import { checkScope } from "./qualification.ts";
import { gatePayment } from "./rails/gate.ts";
import { recordSettlement, verifyOutcomeForDecision } from "./outcome.ts";
import { buildReceipt, verifyReceipt } from "./receipt.ts";
import { verifyChain } from "./record.ts";
import { loadScenarioDir } from "./bench/scenario-file.ts";
import type { Authorization, DecisionRequest } from "./types.ts";

// End to end, as a test rather than a demonstration.
//
//   node src/e2e.ts
//   node --env-file=.env src/e2e.ts --require-real-rail
//
// src/flow-check.ts already walked this arc, and it is a good narrated demo. It
// is not a test: at line 179 it prints "NO" when the receipt fails to verify and
// then exits 0. Offline receipt verification is the product's entire claim, so
// the one property most worth guarding was the one that could break silently in
// the middle of a wall of passing output.
//
// The difference here is that every line below is an assertion, and three kinds
// of thing are checked that a narrated walk does not reach:
//
//   The seams. Not "a qualification was issued" and separately "a payment was
//   gated", but that the verdict names *that* qualification, the receipt covers
//   *that* decision, and the settlement matches *that* payment. Stages that each
//   work while being wired to the wrong thing is the classic integration failure,
//   and printing both stages' output does not catch it.
//
//   The negatives. A gate that allows everything passes every positive test.
//   So: an amount over the ceiling must be refused, an untested agent version
//   must be refused, and a tampered receipt must fail to verify. Each of these
//   would be invisible in a demo, because a demo only shows the happy path.
//
//   Whether the rail was real. With no INCREASE_API_KEY this runs against a
//   simulated rail, which is legitimate for CI and worthless as evidence that a
//   bank accepted anything. It is stated in the output either way, and
//   --require-real-rail turns a simulated run into a failure, so "we tested it
//   end to end" cannot quietly mean "we tested it against ourselves".

const requireRealRail = process.argv.includes("--require-real-rail");

let failures = 0;
const results: { label: string; ok: boolean; detail: string }[] = [];

const check = (label: string, ok: boolean, detail = "") => {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

const stage = (n: number, title: string) => {
  console.log(`\n  ${n}. ${title}`);
};

const stamp = Date.now().toString().slice(-6);
const invoiceId = `INV-E${stamp}`;
const amount = 3_400;

const vendor = {
  vendorId: "VEN-3312",
  name: "Northline Steel",
  accountLast4: "2210",
  bankDetailsUpdated: "2024-03-02",
  callbackPhone: "+1-555-0142",
};

const authorization: Authorization = {
  policyVersion: "v12",
  principal: "j.ortiz@midwestfab.example",
  task: "Pay approved invoices from approved vendors",
  limitPerPayment: 75_000,
  currency: "USD",
  approvedVendors: [vendor],
  approvedInvoices: [{ invoiceId, approvedBy: "j.ortiz", amount, poId: "PO-44812" }],
  requiredChecks: [
    "vendor_approved",
    "within_limit",
    "invoice_approved",
    "declaration_matches_order",
    "payee_account",
    "duplicate",
    "embedded_instructions",
  ],
};

const request: DecisionRequest = {
  authorization,
  declaration: {
    agentId: "reference-careful-tools",
    payeeName: vendor.name,
    payeeAccountLast4: vendor.accountLast4,
    amount,
    currency: "USD",
    invoiceId,
    poId: "PO-44812",
    reason: `Approved invoice ${invoiceId}`,
    sources: [{ name: `${invoiceId}.pdf`, sha256: "declared" }],
  },
  paymentOrder: {
    rail: "ach",
    payeeName: vendor.name,
    payeeAccountLast4: vendor.accountLast4,
    amount,
    currency: "USD",
    reference: invoiceId,
  },
  documents: [
    {
      name: `${invoiceId}.pdf`,
      type: "invoice",
      text: `Northline Steel. Invoice ${invoiceId}. PO 44812. Total USD ${amount.toLocaleString()}.00. Remit to account on file.`,
    },
  ],
};

console.log(`\n  Limulus end to end — every stage asserted\n`);

// ------------------------------------------------------------- 0. authoring
stage(0, "AUTHOR — scenarios load from files");
{
  const { scenarios, problems } = loadScenarioDir("scenarios");
  const errors = problems.filter((p) => p.severity === "error");
  check("the shipped scenario files are valid", errors.length === 0, `${errors.length} error(s)`);
  check("the suite is not empty", scenarios.length > 0, `${scenarios.length} scenario(s)`);
}

// ------------------------------------------------------------------ 1. test
stage(1, "TEST — the Lab runs the agent and seals the result");
const { run, qualification } = await runSuite(referenceToolAgents.careful, {
  trials: 3,
  // A test re-runs by design, which is a retake rather than a fresh measurement.
  allowRetake: true,
  qualifyFor: {
    workflow: "invoice-payment",
    rail: "ach",
    currency: "USD",
    amountLimit: 5_000,
    approvalPolicy: "A person approves anything above the ceiling or off the vendor file.",
    payeeScope: "on-file",
  },
});

check("a run was produced and sealed", Boolean(run?.id), run?.id ?? "none");
check("every episode was usable", run.axes.unusableEpisodes === 0, `${run.axes.unusableEpisodes} unusable`);
check(
  "the four axes were all scored",
  [run.axes.safety, run.axes.capability, run.axes.recovery].every((a) => typeof a.score === "number"),
  `safety ${run.axes.safety.score} capability ${run.axes.capability.score} recovery ${run.axes.recovery.score}`,
);
check(
  "reliability was measured, since more than one trial ran",
  run.axes.reliability !== null,
  `${run.suite.trials} trials`,
);

// --------------------------------------------------------------- 2. qualify
stage(2, "QUALIFY — a scope bound to that exact agent");
if (!qualification) {
  check("a qualification was issued", false, "none — the remaining stages cannot run");
  console.log(`\n  ${failures} check(s) failed\n`);
  process.exit(1);
}
check("a qualification was issued", true, qualification.id);
check(
  "it is bound to the agent that was actually run",
  qualification.binding.agent.name === run.agent.name && qualification.binding.agent.version === run.agent.version,
  `${qualification.binding.agent.name} v${qualification.binding.agent.version}`,
);
check(
  "it is bound to the suite that was actually run",
  qualification.binding.suite.id === run.suite.id,
  `${qualification.binding.suite.id} vs run ${run.suite.id}`,
);
check("it expires", Boolean(qualification.expiresAt), qualification.expiresAt?.slice(0, 10) ?? "never");

// The negatives. A scope check that returns "in scope" unconditionally passes
// every positive test above, so each refusal is checked explicitly.
const scopeReq = {
  agentName: qualification.binding.agent.name,
  agentVersion: qualification.binding.agent.version,
  workflow: "invoice-payment",
  rail: "ach" as const,
  currency: "USD",
  payeeOnFile: true,
};

const inScope = checkScope(qualification.id, { ...scopeReq, amount });
const overCeiling = checkScope(qualification.id, { ...scopeReq, amount: qualification.binding.amountLimit + 1 });
const wrongVersion = checkScope(qualification.id, { ...scopeReq, agentVersion: "9.9.9", amount });
const offFile = checkScope(qualification.id, { ...scopeReq, amount, payeeOnFile: false });
const wrongRail = checkScope(qualification.id, { ...scopeReq, rail: "wire" as never, amount });

// A clean payment at a level that does not clear release is still refused, and
// that is correct: shadow-ready means observe, not pay. So the assertion is not
// "in scope" — it is that the only thing standing in the way is the readiness
// level, and none of the scope checks themselves objected. Asserting plain
// "in scope" here fails against a correct system, which is what the first
// version of this test did.
const SCOPE_CODES = ["amount_above_qualified_limit", "payee_not_on_file", "rail_not_qualified", "currency_not_qualified", "workflow_not_qualified", "qualification_expired", "qualification_revoked"];
const scopeObjections = inScope.codes.filter((c) => SCOPE_CODES.includes(c));
check(
  `${amount.toLocaleString()} by the tested version draws no scope objection`,
  scopeObjections.length === 0,
  scopeObjections.join(",") || `held only by: ${inScope.codes.join(",") || "nothing"}`,
);
check(
  "a level below release is what holds a clean payment, and it says so",
  inScope.withinScope || inScope.codes.includes("level_not_cleared_for_release"),
  `level ${qualification.level}, codes ${inScope.codes.join(",") || "none"}`,
);
check(
  "a payment over the qualified ceiling is refused",
  !overCeiling.withinScope,
  overCeiling.codes.join(",") || "ALLOWED — the ceiling does nothing",
);
check(
  "an untested agent version is refused",
  !wrongVersion.withinScope && wrongVersion.codes.includes("agent_version_changed"),
  wrongVersion.codes.join(","),
);
check("a payee not on file is refused", !offFile.withinScope, offFile.codes.join(","));
check("a rail the qualification does not cover is refused", !wrongRail.withinScope, wrongRail.codes.join(","));

// --------------------------------------------------------------- 3. protect
stage(3, "PROTECT — held at the bank before anything settles");
const gate = await gatePayment({
  request,
  accountId: process.env.INCREASE_ACCOUNT_ID ?? "account_sandbox_demo",
  routingNumber: "101050001",
  accountNumber: "987654321",
  qualificationId: qualification.id,
  agent: { name: qualification.binding.agent.name, version: qualification.binding.agent.version },
});

const realRail = gate.rail.mode !== "simulated";
console.log(`        rail: ${gate.rail.name} (${gate.rail.mode})`);
check("a transfer was created", Boolean(gate.transfer.id), gate.transfer.id);
check(
  "the payment was held rather than sent straight through",
  gate.transfer.statusBefore === "pending_approval",
  `${gate.transfer.statusBefore} → ${gate.transfer.statusAfter}`,
);
check(
  "a verdict was reached",
  ["ALLOW", "BLOCK", "ESCALATE", "WAIT"].includes(gate.verdict.verdict),
  gate.verdict.verdict,
);
check("the decision was signed", Boolean(gate.verdict.signature && gate.verdict.decisionHash));

// The seam. Two stages that each work while wired to the wrong thing is the
// integration failure a narrated walk cannot see.
check(
  "the verdict names the qualification this run issued",
  gate.verdict.qualification?.id === qualification.id,
  `${gate.verdict.qualification?.id ?? "none"} vs ${qualification.id}`,
);

if (requireRealRail) {
  check("the rail was a real bank, not the simulator", realRail, gate.rail.mode);
} else if (!realRail) {
  console.log(`        note: simulated rail. Pass --require-real-rail with a key in the env to demand a real one.`);
}

// --------------------------------------------------------------- 4. monitor
stage(4, "MONITOR — what the rail did against what was allowed");
recordSettlement({
  decisionId: gate.verdict.decisionId,
  status: "settled",
  amount,
  currency: "USD",
  payeeAccountLast4: vendor.accountLast4,
  railReference: gate.transfer.id,
  occurredAt: new Date().toISOString(),
});
const outcome = verifyOutcomeForDecision(gate.verdict.decisionId);
check(
  "a settlement matching the decision reconciles clean",
  outcome.status === "verified" && outcome.findings.length === 0,
  `${outcome.status}${outcome.findings.length ? `: ${outcome.findings.map((f) => f.code).join(",")}` : ""}`,
);

// Reconciliation only means something if a mismatch is caught. Same decision,
// a different amount than was allowed.
recordSettlement({
  decisionId: gate.verdict.decisionId,
  status: "settled",
  amount: amount * 3,
  currency: "USD",
  payeeAccountLast4: vendor.accountLast4,
  railReference: `${gate.transfer.id}-tampered`,
  occurredAt: new Date().toISOString(),
});
const mismatched = verifyOutcomeForDecision(gate.verdict.decisionId);
check(
  "a settlement for the wrong amount is flagged",
  mismatched.findings.length > 0,
  mismatched.findings.map((f) => f.code).join(",") || "NOT FLAGGED — reconciliation is decorative",
);

// ----------------------------------------------------------------- 5. prove
stage(5, "PROVE — a receipt that verifies without us");
const receipt = buildReceipt(gate.verdict.decisionId);
const verified = verifyReceipt(receipt);
const chain = verifyChain();

check("a receipt was built", Boolean(receipt?.receiptId), receipt?.receiptId ?? "none");
check(
  "the receipt covers the decision that was actually made",
  receipt.decision.id === gate.verdict.decisionId,
  `${receipt.decision.id} vs ${gate.verdict.decisionId}`,
);
check(
  "the receipt verifies offline",
  verified.valid,
  verified.valid ? "" : verified.checks.filter((c) => !c.ok).map((c) => c.name).join("; "),
);
check("the record chain verifies", chain.ok, `${chain.count} records`);

// The property that makes a receipt worth anything: it must stop verifying when
// it stops being true. Without this, "verifies offline" only means the verifier
// returns true.
{
  const tampered = JSON.parse(JSON.stringify(receipt)) as typeof receipt;
  tampered.payment.amount = amount * 10;
  const after = verifyReceipt(tampered);
  check(
    "a receipt with the amount altered fails to verify",
    !after.valid,
    after.valid ? "STILL VALID — the signature does not cover the amount" : "rejected",
  );

  const reasonsChanged = JSON.parse(JSON.stringify(receipt)) as typeof receipt;
  reasonsChanged.decision.outcome = reasonsChanged.decision.outcome === "allow" ? "block" : "allow";
  const after2 = verifyReceipt(reasonsChanged);
  check(
    "a receipt with the outcome flipped fails to verify",
    !after2.valid,
    after2.valid ? "STILL VALID — the signature does not cover the outcome" : "rejected",
  );
}

// -------------------------------------------------------------------- report
const passed = results.filter((r) => r.ok).length;
console.log(`\n  ${"─".repeat(68)}`);
console.log(`  test → qualify → protect → monitor → prove`);
console.log(`  ${run.id}  ${qualification.id}  ${gate.transfer.id}  ${receipt.receiptId}`);
console.log(`  rail: ${gate.rail.name} (${gate.rail.mode})${realRail ? "" : " — not evidence a bank accepted anything"}`);
console.log(`  ${"─".repeat(68)}`);
console.log(`\n  ${passed}/${results.length} checks passed`);

if (failures > 0) {
  console.log(`\n  ${failures} FAILED:`);
  for (const r of results.filter((x) => !x.ok)) console.log(`    ${r.label}  ${r.detail}`);
  console.log("");
  process.exit(1);
}
console.log(`\n  The arc holds end to end.\n`);
