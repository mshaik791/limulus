import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./record.ts";

// API keys. Only the hash of a key is stored, so a leaked key file cannot be
// used to call the API. The key itself is shown once, at creation.

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");
const keysPath = join(dataDir, "api-keys.json");

export type Scope = "decisions:write" | "settlements:write" | "bench:run" | "read" | "admin";

export type ApiKeyRecord = {
  id: string;
  name: string;
  /** sha256 of the key. The key itself is never stored. */
  hash: string;
  /** First characters, so a key can be recognized in a list. */
  prefix: string;
  scopes: Scope[];
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

function load(): ApiKeyRecord[] {
  if (!existsSync(keysPath)) return [];
  return JSON.parse(readFileSync(keysPath, "utf8")) as ApiKeyRecord[];
}

function save(keys: ApiKeyRecord[]) {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  writeFileSync(keysPath, JSON.stringify(keys, null, 2), { mode: 0o600 });
}

export function listKeys(): ApiKeyRecord[] {
  return load();
}

/** Creates a key. The plaintext is returned once and never stored. */
export function createKey(
  name: string,
  scopes: Scope[] = ["decisions:write", "settlements:write", "bench:run", "read"],
  environment: "live" | "test" = "test",
): { key: string; record: ApiKeyRecord } {
  const secret = randomBytes(24).toString("hex");
  const key = `lim_${environment}_${secret}`;
  const record: ApiKeyRecord = {
    id: `key_${randomBytes(8).toString("hex")}`,
    name,
    hash: sha256(key),
    prefix: key.slice(0, 16),
    scopes,
    createdAt: new Date().toISOString(),
  };
  save([...load(), record]);
  return { key, record };
}

export function revokeKey(id: string): boolean {
  const keys = load();
  const target = keys.find((k) => k.id === id);
  if (!target || target.revokedAt) return false;
  target.revokedAt = new Date().toISOString();
  save(keys);
  return true;
}

export type AuthResult =
  | { ok: true; key: ApiKeyRecord | null; reason: "authenticated" | "auth disabled" }
  | { ok: false; status: 401 | 403; message: string };

/**
 * Checks a request.
 *
 * Auth is off by default so the local demo works with no setup. Set
 * LIMULUS_REQUIRE_AUTH=1 to enforce it, which is what a deployment does.
 */
export function authenticate(header: string | undefined, required: Scope): AuthResult {
  const enforcing = process.env.LIMULUS_REQUIRE_AUTH === "1";
  const presented = header?.replace(/^Bearer\s+/i, "").trim();

  if (!presented) {
    return enforcing
      ? { ok: false, status: 401, message: "Missing API key. Send Authorization: Bearer lim_..." }
      : { ok: true, key: null, reason: "auth disabled" };
  }

  const hash = sha256(presented);
  const keys = load();
  const match = keys.find((k) => {
    const a = Buffer.from(k.hash);
    const b = Buffer.from(hash);
    return a.length === b.length && timingSafeEqual(a, b);
  });

  if (!match) return { ok: false, status: 401, message: "Unknown API key" };
  if (match.revokedAt) return { ok: false, status: 401, message: "This API key was revoked" };

  const permitted = match.scopes.includes("admin") || match.scopes.includes(required);
  if (!permitted) {
    return { ok: false, status: 403, message: `This key lacks the ${required} scope` };
  }

  match.lastUsedAt = new Date().toISOString();
  save(keys);

  return { ok: true, key: match, reason: "authenticated" };
}

export const keysFile = keysPath;
