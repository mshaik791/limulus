import "./selftest-env.ts";
import { decide } from "./decide.ts";
import { verdictFor } from "./verdict.ts";
import { recordSettlement } from "./outcome.ts";
import { runSuite } from "./sandbox/lab.ts";
import { referenceToolAgents } from "./sandbox/agents.ts";
import type { Authorization, DecisionRequest } from "./types.ts";

// Checks the four verdicts against built requests, so each path is exercised
// rather than inferred.
//
//   node src/verdict-selftest.ts

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

// A fresh invoice per run, so earlier runs in the local data directory do not
// make everything look like a duplicate.
const stamp = Date.now().toString().slice(-7);
const invoiceId = `INV-V${stamp}`;
const amount = 3_400;

const authorization: Authorization = {
  policyVersion: "v12",
  principal: "j.ortiz@midwestfab.example",
  task: "Pay approved invoices from approved vendors",
  limitPerPayment: 75_000,
  currency: "USD",
  approvedVendors: [
    { vendorId: "VEN-3312", name: "Northline Steel", accountLast4: "2210", bankDetailsUpdated: "2024-03-02", callbackPhone: "+1-555-0142" },
  ],
  approvedInvoices: [{ invoiceId, approvedBy: "j.ortiz", amount, poId: "PO-44812" }],
  requiredChecks: ["vendor_approved", "within_limit", "invoice_approved", "declaration_matches_order", "payee_account", "duplicate"],
};

const request = (overrides: Partial<DecisionRequest> = {}): DecisionRequest => ({
  authorization,
  declaration: {
    agent: "ap-agent",
    agentVersion: "1.4.2",
    intent: `Pay ${invoiceId}`,
    payeeName: "Northline Steel",
    payeeAccountLast4: "2210",
    amount,
    currency: "USD",
    invoiceId,
    poId: "PO-44812",
    sources: [`${invoiceId}.pdf`],
    declaredAt: new Date().toISOString(),
  },
  paymentOrder: {
    payeeName: "Northline Steel",
    payeeAccountLast4: "2210",
    amount,
    currency: "USD",
    rail: "ach",
    submittedAt: new Date().toISOString(),
  },
  documents: [
    { name: `${invoiceId}.pdf`, type: "invoice", text: `Northline Steel. Invoice ${invoiceId}. PO 44812. Total USD ${amount}.00. Remit to account on file.` },
  ],
  ...overrides,
});

// ---- ALLOW ---------------------------------------------------------------
const clean = verdictFor(decide(request()));
check("a clean payment is allowed", clean.verdict === "ALLOW", `${clean.verdict} ${clean.explanation.map((e) => e.code).join(",")}`);
check("an allowed verdict carries the signed decision", Boolean(clean.decisionHash && clean.signature));

// ---- WAIT ----------------------------------------------------------------
// The same invoice again, with the rail yet to confirm the first payment.
const retry = verdictFor(decide(request()));
check(
  "a retry while the rail has not confirmed returns WAIT, not BLOCK",
  retry.verdict === "WAIT",
  `${retry.verdict} ${retry.explanation.map((e) => e.code).join(",")}`,
);
check("WAIT tells the caller how long to hold off", (retry.retryAfterMs ?? 0) > 0, String(retry.retryAfterMs));

// Once the rail confirms, the same attempt is a genuine duplicate.
recordSettlement({
  decisionId: clean.decisionId,
  status: "settled",
  amount,
  currency: "USD",
  payeeAccountLast4: "2210",
  railReference: `ACH-TRACE-${stamp}`,
  occurredAt: new Date().toISOString(),
});

const afterSettle = verdictFor(decide(request()));
check(
  "once settlement is confirmed the duplicate is blocked",
  afterSettle.verdict === "BLOCK",
  `${afterSettle.verdict} ${afterSettle.explanation.map((e) => e.code).join(",")}`,
);

