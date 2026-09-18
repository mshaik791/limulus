import { runSuite } from "./sandbox/lab.ts";
import { referenceToolAgents } from "./sandbox/agents.ts";
import { checkScope, readQualifications } from "./qualification.ts";
import { gatePayment } from "./rails/gate.ts";
import { recordSettlement, verifyOutcomeForDecision } from "./outcome.ts";
import { buildReceipt, verifyReceipt } from "./receipt.ts";
import { verifyChain } from "./record.ts";
import type { Authorization, DecisionRequest } from "./types.ts";

// Walks the whole arc in one pass — test, qualify, protect, prove — so the
// claim that the four stages connect can be checked rather than asserted.
//
//   node --env-file=.env src/flow-check.ts

const line = (s = "") => console.log(s);
const step = (n: number, title: string) => {
  line();
  line(`${"─".repeat(72)}`);
  line(`  ${n}.  ${title}`);
  line(`${"─".repeat(72)}`);
};

const stamp = Date.now().toString().slice(-6);
const invoiceId = `INV-F${stamp}`;
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

// ---------------------------------------------------------------- 1. test
step(1, "TEST — run the agent through the Lab");
const { run, qualification } = await runSuite(referenceToolAgents.careful, {
  trials: 3,
  // A selftest re-runs by design, which is a retake, not a fresh measurement.
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

line(`  agent      ${run.agent.name} v${run.agent.version}`);
line(`  suite      ${run.suite.id} ${run.suite.version}, ${run.suite.scenarioCount} scenarios x ${run.suite.trials} trials`);
line(`  safety     ${run.axes.safety.score}`);
line(`  capability ${run.axes.capability.score}`);
line(`  recovery   ${run.axes.recovery.score}`);
line(`  reliability ${run.axes.reliability?.score ?? "not measured"}`);
line(`  level      ${run.axes.level}`);
line(`  sealed     ${run.id}`);

// ------------------------------------------------------------- 2. qualify
step(2, "QUALIFY — bind a scope to that exact agent, and make it expire");
if (!qualification) {
  line("  no qualification issued");
  process.exit(1);
}
line(`  id         ${qualification.id}`);
line(`  level      ${qualification.level}`);
line(`  cleared    ${qualification.binding.workflow} / ${qualification.binding.rail} / up to ${qualification.binding.amountLimit.toLocaleString()} ${qualification.binding.currency} / vendors ${qualification.binding.payeeScope}`);
line(`  bound to   ${qualification.binding.agent.name} v${qualification.binding.agent.version}, tools ${qualification.binding.agent.toolConfigHash.slice(0, 12)}`);
line(`  expires    ${qualification.expiresAt.slice(0, 10)}`);

const inScope = checkScope(qualification.id, {
  agentName: qualification.binding.agent.name,
  agentVersion: qualification.binding.agent.version,
  workflow: "invoice-payment",
  rail: "ach",
  currency: "USD",
  amount,
  payeeOnFile: true,
});
const outOfScope = checkScope(qualification.id, {
  agentName: qualification.binding.agent.name,
  agentVersion: "9.9.9",
  workflow: "invoice-payment",
  rail: "ach",
  currency: "USD",
  amount,
  payeeOnFile: true,
});
line(`  ${amount.toLocaleString()} by the tested version   → ${inScope.withinScope ? "in scope" : "out of scope: " + inScope.codes.join(",")}`);
line(`  the same by an untested version  → ${outOfScope.withinScope ? "in scope" : "out of scope: " + outOfScope.codes.join(",")}`);

// ------------------------------------------------------------- 3. protect
step(3, "PROTECT — hold it at the bank, decide, then approve or cancel");
const gate = await gatePayment({
  request,
  accountId: process.env.INCREASE_ACCOUNT_ID ?? "account_sandbox_demo",
  routingNumber: "101050001",
  accountNumber: "987654321",
  qualificationId: qualification.id,
  agent: { name: qualification.binding.agent.name, version: qualification.binding.agent.version },
});
line(`  rail       ${gate.rail.name} (${gate.rail.mode})`);
line(`  transfer   ${gate.transfer.id}`);
line(`  status     ${gate.transfer.statusBefore} → ${gate.transfer.statusAfter}`);
line(`  verdict    ${gate.verdict.verdict}`);
line(`  ${gate.action}`);

// ---------------------------------------------------------- 4. monitor
step(4, "MONITOR — check what the rail actually did against what we allowed");
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
line(`  outcome    ${outcome.status}`);
line(`  findings   ${outcome.findings.length === 0 ? "none — settled as allowed" : outcome.findings.map((f) => f.code).join(", ")}`);

// ------------------------------------------------------------- 5. prove
step(5, "PROVE — a receipt anyone can check without us");
const receipt = buildReceipt(gate.verdict.decisionId);
const check = verifyReceipt(receipt);
const chain = verifyChain();
line(`  receipt    ${receipt.receiptId}, ${JSON.stringify(receipt).length} bytes`);
line(`  verifies   ${check.valid ? "yes, offline, from the receipt and its public key alone" : "NO"}`);
line(`  chain      ${chain.count} records, ${chain.ok ? "verified" : "BROKEN"}`);

line();
line(`${"─".repeat(72)}`);
line(`  test → qualify → protect → monitor → prove`);
line(`  ${run.id}  ${qualification.id}  ${gate.transfer.id}  ${receipt.receiptId}`);
line(`${"─".repeat(72)}`);
line();
