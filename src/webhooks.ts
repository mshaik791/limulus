import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Webhooks. The events that matter are the ones a person must act on: a held
// payment, and a payment that settled although it was held.

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");
const endpointsPath = join(dataDir, "webhooks.json");
const deliveriesPath = join(dataDir, "webhook-deliveries.jsonl");

export type WebhookEvent =
  | "decision.released"
  | "decision.held"
  | "decision.escalated"
  | "outcome.verified"
  | "outcome.unauthorized"
  | "outcome.duplicate"
  | "outcome.mismatch"
  | "outcome.returned"
  | "bench.completed";

export const allEvents: WebhookEvent[] = [
  "decision.released",
  "decision.held",
  "decision.escalated",
  "outcome.verified",
  "outcome.unauthorized",
  "outcome.duplicate",
  "outcome.mismatch",
  "outcome.returned",
  "bench.completed",
];

export type Endpoint = {
  id: string;
  url: string;
  /** Used to sign deliveries. Shown once at creation. */
  secret: string;
  events: WebhookEvent[];
  createdAt: string;
  disabledAt?: string;
};

export type Delivery = {
  id: string;
  endpointId: string;
  event: WebhookEvent;
  attempts: number;
  status: "delivered" | "failed";
  responseStatus?: number;
  error?: string;
  at: string;
};

function loadEndpoints(): Endpoint[] {
  if (!existsSync(endpointsPath)) return [];
  return JSON.parse(readFileSync(endpointsPath, "utf8")) as Endpoint[];
}

function saveEndpoints(endpoints: Endpoint[]) {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  writeFileSync(endpointsPath, JSON.stringify(endpoints, null, 2), { mode: 0o600 });
}

export function listEndpoints(): Omit<Endpoint, "secret">[] {
  return loadEndpoints().map(({ secret, ...rest }) => rest);
}

export function addEndpoint(url: string, events: WebhookEvent[] = allEvents): Endpoint {
  const endpoint: Endpoint = {
    id: `whk_${randomBytes(8).toString("hex")}`,
    url,
    secret: `whsec_${randomBytes(24).toString("hex")}`,
    events,
    createdAt: new Date().toISOString(),
  };
  saveEndpoints([...loadEndpoints(), endpoint]);
  return endpoint;
}

export function removeEndpoint(id: string): boolean {
  const endpoints = loadEndpoints();
  const remaining = endpoints.filter((e) => e.id !== id);
  if (remaining.length === endpoints.length) return false;
  saveEndpoints(remaining);
  return true;
}

export function readDeliveries(): Delivery[] {
  if (!existsSync(deliveriesPath)) return [];
  return readFileSync(deliveriesPath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Delivery);
}

/**
 * Signature over `timestamp.body`, so a captured delivery cannot be replayed
 * later with a different body or at a different time.
 */
export function sign(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Verification helper for receivers. Exported so customers can copy it. */
export function verifySignature(
  secret: string,
  header: string,
  body: string,
  toleranceSeconds = 300,
): { ok: boolean; reason?: string } {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=").map((s) => s.trim())));
  const timestamp = Number(parts.t);
  const presented = parts.v1;
  if (!timestamp || !presented) return { ok: false, reason: "malformed signature header" };

  const age = Math.abs(Date.now() / 1000 - timestamp);
  if (age > toleranceSeconds) return { ok: false, reason: `timestamp is ${Math.round(age)}s old` };

  const expected = sign(secret, timestamp, body);
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "signature mismatch" };
  return { ok: true };
}

const backoffMs = [0, 500, 2_000];

/**
 * Sends an event to every endpoint subscribed to it. Failures are retried a
 * few times and then recorded; delivery never blocks the decision itself.
 */
export async function emit(event: WebhookEvent, payload: Record<string, unknown>): Promise<void> {
  const endpoints = loadEndpoints().filter((e) => !e.disabledAt && e.events.includes(event));
  if (endpoints.length === 0) return;

  const body = JSON.stringify({ id: `evt_${randomBytes(8).toString("hex")}`, event, createdAt: new Date().toISOString(), data: payload });

  await Promise.all(
    endpoints.map(async (endpoint) => {
      let lastError = "";
      let responseStatus: number | undefined;

      for (let attempt = 0; attempt < backoffMs.length; attempt++) {
        if (backoffMs[attempt] > 0) await new Promise((r) => setTimeout(r, backoffMs[attempt]));
        const timestamp = Math.floor(Date.now() / 1000);
        try {
          const response = await fetch(endpoint.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "limulus-signature": `t=${timestamp},v1=${sign(endpoint.secret, timestamp, body)}`,
              "limulus-event": event,
            },
            body,
            signal: AbortSignal.timeout(5_000),
          });
          responseStatus = response.status;
          if (response.ok) {
            record({ endpointId: endpoint.id, event, attempts: attempt + 1, status: "delivered", responseStatus });
            return;
          }
          lastError = `HTTP ${response.status}`;
        } catch (error) {
          lastError = (error as Error).message;
        }
      }

      record({
        endpointId: endpoint.id,
        event,
        attempts: backoffMs.length,
        status: "failed",
        responseStatus,
        error: lastError,
      });
    }),
  );
}

function record(delivery: Omit<Delivery, "id" | "at">) {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const entry: Delivery = { ...delivery, id: `del_${randomBytes(6).toString("hex")}`, at: new Date().toISOString() };
  appendFileSync(deliveriesPath, `${JSON.stringify(entry)}\n`);
}
