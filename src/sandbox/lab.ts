import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { canonical, publicKeyPem, sha256, signHash, verifySignature } from "../record.ts";
import { runEpisode, type EpisodeTrace, type SubjectIdentity, type ToolAgentTarget } from "./episode.ts";
import { CONTROL_DESCRIPTION, type ControlMode } from "./controls.ts";
import { gradeEpisode, scoreFourAxes, type EpisodeGrade, type FourAxisResult } from "./score.ts";
import { toolCatalog } from "./env.ts";
import { issueQualification, type Qualification, type QualificationBinding } from "../qualification.ts";
import { deriveScope } from "./derive-scope.ts";
import { packId, packVersion, scenarios as defaultPack } from "../bench/pack-payments-v1.ts";
import {
  cohortAlreadyUsed, heldOutPool, openPool, PoolError, recordCohortUse, type Pool,
} from "../bench/pools.ts";
import type { Scenario } from "../bench/types.ts";

// A Lab run: every scenario, several times, in the simulated world, graded
// deterministically and sealed. Traces are kept so any finding can be replayed
// call by call — a report that cannot be audited is just an assertion.

const here = dirname(fileURLToPath(import.meta.url));
// LIMULUS_DATA_DIR isolates an engine's records; an end-to-end run in its own
// process must not seal fixture runs into the shared log.
const dataDir = process.env.LIMULUS_DATA_DIR ?? join(here, "..", "..", "data");
const runsPath = join(dataDir, "lab-runs.jsonl");
const tracesPath = join(dataDir, "episodes.jsonl");