// ---- BLOCK ---------------------------------------------------------------
const drifted = verdictFor(
  decide(
    request({
      paymentOrder: {
        payeeName: "Northline Steel",
        payeeAccountLast4: "4471",
        amount,
        currency: "USD",
        rail: "ach",
        submittedAt: new Date().toISOString(),
      },
    }),
  ),
);
check(
  "a payment order that differs from the declaration is blocked",
  drifted.verdict === "BLOCK" && drifted.explanation.some((e) => e.code === "execution_drift"),
  drifted.explanation.map((e) => e.code).join(","),
);

// ---- ESCALATE ------------------------------------------------------------
const secondInvoice = `INV-V${stamp}B`;
const escalateAuth: Authorization = {
  ...authorization,
  approvedInvoices: [{ invoiceId: secondInvoice, approvedBy: "j.ortiz", amount: 90_000, poId: "PO-44999" }],
};

// A qualification issued for small ACH payments, then a large one attempted.
const { qualification } = await runSuite(referenceToolAgents.careful, {
  trials: 3,
  // A selftest re-runs by design, which is a retake, not a fresh measurement.
  allowRetake: true,
  qualifyFor: {
    workflow: "invoice-payment",
    rail: "ach",
    currency: "USD",
    amountLimit: 5_000,
    approvalPolicy: "A person approves anything above the ceiling.",
    payeeScope: "on-file",
  },
});

