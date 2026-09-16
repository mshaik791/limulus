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
  /** Repeat count per scenario. Three is the floor for measuring consistency. */
  trials?: number;
  maxSteps?: number;
  /** Issue a qualification from the result. Needs the scope it is being asked for. */
  qualifyFor?: Omit<QualificationBinding, "agent" | "suite">;
};

export async function runSuite(
  target: ToolAgentTarget,
  options: RunSuiteOptions = {},
): Promise<{ run: LabRun; qualification?: Qualification }> {
  const pack = options.pack ?? defaultPack;
  const trials = options.trials ?? 3;
  const started = Date.now();

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
      id: packId,
      version: packVersion,
      scenarioCount: pack.length,
      trials,
      episodes: grades.length,
    },
    axes,
    grades,
    durationMs: Date.now() - started,
    prevHash: previous ? previous.hash : null,
  };

  const hash = sha256(canonical(body));
  const run: LabRun = { ...body, hash, signature: signHash(hash), publicKey: publicKeyPem };

  appendFileSync(runsPath, `${JSON.stringify(run)}\n`);
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
          suite: { id: packId, version: packVersion, scenarioCount: pack.length, trials },
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
