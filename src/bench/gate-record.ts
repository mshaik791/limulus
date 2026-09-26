import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, publicKeyPem, sha256, signHash, verifySignature } from "../record.ts";

// Gate records and overrides.
//
// A gate that only prints its verdict leaves nothing for a Releases screen to
// show and nothing for an auditor to check, so every gate run is sealed here,
// pass or fail, in data/gates.jsonl.
//
// An override is a person accepting a failing gate for a stated reason. It is
// the one place in the gate where discretion enters, so it is bounded:
//
//   - it lives in the repository next to the baseline, so the reason is in git
//     history with an author, not in a database somebody can edit;
//   - it covers a named set of failures. A new failure is not covered, however
//     similar it looks;
//   - it expires. An exception that never expires is a lowered baseline that
//     nobody wrote down as one;
//   - it cannot cover a new critical violation. Money moving on a call that was
//     not the agent's to make has no acceptable rate, and the honest paths are
//     to fix it or to update the baseline in a commit that says why.
//
// The override carries a content hash, not a signature. It is written into the
// customer's repository from whichever machine ran the gate, and a signature
// from a key that machine generated on first run would prove nothing to CI.
// Git authorship is the audit trail; the hash catches edits after the fact.

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.LIMULUS_DATA_DIR ?? join(here, "..", "..", "data");
const gatesPath = join(dataDir, "gates.jsonl");

export type GateVerdict = "pass" | "fail" | "overridden";

export type GateRecord = {
  kind: "limulus.gate.v1";
  id: string;
  createdAt: string;
  runId: string;
  agent: { name: string; version: string };
  suite: { id: string; fingerprint: string; scenarioCount: number; trials: number };
  baseline: { updatedAt: string; fingerprint: string; trials: number };
  verdict: GateVerdict;
  axes: Record<string, { baseline: number | null; now: number | null }>;
  newCriticals: string[];
  newlyFailing: string[];
  regressions: string[];
  fixed: string[];
  newScenarios: string[];
  flaky: string[];
  /** Set when an override let a failing run through. */
  override?: { id: string; actor: string; reason: string; expiresAt: string };
  prevHash: string | null;
  hash: string;
  signature: string;
  publicKey: string;
};

export function readGateRecords(): GateRecord[] {
  if (!existsSync(gatesPath)) return [];
  return readFileSync(gatesPath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as GateRecord);
}

export function sealGateRecord(body: Omit<GateRecord, "kind" | "id" | "createdAt" | "prevHash" | "hash" | "signature" | "publicKey">): GateRecord {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const previous = readGateRecords().at(-1) ?? null;
  const full = {
    kind: "limulus.gate.v1" as const,
    id: `gate_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    createdAt: new Date().toISOString(),
    ...body,
    prevHash: previous ? previous.hash : null,
  };
  const hash = sha256(canonical(full));
  const record: GateRecord = { ...full, hash, signature: signHash(hash), publicKey: publicKeyPem };
  appendFileSync(gatesPath, `${JSON.stringify(record)}\n`);
  return record;
}

export function verifyGateRecord(record: GateRecord): { ok: boolean; problems: string[] } {
  const { hash, signature, publicKey, ...body } = record;
  const problems: string[] = [];
  if (sha256(canonical(body)) !== hash) problems.push("hash does not match the record body");
  if (!verifySignature(hash, signature, publicKey)) problems.push("signature does not verify");
  return { ok: problems.length === 0, problems };
}

// ---- overrides ----------------------------------------------------------------

export type GateOverride = {
  id: string;
  /** The agent this override is for. An override for one agent says nothing about another. */
  agent: string;
  /** Informational: the suite fingerprint at the time. A changed suite does not void the override; a new failure does. */
  suiteFingerprint: string;
  /** Scenario ids and axis names this override accepts, exactly. */
  covers: string[];
  actor: string;
  reason: string;
  createdAt: string;
  expiresAt: string;
  /** sha256 over everything above, canonicalised. */
  hash: string;
};

export const overridesFileName = "overrides.json";

export function readOverrides(dir: string): GateOverride[] {
  const path = join(dir, overridesFileName);
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(raw) ? (raw as GateOverride[]) : [];
}

export function overrideHash(o: Omit<GateOverride, "hash">): string {
  return sha256(canonical(o));
}

export function verifyOverride(o: GateOverride): boolean {
  const { hash, ...body } = o;
  return overrideHash(body) === hash;
}

export function writeOverride(dir: string, input: Omit<GateOverride, "id" | "createdAt" | "hash">): GateOverride {
  const body = {
    id: `ovr_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    createdAt: new Date().toISOString(),
    ...input,
  };
  const override: GateOverride = { ...body, hash: overrideHash(body) };
  const all = readOverrides(dir);
  writeFileSync(join(dir, overridesFileName), `${JSON.stringify([...all, override], null, 2)}\n`);
  return override;
}

export type OverrideMatch =
  | { applies: true; override: GateOverride }
  | { applies: false; reason: string; nearest?: GateOverride };

/**
 * Whether an override lets this failing run through.
 *
 * Every current failure has to be covered by one override, from a person, that
 * has not expired and has not been edited since it was written. New critical
 * violations are never covered, whatever the file says.
 */
export function matchOverride(
  overrides: GateOverride[],
  input: { agent: string; newCriticals: string[]; newlyFailing: string[]; regressions: string[]; now?: Date },
): OverrideMatch {
  if (input.newCriticals.length > 0) {
    return { applies: false, reason: `new critical violation(s) cannot be overridden: ${input.newCriticals.join(", ")}` };
  }
  const failures = [...input.newlyFailing, ...input.regressions];
  if (failures.length === 0) return { applies: false, reason: "nothing to override" };
  const now = input.now ?? new Date();

  const candidates = overrides.filter((o) => o.agent === input.agent);
  if (candidates.length === 0) return { applies: false, reason: `no override on file for agent "${input.agent}"` };

  let nearest: GateOverride | undefined;
  let why = "";
  for (const o of candidates) {
    if (!verifyOverride(o)) { why = `override ${o.id} has been edited since it was written (hash mismatch)`; nearest = o; continue; }
    if (Date.parse(o.expiresAt) <= now.getTime()) { why = `override ${o.id} expired on ${o.expiresAt.slice(0, 10)}`; nearest = o; continue; }
    const uncovered = failures.filter((f) => !o.covers.includes(f));
    if (uncovered.length > 0) { why = `override ${o.id} does not cover: ${uncovered.join(", ")}`; nearest = o; continue; }
    return { applies: true, override: o };
  }
  return { applies: false, reason: why, nearest };
}

export const gatesFile = gatesPath;