export type LabRun = {
  kind: "limulus.labrun.v1";
  id: string;
  createdAt: string;
  agent: {
    name: string; version: string; endpoint: string; promptHash?: string; toolConfigHash: string;
    /**
     * Which model produced the run. A score describes one configuration, so a
     * run whose episodes disagree about the model did not measure one thing —
     * `inconsistent` says so rather than letting a reader assume it did.
     */
    subject: SubjectIdentity;
    /** The registered agent and version this run was bound to, when it came from the registry. */
    registry?: { agentId: string; versionId: string };
  };
  suite: { id: string; version: string; scenarioCount: number; trials: number; episodes: number };
  axes: FourAxisResult;
  grades: EpisodeGrade[];
  /**
   * How controls were wired. Part of the run's identity: the same agent on the
   * same scenarios with the gate off and with it enforced are two different
   * measurements, and a reader comparing them must be able to tell which is which.
   */
  controls: {
    mode: ControlMode;
    description: string;
    /**
     * Outcomes of the arm, aggregated. Every count carries its denominator,
     * because a rate without n is not a measurement.
     *
     * `skippedControl` is null in the off and enforced arms. In enforced the
     * agent cannot skip the gate, so a zero there would be a number that could
     * never have been anything else, inviting comparison against a real zero.
     */
    simulatedWrongfulAmount: number;
    falseBlocks: number;
    skippedControl: number | null;
    episodes: number;
  };
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
  /**
   * How controls are wired for this run. A run is one arm; Compare puts two
   * runs side by side rather than mixing arms inside one result.
   */
  controls?: ControlMode;
  /** Cancels the run between and inside steps. Nothing is sealed for a cancelled run. */
  signal?: AbortSignal;
  /** Called after each episode with real counts, so a job can report progress it did not invent. */
  onEpisode?: (progress: { completed: number; total: number; scenarioId: string; trial: number; unusable: boolean }) => void;
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
/**
 * One identity for a whole run, from every episode's.
 *
 * Kept deliberately pessimistic: any disagreement between episodes is carried
 * up rather than averaged away, because the useful fact is not "which model"
 * but "was this one configuration or several".
 */
function rollUpSubject(traces: EpisodeTrace[]): SubjectIdentity {
  // An episode the subject never answered says nothing about which model it
  // was, so it carries no identity here. It is still counted as unusable
  // everywhere else; what it must not do is register as "a second model" and
  // blank the identity of the episodes that did answer.
  const usable = traces.filter((t) => t.subject && !t.unusable);
  if (usable.length === 0) return { source: "unknown" };

  const ids = [...new Set(usable.map((t) => `${t.subject.model ?? "?"}@${t.subject.modelVersion ?? "?"}`))];
  const temps = [...new Set(usable.map((t) => t.subject.temperature).filter((x) => x !== undefined))];
  const episodeLevel = usable.flatMap((t) => t.subject.inconsistent ?? []);

  const problems = [...new Set(episodeLevel)];
  if (ids.length > 1) problems.push(`episodes ran against ${ids.length} different models: ${ids.join(", ")}`);
  if (temps.length > 1) problems.push(`temperature varied across episodes: ${temps.join(", ")}`);

  const first = usable[0].subject;
  return {
    model: ids.length === 1 ? first.model : undefined,
    modelVersion: ids.length === 1 ? first.modelVersion : undefined,
    temperature: temps.length === 1 ? temps[0] : undefined,
    source: usable.some((t) => t.subject.source === "configured")
      ? "configured"
      : usable.some((t) => t.subject.source === "self-reported")
        ? "self-reported"
        : "unknown",
    ...(problems.length ? { inconsistent: problems } : {}),
  };
}

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
  // Thirty when the run will certify something, three when it will not.
  //
  // Both halves of that are load-bearing and they came from different places. A
  // probabilistic system gives one answer once and another the next time, so a
  // handful of trials cannot separate a real rate from noise: a qualification
  // resting on three trials is a number nobody should sign. But thirty is the
  // wrong default for the development loop, where the same suite runs on every
  // commit and the cost is paid ten times a day for a signal three trials
  // already gives.
  //
  // So the default follows intent rather than one number winning: qualifyFor
  // means the result leaves the building, and that gets thirty. Anything else is
  // iteration and gets three. Callers override either way, and the connection
  // test passes one.
  const trials = options.trials ?? (options.qualifyFor ? 30 : 3);
  const controls: ControlMode = options.controls ?? "off";
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

  // What this run will claim it measured. A held-out run is named for its
  // cohort; a caller-supplied suite by its own name and a fingerprint of the
  // scenarios that actually ran. The run record and the qualification binding
  // read this from one place, because they are two views of the same claim.
  const suiteId =
    options.suite?.id
    ?? (pool === "held-out" ? `held-out:${cohort}` : options.pack ? `custom:${suiteFingerprint(pack)}` : packId);
  const suiteVersion =
    options.suite?.version
    ?? (pool === "held-out" || options.pack ? suiteFingerprint(pack) : packVersion);
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

  const total = pack.length * trials;
  for (const scenario of pack) {
    for (let trial = 1; trial <= trials; trial++) {
      const trace = await runEpisode(target, scenario, { trial, maxSteps: options.maxSteps, controls, signal: options.signal });
      traces.push(trace);
      grades.push(gradeEpisode(scenario, trace));
      options.onEpisode?.({ completed: traces.length, total, scenarioId: scenario.id, trial, unusable: Boolean(trace.unusable) });
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
      subject: rollUpSubject(traces),
      // A run of a registered agent names the agent and version records it was
      // bound to, so the console can link evidence to a connection precisely
      // rather than by endpoint host, which several models can share.
      ...(target.registry ? { registry: target.registry } : {}),
    },
    controls: {
      mode: controls,
      description: CONTROL_DESCRIPTION[controls],
      simulatedWrongfulAmount: traces.reduce((a, t) => a + (t.control?.simulatedWrongfulAmount ?? 0), 0),
      falseBlocks: traces.filter((t) => t.control?.falseBlock).length,
      skippedControl:
        controls === "advisory" ? traces.filter((t) => t.control?.skippedControl === true).length : null,
      episodes: traces.length,
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
  // level the run earned — never at the level the customer wanted. The scope is
  // derived the same way: the caller's qualifyFor is a ceiling, narrowed to what
  // the run actually cleared, so the signed record never claims more than was
  // measured.
  const derived = options.qualifyFor ? deriveScope(pack, grades, traces, options.qualifyFor) : undefined;
  const qualification = derived
    ? issueQualification({
        level: axes.level,
        runId: run.id,
        scores: {
          safety: axes.safety.score,
          capability: axes.capability.score,
          recovery: axes.recovery.score,
          reliability: axes.reliability?.score ?? null,
        },
        scopeNarrowing: derived.narrowing,
        binding: {
          ...derived.scope,
          agent: {
            name: run.agent.name,
            version: run.agent.version,
            promptHash: run.agent.promptHash,
            toolConfigHash: run.agent.toolConfigHash,
          },
          suite: { id: suiteId, version: suiteVersion, scenarioCount: pack.length, trials },
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
  // Every axis carries its n. A bare score hides how few episodes it rests on,
  // and a rate without its denominator is the thing this whole product argues
  // against (build prompt Phase 4: "report rates with n visible").
  const line = (label: string, d: { score: number; sampleSize: number; detail: string } | null) =>
    d === null
      ? `  ${label.padEnd(12)} ${"-".repeat(10)}  not measured`
      : `  ${label.padEnd(12)} ${bar(d.score)} ${String(d.score).padStart(3)}  n=${String(d.sampleSize).padStart(3)}  ${d.detail}`;

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
