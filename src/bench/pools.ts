import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scenario } from "./types.ts";

// Two pools, and the reason there have to be two.
//
// The Lab is asked to do two jobs that pull against each other. As a
// development tool it should show you everything, so you can run it, see what
// broke, fix the prompt and run it again. As the basis for a qualification it
// has to hold something back, because a score measured on scenarios the agent
// was tuned against measures the tuning, not the agent.
//
// So: an OPEN pool, visible and re-runnable as often as you like, and a
// HELD-OUT pool that is never shown and is the only pool a qualification may
// be issued from.
//
// The part that is easy to get wrong: this repository is public. A held-out
// set committed here is not held out — the agent's authors can read it, and so
// can the agent. What is public is the *threat model*: the families, what each
// one tests, and why. What is private is the *instances*: the specific vendors,
// amounts, invoice numbers and document text. That split is deliberate and it
// is the same one a security benchmark makes. Publishing the attack classes
// costs nothing; publishing the test cases costs everything.
//
// Held-out instances therefore live outside git, under data/held-out/, and are
// generated locally from a seed that also never leaves the machine.

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "..", "data");
const heldOutDir = join(dataDir, "held-out");
const seedPath = join(heldOutDir, "seed.json");

export type Pool = "open" | "held-out";

/** A pool-aware scenario. Existing packs are all open by default. */
export type PooledScenario = Scenario & {
  pool: Pool;
  /**
   * Which rotation this instance belongs to. Held-out cohorts are retired once
   * a customer has been scored against them, because a score is only worth
   * something the first time.
   */
  cohort?: string;
};

export class PoolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// ----------------------------------------------------------------- the open pool
/**
 * Everything committed to the repository. Safe to show, safe to iterate
 * against, and worthless as a basis for a qualification.
 */
export async function openPool(): Promise<PooledScenario[]> {
  const [payments, hard] = await Promise.all([
    import("./pack-payments-v1.ts"),
    import("./pack-hard-v1.ts"),
  ]);
  return [...payments.scenarios, ...hard.hardScenarios].map((s) => ({
    ...s,
    pool: "open" as const,
  }));
}

// -------------------------------------------------------------- the held-out pool
/**
 * Loads the private instances. Deliberately throws rather than falling back to
 * the open pool when they are missing: a qualification issued from the open
 * pool would look identical to a real one and mean nothing, and a silent
 * fallback is exactly how that happens.
 */
export function heldOutPool(cohort?: string): PooledScenario[] {
  if (!existsSync(heldOutDir)) {
    throw new PoolError(
      "held_out_missing",
      `No held-out pool at ${heldOutDir}. Generate one with:\n` +
        `  node src/bench/generate-held-out.ts\n\n` +
        `This is not optional for issuing a qualification. Scoring an agent on ` +
        `scenarios its authors can read measures how well they read, not how ` +
        `well it behaves.`,
    );
  }

  const files = readdirSync(heldOutDir).filter((f) => f.endsWith(".scenario.json"));
  if (files.length === 0) {
    throw new PoolError("held_out_empty", `${heldOutDir} exists but holds no scenarios.`);
  }

  const scenarios: PooledScenario[] = [];
  for (const file of files) {
    const parsed = JSON.parse(readFileSync(join(heldOutDir, file), "utf8")) as PooledScenario;
    if (cohort && parsed.cohort !== cohort) continue;
    scenarios.push({ ...parsed, pool: "held-out" });
  }

  if (scenarios.length === 0) {
    throw new PoolError("cohort_empty", `No held-out scenarios in cohort "${cohort}".`);
  }
  return scenarios;
}

/** True when a held-out pool is present, without throwing. */
export const hasHeldOut = (): boolean =>
  existsSync(heldOutDir) && readdirSync(heldOutDir).some((f) => f.endsWith(".scenario.json"));

// ------------------------------------------------------------------- leak checks
/**
 * The failure this guards against is subtle: a held-out instance that is a
 * copy of an open one, which passes every structural check while certifying
 * nothing. Compares the parts an agent actually reads.
 */
export function leakCheck(open: PooledScenario[], held: PooledScenario[]) {
  const fingerprint = (s: PooledScenario) =>
    createHash("sha256")
      .update(
        [
          s.task.replace(/\s+/g, " ").trim(),
          ...s.documents.map((d) => `${d.text ?? ""}${d.hiddenText ?? ""}`.replace(/\s+/g, " ").trim()),
        ].join("|"),
      )
      .digest("hex");

  const openPrints = new Set(open.map(fingerprint));
  const collisions = held.filter((s) => openPrints.has(fingerprint(s)));

  const openIds = new Set(open.map((s) => s.id));
  const sharedIds = held.filter((s) => openIds.has(s.id));

  return {
    ok: collisions.length === 0 && sharedIds.length === 0,
    identicalContent: collisions.map((s) => s.id),
    sharedIds: sharedIds.map((s) => s.id),
  };
}

/** Records which cohort an agent has been scored against, so it is not reused. */
export type CohortUse = { cohort: string; agent: string; version: string; at: string; runId: string };
const usesPath = join(heldOutDir, "cohort-uses.jsonl");

export function readCohortUses(): CohortUse[] {
  if (!existsSync(usesPath)) return [];
  return readFileSync(usesPath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as CohortUse);
}

export function recordCohortUse(use: CohortUse) {
  mkdirSync(heldOutDir, { recursive: true });
  writeFileSync(usesPath, `${JSON.stringify(use)}\n`, { flag: "a" });
}

/**
 * Has this exact agent version already been scored on this cohort? A second
 * run on the same cohort is a retake, and a retake is not a measurement.
 */
export const cohortAlreadyUsed = (cohort: string, agent: string, version: string) =>
  readCohortUses().some((u) => u.cohort === cohort && u.agent === agent && u.version === version);

export const heldOutPath = heldOutDir;
export const seedFile = seedPath;
