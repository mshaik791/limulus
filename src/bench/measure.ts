import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSuite } from "../sandbox/lab.ts";
import { referenceToolAgents } from "../sandbox/agents.ts";
import { scenarios as payments } from "./pack-payments-v1.ts";
import { generateVariants } from "./variants.ts";
import { profileForConfig } from "../failure-profile.ts";
import type { Scenario } from "./types.ts";

// The measurement pass. Runs the expanded suite (seeds + generated variants)
// against the reference agents in the unaided arm — deterministic, no LLM, no
// key — and writes research/RESULTS.md with n per cell and 95% intervals.
//
// What it does NOT do, and says so: the advisory and enforced arms, and any
// live-model run, need an LLM key and the live three-arm harness. No key is
// present, so those are deferred and model spend is $0.
//
//   node src/bench/measure.ts [trials]

const trials = Number(process.argv[2] ?? 20);
const here = dirname(fileURLToPath(import.meta.url));
const resultsPath = join(here, "..", "..", "research", "RESULTS.md");

// Expanded suite: the hand-written pack, plus deterministic variants of the two
// clean seeds (the operators inject one trap each; controls keep it measurable).
const cleanSeeds = payments.filter((s) => s.expected === "proceed" && s.id.startsWith("man"));
const variants: Scenario[] = cleanSeeds.flatMap((seed) => generateVariants(seed, { count: 2 }));
const expanded: Scenario[] = [...payments, ...variants];

console.log(`Expanded suite: ${payments.length} seeds + ${variants.length} variants = ${expanded.length} scenarios, ${trials} trials each.`);

const agents = [referenceToolAgents.naive, referenceToolAgents.careful];
const rows: string[] = [];

for (const agent of agents) {
  process.stdout.write(`  running ${agent.name} v${agent.version} ... `);
  const { run } = await runSuite(agent, { pack: expanded, suite: { id: "expanded-v1" }, trials, allowRetake: true });
  const p = profileForConfig(agent.name, agent.version ?? "unversioned", [run]);
  const ax = run.axes;
  console.log(`safety ${ax.safety.score} capability ${ax.capability.score}`);

  rows.push(`### ${agent.name} v${agent.version} — unaided arm\n`);
  rows.push(`Four axes (n = episodes behind each): safety **${ax.safety.score}** (n=${ax.safety.sampleSize}), ` +
    `capability **${ax.capability.score}** (n=${ax.capability.sampleSize}), ` +
    `recovery **${ax.recovery.score}** (n=${ax.recovery.sampleSize}), ` +
    `reliability **${ax.reliability?.score ?? "—"}** (n=${ax.reliability?.sampleSize ?? 0}). Readiness: ${run.level ?? ax.level}.\n`);
  const failing = p.nodes.filter((n) => n.failures > 0);
  if (failing.length === 0) rows.push(`No failing taxonomy node.\n`);
  else {
    rows.push(`| taxonomy node | failed / n | rate | 95% CI | simulated exposure |`);
    rows.push(`|---|---|---|---|---|`);
    for (const n of failing) {
      const pct = (x: number) => `${Math.round(x * 100)}%`;
      rows.push(`| ${n.node} | ${n.failures}/${n.trials}${n.enoughData ? "" : " ⚠ low n"} | ${pct(n.rate)} | ${pct(n.ci.low)}–${pct(n.ci.high)} | ${n.wrongfulAmountSimulated.toLocaleString()} |`);
    }
    rows.push("");
  }
}

const doc = `# RESULTS — measurement pass (2026-09-21)

**All figures below are from the deterministic reference agents in the *unaided* arm** (the
agent acts with the Lab's tools and no gate). They are labelled simulated; no real money and
no real rail are involved.

## What was run
- Suite: \`expanded-v1\` — ${payments.length} hand-written seed scenarios (\`payments-v1\`) plus
  ${variants.length} deterministic variants generated from the clean seeds (${cleanSeeds.map((s) => s.id).join(", ")}).
- Agents: \`reference-naive-tools\` and \`reference-careful-tools\` (deterministic, in-process).
- Trials: ${trials} per scenario. Every rate below carries its n and a 95% Wilson interval.

## What was NOT run, and why
- **Advisory and enforced arms** (agent asked to call the gate; rail holds every order) and any
  **live-model** run need an LLM key and the live three-arm harness (\`src/experiments/run.ts\`,
  which spawns a model). **No API key is present**, so these are deferred.
- **Model spend: $0**, against the $25 cap.
- Therefore the **skipped-control rate** (an advisory-arm metric) and the gate **false-block
  rate** (a gated-arm metric) are not measured here. The unaided arm has no gate to skip or to
  false-block; the Lab's *capability* score is the closest available proxy for legitimate-work
  completion, and it is reported per agent above.

## Results
${rows.join("\n")}
## Caveats
- Reference agents were written alongside the scenarios, so passing (or failing) them proves the
  measurement plumbing, not external validity. The point of the numbers here is that the pipeline
  produces honest, n-backed, interval-bounded, per-node figures — not that any specific rate
  generalises to a real customer agent.
- Variant amounts and accounts are synthetic. "Simulated exposure" sums the amounts that settled
  in failing episodes in the sandbox; no money moved.
- The single most important number for the product — how much the gate changes outcomes (the
  off vs enforced delta) — cannot be produced without a live model, and is deferred.
`;

writeFileSync(resultsPath, doc);
console.log(`\nWrote ${resultsPath}`);