if (!qualification) {
  check("a qualification was issued for the scope test", false);
} else {
  const inScope = verdictFor(
    decide(
      request({
        authorization: { ...authorization, approvedInvoices: [{ invoiceId: `${invoiceId}C`, approvedBy: "j.ortiz", amount: 1_200 }] },
        declaration: { ...request().declaration, invoiceId: `${invoiceId}C`, amount: 1_200 },
        paymentOrder: { ...request().paymentOrder, amount: 1_200 },
        documents: [{ name: "inv.pdf", type: "invoice", text: `Northline Steel. Invoice ${invoiceId}C. Total USD 1,200.00. Remit to account on file.` }],
      }),
    ),
    {
      qualificationId: qualification.id,
      scope: {
        agentName: qualification.binding.agent.name,
        agentVersion: qualification.binding.agent.version,
        identitySource: "key",
        workflow: "invoice-payment",
        rail: "ach",
        payeeOnFile: true,
      },
    },
  );
  // This used to assert ALLOW unconditionally, which quietly assumed the
  // reference agent would earn a level cleared for release. Once qualifications
  // started coming from the held-out pool it stopped earning one — and the
  // assertion was testing the Lab's scoring, not the verdict logic it belongs
  // to. What actually has to hold is narrower and truer: an in-scope payment is
  // never blocked, and it releases exactly when the level permits release.
  const cleared = ["limited-autonomous", "expanded-autonomous"].includes(qualification.level);
  check(
    cleared
      ? "a payment inside the qualified scope is allowed"
      : "a payment inside the qualified scope escalates, because the level does not clear release",
    cleared ? inScope.verdict === "ALLOW" : inScope.verdict === "ESCALATE",
    `level ${qualification.level} -> ${inScope.verdict} ${inScope.explanation.map((e) => e.code).join(",")}`,
  );
  check(
    "an in-scope payment is never blocked outright",
    inScope.verdict !== "BLOCK",
    inScope.verdict,
  );
  check("the verdict names the qualification it relied on", inScope.qualification?.id === qualification.id);

  const overCeiling = verdictFor(
    decide(
      request({
        authorization: escalateAuth,
        declaration: { ...request().declaration, invoiceId: secondInvoice, amount: 90_000 },
        paymentOrder: { ...request().paymentOrder, amount: 90_000 },
        documents: [{ name: "inv.pdf", type: "invoice", text: `Northline Steel. Invoice ${secondInvoice}. Total USD 90,000.00. Remit to account on file.` }],
      }),
    ),
    {
      qualificationId: qualification.id,
      scope: {
        agentName: qualification.binding.agent.name,
        agentVersion: qualification.binding.agent.version,
        identitySource: "key",
        workflow: "invoice-payment",
        rail: "ach",
        payeeOnFile: true,
      },
    },
  );
  // 90,000 is above both the policy limit and the qualified ceiling, so the
  // policy limit blocks it outright. That precedence is deliberate.
  check(
    "a payment above the policy limit is blocked, whatever the qualification says",
    overCeiling.verdict === "BLOCK" && overCeiling.explanation.some((e) => e.code === "amount_above_limit"),
    overCeiling.explanation.map((e) => e.code).join(","),
  );

  const aboveQualifiedOnly = verdictFor(
    decide(
      request({
        authorization: { ...authorization, approvedInvoices: [{ invoiceId: `${invoiceId}D`, approvedBy: "j.ortiz", amount: 20_000 }] },
        declaration: { ...request().declaration, invoiceId: `${invoiceId}D`, amount: 20_000 },
        paymentOrder: { ...request().paymentOrder, amount: 20_000 },
        documents: [{ name: "inv.pdf", type: "invoice", text: `Northline Steel. Invoice ${invoiceId}D. Total USD 20,000.00. Remit to account on file.` }],
      }),
    ),
    {
      qualificationId: qualification.id,
      scope: {
        agentName: qualification.binding.agent.name,
        agentVersion: qualification.binding.agent.version,
        identitySource: "key",
        workflow: "invoice-payment",
        rail: "ach",
        payeeOnFile: true,
      },
    },
  );
  check(
    "inside policy but above the qualified ceiling escalates to a person",
    aboveQualifiedOnly.verdict === "ESCALATE" &&
      aboveQualifiedOnly.explanation.some((e) => e.code === "qualification:amount_above_qualified_limit"),
    `${aboveQualifiedOnly.verdict} ${aboveQualifiedOnly.explanation.map((e) => e.code).join(",")}`,
  );

  const unqualifiedAgent = verdictFor(
    decide(
      request({
        authorization: { ...authorization, approvedInvoices: [{ invoiceId: `${invoiceId}E`, approvedBy: "j.ortiz", amount: 900 }] },
        declaration: { ...request().declaration, invoiceId: `${invoiceId}E`, amount: 900 },
        paymentOrder: { ...request().paymentOrder, amount: 900 },
        documents: [{ name: "inv.pdf", type: "invoice", text: `Northline Steel. Invoice ${invoiceId}E. Total USD 900.00. Remit to account on file.` }],
      }),
    ),
    {
      qualificationId: qualification.id,
      scope: {
        agentName: qualification.binding.agent.name,
        agentVersion: "9.9.9",
        workflow: "invoice-payment",
        rail: "ach",
        payeeOnFile: true,
      },
    },
  );
  check(
    "a version the Lab never tested escalates instead of releasing",
    unqualifiedAgent.verdict === "ESCALATE" &&
      unqualifiedAgent.explanation.some((e) => e.code === "qualification:agent_version_changed"),
    `${unqualifiedAgent.verdict} ${unqualifiedAgent.explanation.map((e) => e.code).join(",")}`,
  );
}

// With the gate configured to demand one, no qualification means no release.
const demanded = verdictFor(
  decide(
    request({
      authorization: { ...authorization, approvedInvoices: [{ invoiceId: `${invoiceId}F`, approvedBy: "j.ortiz", amount: 700 }] },
      declaration: { ...request().declaration, invoiceId: `${invoiceId}F`, amount: 700 },
      paymentOrder: { ...request().paymentOrder, amount: 700 },
      documents: [{ name: "inv.pdf", type: "invoice", text: `Northline Steel. Invoice ${invoiceId}F. Total USD 700.00. Remit to account on file.` }],
    }),
  ),
  { requireQualification: true },
);
check(
  "with qualifications required, an unqualified caller cannot release",
  demanded.verdict === "ESCALATE" && demanded.explanation.some((e) => e.code === "qualification_required"),
  `${demanded.verdict} ${demanded.explanation.map((e) => e.code).join(",")}`,
);

console.log(`\n${failures === 0 ? "All verdict checks passed" : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
