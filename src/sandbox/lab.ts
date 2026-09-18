import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { canonical, publicKeyPem, sha256, signHash, verifySignature } from "../record.ts";
import { runEpisode, type EpisodeTrace, type ToolAgentTarget } from "./episode.ts";
import { gradeEpisode, scoreFourAxes, type EpisodeGrade, type FourAxisResult } from "./score.ts";
import { toolCatalog } from "./env.ts";
import { issueQualification, type Qualification, type QualificationBinding } from "../qualification.ts";
import { packId, packVersion, scenarios as defaultPack } from "../bench/pack-payments-v1.ts";
import {
  cohortAlreadyUsed, heldOutPool, openPool, PoolError, recordCohortUse, type Pool,
} from "../bench/pools.ts";
import type { Scenario } from "../bench/types.ts";

// A Lab run: every scenario, several times, in the simulated world, graded
// deterministically and sealed. Traces are kept so any finding can be replayed
// call by call — a report that cannot be audited is just an assertion.

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "..", "data");
const runsPath = join(dataDir, "lab-runs.jsonl");
const tracesPath = join(dataDir, "episodes.jsonl");

export type LabRun = {
  kind: "limulus.labrun.v1";
  id: string;
  createdAt: string;
  agent: { name: string; version: string; endpoint: string; promptHash?: string; toolConfigHash: string };
  suite: { id: string; version: string; scenarioCount: number; trials: number; episodes: number };
  axes: FourAxisResult;
  grades: EpisodeGrade[];
  /** Which pool produced this run. Only "held-out" may back a qualification. */
  pool: Pool;
  /** The held-out cohort, when there was one. */
  cohort?: string;
  durationMs: number;
  prevHash: string | null;
  hash: string;
  signature: string;
  publicKey: string;
};

/** The tool list is part of what was tested, so it is hashed into the binding. */
export const toolConfigHash = () =>
  sha256(canonical(toolCatalog.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))));

export function readLabRuns(): LabRun[] {
  if (!existsSync(runsPath)) return [];
  return readFileSync(runsPath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as LabRun);
}

export function readTraces(runId?: string): (EpisodeTrace & { runId: string })[] {
  if (!existsSync(tracesPath)) return [];
  return readFileSync(tracesPath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as EpisodeTrace & { runId: string })
    .filter((t) => !runId || t.runId === runId);
}

export type RunSuiteOptions = {
  pack?: Scenario[];
  /**
   * Which pool to run. "open" is the development loop: visible, repeatable,
   * and deliberately not sufficient for a qualification. "held-out" is the
   * private set and the only pool a qualification may be issued from.
   */
  pool?: Pool;
  /** Which held-out cohort. Defaults to whatever is present. */
  cohort?: string;
  /**
   * Allows a second scored run of the same agent version against a cohort it
   * has already seen. Off by default, because a retake is not a measurement.
   */
  allowRetake?: boolean;
  /** Repeat count per scenario. Three is the floor for measuring consistency. */
  trials?: number;
  maxSteps?: number;
  /** Issue a qualification from the result. Needs the scope it is being asked for. */
  qualifyFor?: Omit<QualificationBinding, "agent" | "suite">;
  /**
   * Identity of a suite that is not one of ours — a customer's scenario files.
   * Supplying the wrong id here would put a false statement inside a signed
   * qualification, so it is set by whoever assembled the suite rather than
   * defaulted to the standard pack's name.
   */
  suite?: { id: string; version?: string };
};

/**
 * Fingerprints the scenarios that actually ran. A suite is identified by its
 * contents, not its label: two suites called "ours" that differ by one scenario
 * must not produce interchangeable qualification records.
 */
function suiteFingerprint(pack: Scenario[]): string {
  const shape = pack
    .map((s) => `${s.id}|${s.expected}|${s.severity}|${s.category}|${(s.railEvents ?? []).map((e) => e.type).join(",")}`)
    .sort()
    .join("\n");
  return sha256(shape).slice(0, 12);
}

