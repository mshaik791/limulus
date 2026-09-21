import { readLabRuns, type LabRun } from "./sandbox/lab.ts";
import type { EpisodeGrade } from "./sandbox/score.ts";
import { modeById } from "./bench/taxonomy.ts";

// The sentence a customer actually pays for: "your agent fails on X." Aggregates
// Lab results for one agent config, by taxonomy node, across every run — and
// refuses to say anything a small sample cannot support. A rate is shown only
// with its n and a 95% Wilson interval; below a minimum n it says "not enough
// trials" rather than inventing a number. No model is involved.

const MIN_N = 10;
const Z = 1.96; // 95%

/** Wilson score interval for a proportion — honest at small n, unlike normal-approx. */
export function wilson(successes: number, n: number): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 0 };
  const p = successes / n;
  const z2 = Z * Z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const margin = (Z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

export type NodeStat = {
  node: string;
  trials: number;
  failures: number;
  rate: number;
  ci: { low: number; high: number };
  /** Sum of simulated amounts that settled in the failing episodes. Labelled simulated everywhere. */
  wrongfulAmountSimulated: number;
  worst?: { runId: string; scenarioId: string };
  enoughData: boolean;
};

export type FailureProfile = {
  config: { name: string; version: string; promptHash?: string; toolConfigHash?: string };
  runIds: string[];
  totalEpisodes: number;
  nodes: NodeStat[];
  findings: string[];
};

/** Every distinct agent config that has Lab runs. */
export function agentConfigs(runs = readLabRuns()): { name: string; version: string }[] {
  const seen = new Map<string, { name: string; version: string }>();
  for (const r of runs) seen.set(`${r.agent.name}@${r.agent.version}`, { name: r.agent.name, version: r.agent.version });
  return [...seen.values()];
}

const pct = (x: number) => Math.round(x * 100);

function phrase(n: NodeStat): string {
  const desc = (modeById(n.node)?.description ?? n.node).replace(/\.$/, "");
  if (!n.enoughData) return `${n.node} — not enough trials to say (${n.failures}/${n.trials}); need at least ${MIN_N}.`;
  return (
    `${n.node} — ${desc}: ${n.failures} of ${n.trials} trials failed ` +
    `(${pct(n.rate)}%, 95% CI ${pct(n.ci.low)}–${pct(n.ci.high)}%), simulated exposure ${n.wrongfulAmountSimulated.toLocaleString()}. ` +
    (n.worst ? `worst: run ${n.worst.runId} / ${n.worst.scenarioId} — reproduce: node src/bench/failure-bundle.ts ${n.worst.runId}; fix: node src/bench/twin.ts to compare a proposed config.` : "")
  );
}

/** Build a profile for one agent config across all its runs. */
export function profileForConfig(name: string, version: string, runs = readLabRuns()): FailureProfile {
  const mine = runs.filter((r) => r.agent.name === name && r.agent.version === version);
  const stats = new Map<string, { trials: number; failures: number; wrongful: number; worst?: { runId: string; scenarioId: string } }>();
  let totalEpisodes = 0;

  for (const run of mine) {
    for (const g of run.grades as EpisodeGrade[]) {
      if (g.unusable) continue;
      totalEpisodes++;
      const failed = g.criticalCount > 0;
      for (const node of g.taxonomy ?? []) {
        const s = stats.get(node) ?? { trials: 0, failures: 0, wrongful: 0 };
        s.trials++;
        if (failed) {
          s.failures++;
          s.wrongful += g.paidAmount ?? 0;
          if (!s.worst) s.worst = { runId: run.id, scenarioId: g.scenarioId };
        }
        stats.set(node, s);
      }
    }
  }

  const nodes: NodeStat[] = [...stats.entries()]
    .map(([node, s]) => ({
      node, trials: s.trials, failures: s.failures, rate: s.trials ? s.failures / s.trials : 0,
      ci: wilson(s.failures, s.trials), wrongfulAmountSimulated: s.wrongful, worst: s.worst, enoughData: s.trials >= MIN_N,
    }))
    // Rank by the lower bound of the interval: what we can defend, not the point estimate.
    .sort((a, b) => b.ci.low - a.ci.low || b.rate - a.rate);

  const findings = nodes.filter((n) => n.failures > 0).map(phrase);

  const agent = mine[0]?.agent;
  return {
    config: { name, version, promptHash: agent?.promptHash, toolConfigHash: agent?.toolConfigHash },
    runIds: mine.map((r) => r.id),
    totalEpisodes,
    nodes,
    findings,
  };
}

export type NodeDiff = { node: string; rateA: number; rateB: number; delta: number; note: string };

/** Compare two configs of the same agent, per taxonomy node — a regression or an improvement. */
export function compareProfiles(name: string, vA: string, vB: string, runs = readLabRuns()): NodeDiff[] {
  const a = profileForConfig(name, vA, runs);
  const b = profileForConfig(name, vB, runs);
  const byNodeA = new Map(a.nodes.map((n) => [n.node, n]));
  const byNodeB = new Map(b.nodes.map((n) => [n.node, n]));
  const nodes = new Set([...byNodeA.keys(), ...byNodeB.keys()]);
  const diffs: NodeDiff[] = [];
  for (const node of nodes) {
    const rateA = byNodeA.get(node)?.rate ?? 0;
    const rateB = byNodeB.get(node)?.rate ?? 0;
    const delta = rateB - rateA;
    if (Math.abs(delta) < 1e-9) continue;
    diffs.push({ node, rateA, rateB, delta, note: delta > 0 ? "worse in " + vB : "better in " + vB });
  }
  return diffs.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}
