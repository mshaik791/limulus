import {
  createHash,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  createPublicKey,
  createPrivateKey,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DecisionRecord } from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.LIMULUS_DATA_DIR ?? join(here, "..", "data");
const keyPath = join(dataDir, "signing-key.json");
const chainPath = join(dataDir, "records.jsonl");

function ensureDataDir() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
}

/**
 * Loads the signing key, creating one on first run. A real deployment would
 * keep this in a KMS or HSM; a file is fine for the MVP.
 */
function loadKeys() {
  ensureDataDir();
  if (!existsSync(keyPath)) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const material = {
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      createdAt: new Date().toISOString(),
    };
    writeFileSync(keyPath, JSON.stringify(material, null, 2), { mode: 0o600 });
  }
  const material = JSON.parse(readFileSync(keyPath, "utf8"));
  return {
    publicKeyPem: material.publicKey as string,
    privateKey: createPrivateKey(material.privateKey),
    publicKey: createPublicKey(material.publicKey),
  };
}

const keys = loadKeys();

export const sha256 = (input: string) => createHash("sha256").update(input).digest("hex");

/** Stable JSON so the same record always hashes to the same value. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export function readChain(): DecisionRecord[] {
  ensureDataDir();
  if (!existsSync(chainPath)) return [];
  return readFileSync(chainPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as DecisionRecord);
}

export function lastRecord(): DecisionRecord | null {
  const chain = readChain();
  return chain.length > 0 ? chain[chain.length - 1] : null;
}

/** Signs a hash with the service key. Used by decisions, outcomes and reports. */
export function signHash(hash: string): string {
  return edSign(null, Buffer.from(hash), keys.privateKey).toString("base64");
}

/** Checks a signature against a hash, using the key carried in the record. */
export function verifySignature(hash: string, signature: string, publicKey: string): boolean {
  try {
    return edVerify(null, Buffer.from(hash), createPublicKey(publicKey), Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/** Hashes the record body, signs the hash and appends it to the chain. */
export function sealAndAppend(body: Omit<DecisionRecord, "hash" | "signature" | "publicKey">): DecisionRecord {
  const hash = sha256(canonical(body));
  const signature = signHash(hash);
  const record: DecisionRecord = {
    ...body,
    hash,
    signature,
    publicKey: keys.publicKeyPem.trim(),
  };
  ensureDataDir();
  appendFileSync(chainPath, `${JSON.stringify(record)}\n`);
  return record;
}

export type ChainVerification = {
  ok: boolean;
  count: number;
  problems: { id: string; problem: string }[];
};

/**
 * Recomputes every hash, checks each signature and confirms each record points
 * at the one before it. Anyone can run this against an exported chain.
 */
export function verifyChain(chain: DecisionRecord[] = readChain()): ChainVerification {
  const problems: { id: string; problem: string }[] = [];
  let expectedPrev: string | null = null;

  for (const record of chain) {
    const { hash, signature, publicKey, ...body } = record;
    const recomputed = sha256(canonical(body));
    if (recomputed !== hash) {
      problems.push({ id: record.id, problem: "record contents do not match its hash" });
    }
    const signatureOk = edVerify(
      null,
      Buffer.from(hash),
      createPublicKey(publicKey),
      Buffer.from(signature, "base64"),
    );
    if (!signatureOk) problems.push({ id: record.id, problem: "signature does not verify" });
    if (record.prevHash !== expectedPrev) {
      problems.push({ id: record.id, problem: "previous hash does not match the chain" });
    }
    expectedPrev = hash;
  }

  return { ok: problems.length === 0, count: chain.length, problems };
}

export const publicKeyPem = keys.publicKeyPem.trim();
export const chainFile = chainPath;