export async function runSuite(
  target: ToolAgentTarget,
  options: RunSuiteOptions = {},
): Promise<{ run: LabRun; qualification?: Qualification }> {
  const trials = options.trials ?? 3;
  const started = Date.now();

  // Which scenarios, and may this run certify anything?
  //
  // The guard below is the whole point of splitting the pools. A qualification
  // issued from the open pool would be indistinguishable from a real one and
  // would certify only that the agent's authors had read the tests. Rather
  // than quietly downgrade such a run, this refuses it.
  const pool: Pool = options.pool ?? (options.qualifyFor ? "held-out" : "open");

  if (options.qualifyFor && pool !== "held-out") {
    throw new PoolError(
      "qualification_requires_held_out",
      "A qualification can only be issued from the held-out pool. The open pool is for " +
        "iteration: an agent can be tuned against it until it passes, which is what makes " +
        "the score meaningless. Re-run with pool: \"held-out\".",
    );
  }

  const pack = options.pack
    ?? (pool === "held-out" ? heldOutPool(options.cohort) : await openPool());

  if (pack.length === 0) {
    throw new PoolError("empty_pack", `The ${pool} pool is empty.`);
  }

  // What this run will claim it measured. A caller-supplied suite is identified
  // by its own name and a fingerprint of the scenarios that actually ran, so a
  // signed record never labels a customer's suite as our standard pack.
  const suiteId = options.suite?.id ?? (options.pack ? `custom:${suiteFingerprint(pack)}` : packId);
  const suiteVersion = options.suite?.version ?? (options.pack ? suiteFingerprint(pack) : packVersion);

  // A caller can pass its own pack. That must not become a way around the
  // guard above: if this run is going to certify anything, every scenario in
  // it has to actually be held out, whoever supplied them.
  if (options.qualifyFor) {
    const leaked = (pack as { id: string; pool?: Pool }[]).filter((s) => s.pool !== "held-out");
    if (leaked.length > 0) {
      throw new PoolError(
        "pack_not_held_out",
        `${leaked.length} of ${pack.length} scenarios in this pack are not from the held-out pool ` +
          `(${leaked.slice(0, 3).map((s) => s.id).join(", ")}${leaked.length > 3 ? ", …" : ""}). ` +
          "A qualification cannot be issued from scenarios the agent's authors can read.",
      );
    }
  }

  // One cohort, one score, per agent version.
  const cohort = options.cohort
    ?? (pool === "held-out" ? (pack[0] as { cohort?: string }).cohort : undefined);
  if (options.qualifyFor && cohort && !options.allowRetake) {
    const version = target.version ?? "unversioned";
    if (cohortAlreadyUsed(cohort, target.name, version)) {
      throw new PoolError(
        "cohort_already_used",
        `${target.name} ${version} has already been scored against cohort ${cohort}. ` +
          "Generate a new cohort, or pass allowRetake to record this as a retake.",
      );
    }
  }

  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const grades: EpisodeGrade[] = [];
  const traces: EpisodeTrace[] = [];

  for (const scenario of pack) {
    for (let trial = 1; trial <= trials; trial++) {
      const trace = await runEpisode(target, scenario, { trial, maxSteps: options.maxSteps });
      traces.push(trace);
      grades.push(gradeEpisode(scenario, trace));
    }
  }

  const axes = scoreFourAxes(pack, grades, trials);
  const previous = readLabRuns().at(-1) ?? null;

  const body = {
    kind: "limulus.labrun.v1" as const,
    id: `lab_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    createdAt: new Date().toISOString(),
    agent: {
      name: target.name,
      version: target.version ?? "unversioned",
      endpoint: target.endpoint ?? "in-process",
      promptHash: target.promptHash,
      toolConfigHash: toolConfigHash(),
    },
    suite: {
      id: suiteId,
      version: suiteVersion,
      scenarioCount: pack.length,
      trials,
      episodes: grades.length,
    },
    axes,
    grades,
    pool,
    ...(cohort ? { cohort } : {}),
    durationMs: Date.now() - started,
    prevHash: previous ? previous.hash : null,
  };

  const hash = sha256(canonical(body));
  const run: LabRun = { ...body, hash, signature: signHash(hash), publicKey: publicKeyPem };

  appendFileSync(runsPath, `${JSON.stringify(run)}\n`);

  // Burn the cohort for this agent version, so the next scored run has to use
  // scenarios it has not seen.
  if (options.qualifyFor && cohort) {
    recordCohortUse({
      cohort,
      agent: target.name,
      version: target.version ?? "unversioned",
      at: new Date().toISOString(),
      runId: run.id,
    });
  }
  for (const trace of traces) appendFileSync(tracesPath, `${JSON.stringify({ ...trace, runId: run.id })}\n`);

  // A qualification is only issued when one was asked for, and always at the
  // level the run earned — never at the level the customer wanted.
  const qualification = options.qualifyFor
    ? issueQualification({
        level: axes.level,
        runId: run.id,
        scores: {
          safety: axes.safety.score,
          capability: axes.capability.score,
          recovery: axes.recovery.score,
          reliability: axes.reliability?.score ?? null,
        },
        binding: {
          ...options.qualifyFor,
          agent: {
            name: run.agent.name,
            version: run.agent.version,
            promptHash: run.agent.promptHash,
            toolConfigHash: run.agent.toolConfigHash,
          },
          suite: { id: pool === "held-out" ? `held-out:${cohort}` : suiteId, version: suiteVersion, scenarioCount: pack.length, trials },
        },
      })
    : undefined;

  return { run, qualification };
}

export function verifyLabRun(run: LabRun): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const { hash, signature, publicKey, ...body } = run;
  const recomputed = sha256(canonical(body));
  if (recomputed !== hash) problems.push("run contents do not match its hash");
  if (!verifySignature(recomputed, signature, publicKey)) problems.push("signature does not cover these contents");
  return { ok: problems.length === 0, problems };
}

/** Report card for the CLI and the dashboard. */
export function formatLabRun(run: LabRun): string {
  const { axes } = run;
  const bar = (score: number) => `${"#".repeat(Math.round(score / 10))}${"-".repeat(10 - Math.round(score / 10))}`;
  const line = (label: string, d: { score: number; sampleSize: number; detail: string } | null) =>
    d === null
      ? `  ${label.padEnd(12)} ${"-".repeat(10)}  not measured`
      : `  ${label.padEnd(12)} ${bar(d.score)} ${String(d.score).padStart(3)}   ${d.detail}`;

  const lines = [
    `Limulus Lab run  ${run.id}`,
    `Agent    ${run.agent.name} v${run.agent.version}`,
    `Suite    ${run.suite.id} ${run.suite.version} — ${run.suite.scenarioCount} scenarios x ${run.suite.trials} trials = ${run.suite.episodes} episodes`,
    `Level    ${axes.level.toUpperCase()}`,
    `         ${axes.levelReason}`,
    "",
    line("Safety", axes.safety),
    line("Capability", axes.capability),
    line("Recovery", axes.recovery),
    line("Reliability", axes.reliability),
  ];

  if (axes.criticalViolations.length > 0) {
    const counted = new Map<string, number>();
    for (const v of axes.criticalViolations) counted.set(v.code, (counted.get(v.code) ?? 0) + 1);
    lines.push("", `Critical violations (${axes.criticalViolations.length})`);
    for (const [code, count] of counted) {
      const example = axes.criticalViolations.find((v) => v.code === code)!;
      lines.push(`  ${code}  x${count}  (${example.scenarioId})`);
      lines.push(`      ${example.detail}`);
    }
  }

  if (axes.inconsistentScenarios.length > 0) {
    lines.push("", `Inconsistent across trials (${axes.inconsistentScenarios.length})`);
    for (const s of axes.inconsistentScenarios) {
      lines.push(`  ${s.scenarioId}  ${s.outcomes.join(" / ")}`);
    }
  }

  lines.push("", `Signed ${run.signature.slice(0, 32)}...  prev ${run.prevHash?.slice(0, 12) ?? "none"}`);
  return lines.join("\n");
}

export const labRunsFile = runsPath;
export const episodesFile = tracesPath;
