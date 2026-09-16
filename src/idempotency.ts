import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, sha256 } from "./record.ts";

// Idempotency. A payment decision must never be created twice because a caller
// retried after a timeout, which is exactly the situation that produces
// duplicate payments.

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");
const storePath = join(dataDir, "idempotency.json");

type Entry = {
  key: string;
  /** Hash of the request body, so the same key with a different body is caught. */
  requestHash: string;
  status: number;
  response: unknown;
  storedAt: string;
};

const TTL_HOURS = 24;

function load(): Entry[] {
  if (!existsSync(storePath)) return [];
  const entries = JSON.parse(readFileSync(storePath, "utf8")) as Entry[];
  const cutoff = Date.now() - TTL_HOURS * 3_600_000;
  return entries.filter((e) => new Date(e.storedAt).getTime() > cutoff);
}

function save(entries: Entry[]) {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  writeFileSync(storePath, JSON.stringify(entries, null, 2));
}

export type IdempotencyLookup =
  | { state: "fresh" }
  | { state: "replay"; status: number; response: unknown }
  | { state: "conflict"; message: string };

/** Looks up a key before doing the work. */
export function check(key: string | undefined, body: unknown): IdempotencyLookup {
  if (!key) return { state: "fresh" };

  const requestHash = sha256(canonical(body));
  const existing = load().find((e) => e.key === key);
  if (!existing) return { state: "fresh" };

  if (existing.requestHash !== requestHash) {
    return {
      state: "conflict",
      message:
        "This Idempotency-Key was already used with a different request body. Use a new key for a different payment.",
    };
  }

  return { state: "replay", status: existing.status, response: existing.response };
}

/** Records the result so a retry with the same key replays it. */
export function remember(key: string | undefined, body: unknown, status: number, response: unknown) {
  if (!key) return;
  const entries = load().filter((e) => e.key !== key);
  entries.push({
    key,
    requestHash: sha256(canonical(body)),
    status,
    response,
    storedAt: new Date().toISOString(),
  });
  save(entries);
}
