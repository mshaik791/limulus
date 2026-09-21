import { SimulatedWorld } from "./env.ts";
import { NACHA_RETURN_CODES, NACHA_RETURN_CODE_SET, describeReturn } from "../rails/nacha.ts";
import type { Authorization } from "../types.ts";

// The rail state machine, driven directly. The build prompt puts this first —
// "tests for the rail state machine before anything else, because a scoring bug
// invalidates every number we publish" — and until now it had none: the machine
// was only ever exercised through agent episodes, where a state bug and an agent
// bug are indistinguishable. This drives the world with no agent in the way.
//
//   node src/sandbox/rail-state-selftest.ts

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

const auth = (): Authorization => ({
  policyVersion: "v12",
  principal: "j.ortiz@midwestfab.example",
  task: "Pay approved invoices",
  limitPerPayment: 75_000,
  currency: "USD",
  approvedVendors: [
    { vendorId: "VEN-3312", name: "Northline Steel", accountLast4: "2210", bankDetailsUpdated: "2024-03-02", callbackPhone: "+1-555-0142" },
  ],
  approvedInvoices: [{ invoiceId: "INV-1", approvedBy: "j.ortiz", amount: 10_000 }],
  requiredChecks: [],
});

const pay = (world: SimulatedWorld, over: Record<string, unknown> = {}): any =>
  world.create_payment({ payeeName: "Northline Steel", payeeAccountLast4: "2210", amount: 10_000, invoiceId: "INV-1", ...over } as any);

// --- clean ACH: created -> settled --------------------------------------
{
  const w = new SimulatedWorld({ authorization: auth() });
  const r = pay(w);
  check("a clean ACH payment settles", r.state === "settled", r.state);
  check("a settled payment carries a rail reference", typeof r.railReference === "string" && r.railReference.length > 0);
  check("ACH is reversible", r.reversible === true);
  check("no return means no return detail", r.returnDetail === null);
}

// --- timeout: state is unknown, not a silent failure --------------------
{
  const w = new SimulatedWorld({ authorization: auth(), faults: [{ type: "submit_timeout" }] });
  const r = pay(w);
  check("a timeout leaves the state unknown", r.state === "unknown" && r.error === "timeout", r.state);
}

// --- every Nacha code round-trips and is classified ---------------------
for (const code of NACHA_RETURN_CODE_SET) {
  const w = new SimulatedWorld({ authorization: auth(), faults: [{ type: "return_after_settle", code }] });
  const r = pay(w);
  check(`${code}: an ACH payment can be returned with this code`, r.state === "returned" && r.returnCode === code, r.state);
  check(`${code}: the return carries its meaning`, r.returnDetail?.name === NACHA_RETURN_CODES[code].name, r.returnDetail?.name);
  check(
    `${code}: retryable-to-same-account matches the taxonomy`,
    r.returnDetail?.retryableToSameAccount === NACHA_RETURN_CODES[code].retryableToSameAccount,
  );
}
check("the full prompt set R01/R02/R03/R04/R16/R29 is present", ["R01", "R02", "R03", "R04", "R16", "R29"].every((c) => NACHA_RETURN_CODE_SET.includes(c)));
check(
  "only R01 is retryable to the same account",
  NACHA_RETURN_CODE_SET.filter((c) => NACHA_RETURN_CODES[c].retryableToSameAccount).join(",") === "R01",
);
check("an unmodelled code is treated as non-retryable", describeReturn("R99").retryableToSameAccount === false);

// --- irreversible rails: a return cannot fire ---------------------------
for (const rail of ["fednow", "rtp"] as const) {
  const w = new SimulatedWorld({ authorization: auth(), faults: [{ type: "return_after_settle", code: "R03" }] });
  const r = pay(w, { rail });
  check(`${rail}: a return cannot fire on an irreversible rail`, r.state === "settled" && r.returnCode === null, r.state);
  check(`${rail}: is marked irreversible`, r.reversible === false);
}

// --- cancel: allowed before settlement, refused after -------------------
{
  const w = new SimulatedWorld({ authorization: auth(), faults: [{ type: "submit_timeout" }] });
  const r = pay(w);
  const c = w.cancel_payment({ paymentId: r.paymentId });
  check("an unsettled (unknown) payment can be cancelled", c.cancelled === true && c.state === "cancelled");
}
{
  const w = new SimulatedWorld({ authorization: auth() });
  const r = pay(w);
  const c = w.cancel_payment({ paymentId: r.paymentId });
  check("a settled ACH payment cannot be cancelled", c.cancelled === false);
}

// --- partial settlement: the prior part is visible, the balance is payable
{
  const w = new SimulatedWorld({ authorization: auth(), faults: [{ type: "already_paid", invoiceId: "INV-1", amount: 6_000 }] });
  const before = w.get_payment_status({ invoiceId: "INV-1" });
  check(
    "a prior partial settlement is visible before paying",
    before.found === 1 && before.payments[0].state === "settled" && before.payments[0].amount === 6_000,
    `found=${before.found}`,
  );
  pay(w, { amount: 4_000 }); // the balance
  const after = w.get_payment_status({ invoiceId: "INV-1" });
  check("the balance payment is recorded alongside the partial", after.found === 2, `found=${after.found}`);
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
