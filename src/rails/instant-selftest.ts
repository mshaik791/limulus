// Does the gate work on rails that cannot be undone?
//
// The whole architecture is "create the payment held, then decide" — which is
// easy to believe on ACH, because ACH is a batch rail with a natural window.
// Instant rails settle in seconds and are irrevocable: no return codes, no
// five-day window, no clawback. If holding did not work there, the product
// would be least useful exactly where a mistake is most permanent.
//
// So this checks it rather than assuming it. Against the real Increase
// sandbox, for both instant rails:
//
//   ALLOW → the payment completes and settles
//   BLOCK → cancelled, with no ledger entry and nothing sent to the network
//
//   INCREASE_API_KEY=... INCREASE_ACCOUNT_ID=... node src/rails/instant-selftest.ts

const key = process.env.INCREASE_API_KEY;
const accountId = process.env.INCREASE_ACCOUNT_ID;
const base = process.env.INCREASE_ENV === "production"
  ? "https://api.increase.com"
  : "https://sandbox.increase.com";

if (!key || !accountId) {
  console.log("Set INCREASE_API_KEY and INCREASE_ACCOUNT_ID to run this.");
  console.log("It talks to the sandbox and creates real sandbox transfers.");
  process.exit(0);
}

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

const api = async (path: string, body?: unknown, idempotencyKey?: string) => {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${path}: ${JSON.stringify(json).slice(0, 200)}`);
  return json as Record<string, any>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36);

// The instant rails send from an account *number*, not the account id.
const numbers = await api(`/account_numbers?account_id=${accountId}&limit=1`);
const sourceAccountNumberId = numbers.data?.[0]?.id;
if (!sourceAccountNumberId) {
  console.log("No account number on this account; create one in the dashboard first.");
  process.exit(1);
}

// RTP addresses an external account rather than a raw routing number.
const external = await api("/external_accounts", {
  routing_number: "101050001",
  account_number: "987654321",
  description: "Limulus instant-rail selftest payee",
  account_holder: "business",
  funding: "checking",
}, `limulus-instant-ea-${stamp}`);

/**
 * Waits for a transfer to leave its in-flight state.
 *
 * The sandbox submits on its own schedule and the two rails differ by a lot:
 * FedNow tends to complete within seconds, RTP has taken over a minute. A
 * twenty-second window made RTP look broken when it was only slow, so the
 * budget here is generous on purpose — an impatient test that reports a
 * failure is worse than a slow one.
 */
async function settle(path: string, id: string, budgetMs = 150_000) {
  const deadline = Date.now() + budgetMs;
  let transfer = await api(`${path}/${id}`);
  while (/^pending_(submitting|submission)$/.test(transfer.status) && Date.now() < deadline) {
    await sleep(3000);
    transfer = await api(`${path}/${id}`);
  }
  return transfer;
}

type Rail = {
  name: string;
  path: string;
  body: (amount: number, reference: string) => Record<string, unknown>;
  /** What "it went" looks like on this rail. */
  released: RegExp;
};

const rails: Rail[] = [
  {
    name: "FedNow",
    path: "/fednow_transfers",
    released: /^(complete|submitted|pending_acknowledgement)$/,
    body: (amount, reference) => ({
      source_account_number_id: sourceAccountNumberId,
      amount,
      unstructured_remittance_information: reference,
      creditor_name: "Northline Steel",
      debtor_name: "Midwest Fabrication",
      routing_number: "101050001",
      account_number: "987654321",
      require_approval: true,
    }),
  },
  {
    name: "RTP",
    path: "/real_time_payments_transfers",
    released: /^(complete|submitted|pending_acknowledgement)$/,
    body: (amount, reference) => ({
      source_account_number_id: sourceAccountNumberId,
      amount,
      creditor_name: "Cedar Valley Freight",
      unstructured_remittance_information: reference,
      external_account_id: external.id,
      require_approval: true,
    }),
  },
];

for (const rail of rails) {
  console.log(`\n---- ${rail.name} ----`);

  // ---- the hold itself -------------------------------------------------
  const held = await api(rail.path, rail.body(260_000, `SELFTEST-${stamp}-A`),
    `limulus-instant-${rail.name}-allow-${stamp}`);
  check(`${rail.name}: require_approval holds the payment`,
    held.status === "pending_approval", held.status);
  check(`${rail.name}: funds are reserved while it is held`,
    Boolean(held.pending_transaction_id),
    held.pending_transaction_id ? "pending transaction exists" : "none");
  check(`${rail.name}: nothing has reached the network yet`,
    held.submission === null && held.transaction_id === null);

  // ---- ALLOW -----------------------------------------------------------
  await api(`${rail.path}/${held.id}/approve`, {});
  const released = await settle(rail.path, held.id);
  check(`${rail.name}: ALLOW releases it`,
    rail.released.test(released.status), released.status);
  check(`${rail.name}: ALLOW produces a ledger transaction`,
    Boolean(released.transaction_id), released.transaction_id ?? "none");
  check(`${rail.name}: ALLOW records a network submission`,
    Boolean(released.submission),
    released.submission
      ? `submitted_at ${released.submission.submitted_at}`
      : "none");

  // ---- BLOCK -----------------------------------------------------------
  const toBlock = await api(rail.path, rail.body(7_300_000, `SELFTEST-${stamp}-B`),
    `limulus-instant-${rail.name}-block-${stamp}`);
  const cancelled = await api(`${rail.path}/${toBlock.id}/cancel`, {});
  check(`${rail.name}: BLOCK cancels it`, cancelled.status === "canceled", cancelled.status);
  check(`${rail.name}: BLOCK leaves no ledger entry`,
    cancelled.transaction_id === null, String(cancelled.transaction_id));
  check(`${rail.name}: BLOCK never reaches the network`,
    cancelled.submission === null, String(cancelled.submission));
}

console.log(
  failures === 0
    ? "\nThe hold works on both instant rails. A blocked instant payment leaves no trace,\n" +
      "which matters more here than on ACH: there is no return code to fall back on."
    : `\n${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
