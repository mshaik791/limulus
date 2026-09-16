import { decide } from "./decide.ts";
import { recordSettlement, verifyOutcomeForDecision } from "./outcome.ts";
import { buildReceipt, verifyReceipt } from "./receipt.ts";
import { cleanPayment, poisonedInvoicePayment } from "./scenarios.ts";
import type { DecisionRequest } from "./types.ts";

// Pillar three, end to end: decide, let the rail report back, then compare.
//
//   node src/outcome-demo.ts

const line = (title: string) => console.log(`\n${title}\n${"-".repeat(title.length)}`);

const withInvoice = (request: DecisionRequest, invoiceId: string): DecisionRequest => ({
  ...request,
  authorization: {
    ...request.authorization,
    approvedInvoices: [
      ...request.authorization.approvedInvoices,
      { invoiceId, approvedBy: "j.ortiz", amount: request.declaration.amount, poId: "PO-44812" },
    ],
  },
  declaration: { ...request.declaration, invoiceId },
  paymentOrder: { ...request.paymentOrder, reference: invoiceId },
});

const show = (label: string, outcome: ReturnType<typeof verifyOutcomeForDecision>) => {
  console.log(`${label}: ${outcome.status.toUpperCase()}`);
  for (const finding of outcome.findings) {
    console.log(`  [${finding.severity}] ${finding.code}: ${finding.detail}`);
  }
};

// 1. Released, settles once, exactly as approved.
line("1. Released payment settles correctly");
const good = decide(withInvoice(cleanPayment, `INV-${Math.floor(Math.random() * 9000) + 1000}`));
recordSettlement({
  decisionId: good.id,
  status: "settled",
  amount: good.paymentOrder.amount,
  currency: good.paymentOrder.currency,
  payeeAccountLast4: good.paymentOrder.payeeAccountLast4,
  occurredAt: new Date().toISOString(),
  railReference: "ACH-TRACE-091500123",
});
show("decision released", verifyOutcomeForDecision(good.id));

// 2. The control was bypassed: we held it, and it settled anyway.
line("2. Held payment settles anyway (the control was bypassed)");
const held = decide(withInvoice(poisonedInvoicePayment, `INV-${Math.floor(Math.random() * 9000) + 1000}`));
recordSettlement({
  decisionId: held.id,
  status: "settled",
  amount: held.paymentOrder.amount,
  currency: held.paymentOrder.currency,
  payeeAccountLast4: held.paymentOrder.payeeAccountLast4,
  occurredAt: new Date().toISOString(),
  railReference: "ACH-TRACE-091500124",
});
show(`decision ${held.outcome}`, verifyOutcomeForDecision(held.id));

// 3. Paid twice.
line("3. Released payment settles twice");
const dupe = decide(withInvoice(cleanPayment, `INV-${Math.floor(Math.random() * 9000) + 1000}`));
for (const reference of ["ACH-TRACE-091500125", "ACH-TRACE-091500126"]) {
  recordSettlement({
    decisionId: dupe.id,
    status: "settled",
    amount: dupe.paymentOrder.amount,
    currency: dupe.paymentOrder.currency,
    payeeAccountLast4: dupe.paymentOrder.payeeAccountLast4,
    occurredAt: new Date().toISOString(),
    railReference: reference,
  });
}
show("decision released", verifyOutcomeForDecision(dupe.id));

// 4. Settled to an account we never approved.
line("4. Released payment settles to a different account");
const drift = decide(withInvoice(cleanPayment, `INV-${Math.floor(Math.random() * 9000) + 1000}`));
recordSettlement({
  decisionId: drift.id,
  status: "settled",
  amount: drift.paymentOrder.amount,
  currency: drift.paymentOrder.currency,
  payeeAccountLast4: "4471",
  occurredAt: new Date().toISOString(),
  railReference: "ACH-TRACE-091500127",
});
show("decision released", verifyOutcomeForDecision(drift.id));

// 5. Returned by the rail.
line("5. Payment returned by the rail");
const returned = decide(withInvoice(cleanPayment, `INV-${Math.floor(Math.random() * 9000) + 1000}`));
recordSettlement({
  decisionId: returned.id,
  status: "returned",
  amount: returned.paymentOrder.amount,
  currency: returned.paymentOrder.currency,
  payeeAccountLast4: returned.paymentOrder.payeeAccountLast4,
  occurredAt: new Date().toISOString(),
  railReference: "ACH-TRACE-091500128",
  returnCode: "R03",
});
show("decision released", verifyOutcomeForDecision(returned.id));

// 6. The receipt: portable, and verifiable without us.
line("6. Receipt for the bypassed payment");
const receipt = buildReceipt(held.id);
console.log(`receipt ${receipt.receiptId}`);
console.log(`  decision   ${receipt.decision.outcome} (${receipt.decision.id})`);
console.log(`  payment    ${receipt.payment.currency} ${receipt.payment.amount} to ${receipt.payment.payee} ****${receipt.payment.accountLast4}`);
console.log(`  outcome    ${receipt.outcome?.status ?? "none"}`);
console.log(`  size       ${JSON.stringify(receipt).length} bytes`);

const verification = verifyReceipt(receipt);
console.log(`  verified   ${verification.valid}`);
for (const check of verification.checks) console.log(`    ${check.ok ? "ok  " : "FAIL"} ${check.name}`);

// 7. Tamper with it and watch verification fail.
line("7. Tampered receipt");
const tampered = structuredClone(receipt);
tampered.payment.amount = 1;
const tamperedResult = verifyReceipt(tampered);
console.log(`  verified   ${tamperedResult.valid}`);
for (const check of tamperedResult.checks) console.log(`    ${check.ok ? "ok  " : "FAIL"} ${check.name}: ${check.detail}`);
