import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../record.ts";
import { readLabRuns, readTraces } from "../sandbox/lab.ts";
import { heldOutPool } from "./pools.ts";
import { toScenarioFile } from "./scenario-file.ts";
import { heldOutSecrets, publicFamilySamples, redactSecrets, twinFor, twinIsDistinct, uniqueHeldOutSentences } from "./twin.ts";
import type { EpisodeGrade } from "../sandbox/score.ts";
import type { Scenario } from "./types.ts";

// What a customer takes away from a run they did not pass.
//
//   node src/bench/failure-bundle.ts <runId> [--out build/bundles]
//
// The test applied to every file in here: could an engineer run it? A report they
// read once is a consulting deliverable. A directory they drop into their own CI,
// watch go red, fix, and watch go green is a product.
//
// What goes in:
//
//   twins/      a runnable scenario per distinct failure — same failure mode as
//               the one they failed, different particulars. Theirs to keep, read
//               and train on.
//   traces/     what their agent actually did, step by step, on the real run.
//               This is their own behaviour and it is the evidence, so it leaves
//               in full.
//   eval.jsonl  the same failures as an eval set: context in, correct action out.
//   suite.json  a manifest with the run id and a hash of every file.
//
// What does not go in: the held-out scenarios themselves. Not the text, not the
// amounts, not one sentence of an invoice. That restraint is the whole reason a
// qualification means anything three months later, and it is enforced here by
// refusing to write a bundle that contains held-out prose rather than trusted to
// reviewers noticing.

const arg = (flag: string, fallback?: string) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const runId = process.argv[2];
if (!runId || runId.startsWith("--")) {
  console.error("\n  usage: node src/bench/failure-bundle.ts <runId> [--out build/bundles]\n");
  process.exit(2);
}

const runs = readLabRuns();
const run = runs.find((r) => r.id === runId) ?? runs.find((r) => r.id.startsWith(runId));
if (!run) {
  console.error(`\n  No lab run "${runId}". Try: node src/lab-cli.ts runs\n`);
  process.exit(2);
}

const outRoot = arg("--out", "build/bundles")!;
const outDir = join(outRoot, run.id);

// ---- which scenarios actually failed ---------------------------------------
// Grouped by scenario, not by episode: three trials of one failure is one thing
// to fix, and shipping it three times would misrepresent the size of the problem.
const failuresByScenario = new Map<string, EpisodeGrade[]>();
for (const g of run.grades as EpisodeGrade[]) {
  if (g.unusable) continue;
  const failed = g.effective !== g.expected || g.criticalCount > 0;
  if (!failed) continue;
  failuresByScenario.set(g.scenarioId, [...(failuresByScenario.get(g.scenarioId) ?? []), g]);
}

console.log(`\n  Run ${run.id}`);
console.log(`  ${run.suite.scenarioCount} scenarios, ${run.suite.episodes} episodes, ${failuresByScenario.size} scenario(s) failed\n`);

if (failuresByScenario.size === 0) {
  console.log("  Nothing failed, so there is no bundle to build.\n");
  process.exit(0);
}

// The held-out instances behind this run, used only to check that none of their
// text escapes. Loaded and never written.
let heldOut: Scenario[] = [];
try {
  heldOut = heldOutPool(run.suite.id.startsWith("held-out:") ? run.suite.id.slice("held-out:".length) : undefined);
} catch {
  // An open-pool run has nothing to protect; the twin machinery still applies.
  heldOut = [];
}
// Two kinds of thing must not travel, checked separately because they fail for
// different reasons. Identifiers are secret outright. Sentences are secret only
// when a public regeneration of the same families does not produce them.
const publicBaseline = publicFamilySamples();
const secrets = heldOutSecrets(heldOut, publicBaseline);
const instanceProse = heldOut.length > 0 ? uniqueHeldOutSentences(heldOut, publicBaseline) : [];
const forbidden = [...secrets, ...instanceProse];

// ---- build ------------------------------------------------------------------
mkdirSync(join(outDir, "twins"), { recursive: true });
mkdirSync(join(outDir, "traces"), { recursive: true });

