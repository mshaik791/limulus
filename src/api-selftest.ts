import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createKey } from "./auth.ts";
import { addEndpoint, removeEndpoint, verifySignature } from "./webhooks.ts";

// Exercises auth, idempotency and signed webhooks against a running server,
// with a real receiver on the other end.
//
//   node src/api-selftest.ts

const here = dirname(fileURLToPath(import.meta.url));
const port = 8799;
const receiverPort = 8798;
const base = `http://localhost:${port}`;

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

// A receiver that verifies every delivery the way a customer would.
const received: { event: string; verified: boolean; reason?: string }[] = [];
const endpoint = addEndpoint(`http://localhost:${receiverPort}/hook`, ["decision.held", "outcome.unauthorized"]);

const receiver = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c as Buffer));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString();
    const signature = req.headers["limulus-signature"] as string;
    const result = verifySignature(endpoint.secret, signature ?? "", body);
    received.push({ event: (req.headers["limulus-event"] as string) ?? "?", verified: result.ok, reason: result.reason });
    res.writeHead(200).end("ok");
  });
});
receiver.listen(receiverPort);

// A key with normal scopes, and one without bench access.
const { key: goodKey } = createKey("selftest full", undefined, "test");
const { key: limitedKey } = createKey("selftest read only", ["read"], "test");

const server = spawn(process.execPath, [join(here, "server.ts")], {
  env: { ...process.env, PORT: String(port), LIMULUS_REQUIRE_AUTH: "1" },
  stdio: ["ignore", "ignore", "pipe"],
});

await new Promise((r) => setTimeout(r, 1200));

const call = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
};

const authed = (key: string, extra: Record<string, string> = {}) => ({
  "content-type": "application/json",
  authorization: `Bearer ${key}`,
  ...extra,
});

// 1. Auth is enforced.
const noKey = await call("/v1/records");
check("request without a key is rejected", noKey.status === 401, noKey.body?.error);

const badKey = await call("/v1/records", { headers: { authorization: "Bearer lim_test_wrong" } });
check("unknown key is rejected", badKey.status === 401);

const withKey = await call("/v1/records", { headers: authed(goodKey) });
check("valid key is accepted", withKey.status === 200);

// 2. Scopes are enforced.
const wrongScope = await call("/v1/bench/runs", {
  method: "POST",
  headers: authed(limitedKey),
  body: JSON.stringify({ agent: "careful" }),
});
check("read-only key cannot run the bench", wrongScope.status === 403, wrongScope.body?.error);

// 3. Receipt verification stays open to anyone.
const openVerify = await call("/v1/receipts/verify", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ hash: "x", signature: "y", kind: "limulus.receipt.v1" }),
});
check("receipt verification needs no key", openVerify.status === 200);

// 4. Idempotency: the same key replays, it does not decide twice.
const idempotencyKey = `idem_${Date.now()}`;
const payload = JSON.stringify({ scenario: "poisoned" });

const first = await call("/v1/decisions", {
  method: "POST",
  headers: authed(goodKey, { "idempotency-key": idempotencyKey }),
  body: payload,
});
const second = await call("/v1/decisions", {
  method: "POST",
  headers: authed(goodKey, { "idempotency-key": idempotencyKey }),
  body: payload,
});
check("retry with the same key returns the same decision", first.body.id === second.body.id, first.body.id);
check("replay is flagged in the response headers", second.headers.get("limulus-idempotent-replay") === "true");

const conflict = await call("/v1/decisions", {
  method: "POST",
  headers: authed(goodKey, { "idempotency-key": idempotencyKey }),
  body: JSON.stringify({ scenario: "clean" }),
});
check("same key with a different body conflicts", conflict.status === 409, conflict.body?.error);

// 5. Webhooks: a held decision is delivered and verifies.
await new Promise((r) => setTimeout(r, 600));
const heldDelivery = received.find((d) => d.event === "decision.held");
check("decision.held was delivered", Boolean(heldDelivery), `${received.length} delivery(ies)`);
check("delivery signature verifies", heldDelivery?.verified === true, heldDelivery?.reason ?? "");

// 6. A payment that settles while held raises outcome.unauthorized.
await call("/v1/settlements", {
  method: "POST",
  headers: authed(goodKey),
  body: JSON.stringify({
    decisionId: first.body.id,
    status: "settled",
    amount: first.body.paymentOrder.amount,
    currency: "USD",
    payeeAccountLast4: first.body.paymentOrder.payeeAccountLast4,
    railReference: "ACH-TRACE-APISELFTEST",
  }),
});
await new Promise((r) => setTimeout(r, 600));
const unauthorized = received.find((d) => d.event === "outcome.unauthorized");
check("outcome.unauthorized was delivered", Boolean(unauthorized));
check("its signature verifies too", unauthorized?.verified === true);

// 7. A tampered body fails verification, which is what protects the receiver.
const tampered = verifySignature(endpoint.secret, `t=${Math.floor(Date.now() / 1000)},v1=deadbeef`, "{}");
check("a forged signature is rejected", tampered.ok === false, tampered.reason);

server.kill();
receiver.close();
removeEndpoint(endpoint.id);

console.log(`\n${failures === 0 ? "All API checks passed" : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