const traces = readTraces(run.id);
const files = new Map<string, string>();
const evalRows: string[] = [];
const summary: { scenario: string; family: string; twin: string; trials: number; wrongAllow: boolean }[] = [];
const skipped: { scenario: string; why: string }[] = [];
let totalRedactions = 0;

// A scenario id names its cohort, so it cannot be a filename in the bundle
// either. Traces are filed under the twin they correspond to instead.
const twinNameFor = new Map<string, string>();
const redactFileName = (scenarioId: string) => twinNameFor.get(scenarioId) ?? "unknown";

for (const [scenarioId, grades] of failuresByScenario) {
  let twin;
  try {
    twin = twinFor({ id: scenarioId });
  } catch (e) {
    // A hand-written scenario has no family to regenerate from. Say so rather
    // than shipping the original, which is the leak this file exists to prevent.
    skipped.push({ scenario: scenarioId, why: (e as Error).message });
    continue;
  }

  const original = heldOut.find((s) => s.id === scenarioId);
  if (original) {
    const distinct = twinIsDistinct(twin.scenario, original);
    if (!distinct.ok) {
      skipped.push({ scenario: scenarioId, why: `twin rejected — ${distinct.reason}` });
      continue;
    }
  }

  twinNameFor.set(scenarioId, twin.scenario.id);
  files.set(join("twins", `${twin.scenario.id}.scenario.json`), toScenarioFile(twin.scenario));

  // Their agent's own behaviour, in full. This is the evidence and it is theirs.
  const scenarioTraces = traces.filter((t) => t.scenarioId === scenarioId);
  const traceJson = JSON.stringify(
    scenarioTraces.map((t) => ({
      trial: t.trial,
      effective: t.effective,
      declared: t.declared,
      calls: t.calls,
      error: t.error,
    })),
    null,
    2,
  );
  // The agent names the held-out invoice in its own tool calls, so the trace
  // carries identifiers even though the behaviour is the customer's. Redacted
  // consistently: paying the same invoice twice still reads as the same invoice.
  const redacted = redactSecrets(traceJson, secrets);
  totalRedactions += redacted.replaced;
  files.set(join("traces", `${redactFileName(scenarioId)}.trace.json`), `${redacted.text}\n`);

  const wrongAllow = grades.some((g) => g.effective === "proceed" && g.expected !== "proceed");
  // An eval row describes the twin, not the held-out scenario, for the same
  // reason the twin exists.
  evalRows.push(
    JSON.stringify({
      id: twin.scenario.id,
      family: twin.family,
      task: twin.scenario.task,
      documents: twin.scenario.documents,
      authorization: twin.scenario.authorization,
      correct_action: twin.scenario.expected,
      observed_action: grades[0].effective,
      why: twin.scenario.rationale,
      severity: twin.scenario.severity,
    }),
  );

  summary.push({
    // The held-out id is not recorded: it names the cohort. The twin is the
    // customer-facing handle for this failure.
    scenario: twin.scenario.id,
    family: twin.family,
    twin: twin.scenario.id,
    trials: grades.length,
    wrongAllow,
  });
}

files.set("eval.jsonl", `${evalRows.join("\n")}\n`);

// ---- the leak check, before anything is written ----------------------------
// Checked against the bundle's full text, so a phrase quoted inside a trace is
// caught as readily as one inside a scenario.
const bundleText = [...files.values()].join("\n").toLowerCase();
const leakedSecrets = secrets.filter((x) => bundleText.includes(x));
const leakedProse = instanceProse.filter((x) => bundleText.includes(x));

if (leakedSecrets.length + leakedProse.length > 0) {
  console.error(`  Refusing to write this bundle: it carries held-out particulars.\n`);
  for (const x of leakedSecrets.slice(0, 6)) console.error(`    identifier  ${x}`);
  for (const x of leakedProse.slice(0, 3)) {
    console.error(`    sentence    "${x.slice(0, 84)}${x.length > 84 ? "…" : ""}"`);
  }
  console.error(
    `\n  Handing back the instance that failed turns the next qualification into a memory\n` +
      `  test. Traces are the likely source: an agent that quotes an invoice back in its own\n` +
      `  reasoning reproduces held-out identifiers inside its trace. Those need redacting.\n`,
  );
  process.exit(1);
}

const manifest = {
  runId: run.id,
  createdAt: new Date().toISOString(),
  agent: run.agent,
  suite: run.suite,
  level: run.level,
  failures: summary,
  skipped,
  contains: {
    twins: summary.length,
    traces: summary.length,
    evalRows: evalRows.length,
  },
  note:
    "Twins are regenerated stand-ins: the same failure mode as the scenario this agent failed, " +
    "with different particulars. The scenarios used to score the run are not included, which is " +
    "what keeps a later qualification meaningful. Traces are this agent's own behaviour.",
  fileHashes: Object.fromEntries([...files].map(([name, body]) => [name, sha256(body).slice(0, 16)])),
};
files.set("suite.json", `${JSON.stringify(manifest, null, 2)}\n`);

files.set(
  "README.md",
  [
    `# Failure bundle — ${run.id}`,
    "",
    `Agent: \`${run.agent.name}\` v${run.agent.version}`,
    `Suite: \`${run.suite.id}\` ${run.suite.version} — ${run.suite.scenarioCount} scenarios, ${run.suite.episodes} episodes`,
    `Readiness: **${run.level}**`,
    "",
    `${summary.length} scenario(s) failed. Each one is here twice: as a runnable scenario you can`,
    `reproduce locally, and as the trace of what your agent actually did.`,
    "",
    "## Run them",
    "",
    "```sh",
    "node src/bench/validate-scenarios.ts twins",
    "node src/lab-cli.ts run <your-agent-url> 3 --scenarios twins",
    "```",
    "",
    "## What is in here",
    "",
    "| Path | What it is |",
    "| --- | --- |",
    "| `twins/` | One scenario per failure. Same failure mode, different particulars. |",
    "| `traces/` | Your agent's steps on the real run, per trial. |",
    "| `eval.jsonl` | The same failures as an eval set: context in, correct action out. |",
    "| `suite.json` | Manifest, including a hash of every file here. |",
    "",
    "## Why the scenarios are not the ones you failed",
    "",
    "The scenarios that scored this run are held out, and they are only worth something",
    "while your agent's authors have not read them. If we handed them over, the next",
    "qualification would measure how well you had memorised this one. So each failure",
    "comes back regenerated: the same trap, different vendor, different amounts,",
    "different invoice numbers.",
    "",
    "That means these files are yours without reservation. Read them, commit them, put",
    "them in CI, use them as training data. Doing so should make your agent better at",
    "the failure mode rather than better at this specific test — which is the only kind",
    "of improvement a later run can confirm.",
    "",
    "## Failures",
    "",
    "| Scenario | Family | Twin | Trials | Wrong allow |",
    "| --- | --- | --- | --- | --- |",
    ...summary.map(
      (s) => `| \`${s.scenario}\` | ${s.family} | \`${s.twin}\` | ${s.trials} | ${s.wrongAllow ? "**yes**" : "no"} |`,
    ),
    "",
    summary.some((s) => s.wrongAllow)
      ? "A wrong allow is money moving on a call that was not the agent's to make. Those are the rows to fix first."
      : "No wrong allows: every failure here is friction rather than loss. Still worth fixing, but nothing moved money that should not have.",
    "",
  ].join("\n"),
);

for (const [name, body] of files) {
  const full = join(outDir, name);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body);
}

console.log(`  wrote ${files.size} file(s) to ${outDir}\n`);
for (const s of summary) {
  console.log(`    ${s.scenario.padEnd(34)} → twins/${s.twin}.scenario.json${s.wrongAllow ? "   (wrong allow)" : ""}`);
}
if (skipped.length > 0) {
  console.log(`\n  ${skipped.length} not bundled:`);
  for (const s of skipped) console.log(`    ${s.scenario}: ${s.why}`);
}
console.log(
  `\n  Leak check passed: none of ${secrets.length} held-out identifier(s) or ` +
    `${instanceProse.length} instance-specific sentence(s) appear in the bundle.\n`,
);
