import { referenceToolAgents } from "./sandbox/agents.ts";
import { formatLabRun, readLabRuns, readTraces, runSuite, verifyLabRun } from "./sandbox/lab.ts";
import { checkScope, readQualifications, revokeQualification, verifyQualification } from "./qualification.ts";
import { fullSuite } from "./bench/pack-hard-v1.ts";
import { loadScenarioDir, toScenarioFile } from "./bench/scenario-file.ts";
import { scenarios as payments } from "./bench/pack-payments-v1.ts";
import { generateVariants, OPERATORS } from "./bench/variants.ts";
import { compareArms, formatCompare, readCompares, verifyCompare } from "./sandbox/compare.ts";
import { CONTROL_MODES, type ControlMode } from "./sandbox/controls.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolAgentTarget } from "./sandbox/episode.ts";

// Run an agent through the Lab: every scenario, several trials, in the
// simulated world.
//
//   node src/lab-cli.ts run careful [trials]
//   node src/lab-cli.ts run careful 3 --scenarios ./scenarios     a suite from files
//   node src/lab-cli.ts run http://localhost:9000/agent [trials]
//   node src/lab-cli.ts qualify careful [trials]
//   node src/lab-cli.ts runs
//   node src/lab-cli.ts trace <runId> [scenarioId]
//   node src/lab-cli.ts quals
//   node src/lab-cli.ts scope <qualId> <amount>
//   node src/lab-cli.ts revoke <qualId> "reason"
//   node src/lab-cli.ts compare careful:off careful:enforced naive:enforced [--trials 3] [--scenarios dir]
//   node src/lab-cli.ts compare "Claude Sonnet=http://localhost:9100/agent?model=anthropic/claude-sonnet-4.5:off" ...
//   node src/lab-cli.ts compares

const [command, ...args] = process.argv.slice(2);

const targetFor = (name: string): ToolAgentTarget => {
  if (referenceToolAgents[name]) return referenceToolAgents[name];
  if (name.startsWith("http")) return { name: new URL(name).host, version: "external", endpoint: name };
  console.error(`Unknown agent "${name}". Use one of: ${Object.keys(referenceToolAgents).join(", ")}, or a URL.`);
  process.exit(2);
};

const flag = (name: string, fallback?: string) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : fallback;
};

switch (command) {
  // Deterministic variant generation from a clean seed scenario.
  //   node src/lab-cli.ts generate --seed man-003 --count 3 [--operators a,b] [--out dir]
  case "generate": {
    const seedId = flag("--seed", args[0]);
    const count = Number(flag("--count", "3"));
    const opsArg = flag("--operators", "");
    const operatorIds = opsArg ? opsArg.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    let seed = payments.find((s) => s.id === seedId);
    if (!seed && seedId) seed = (await fullSuite()).find((s) => s.id === seedId);
    if (!seedId || !seed) {
      const clean = payments.filter((s) => s.expected === "proceed").map((s) => s.id);
      console.error(`generate needs a seed. Unknown seed ${JSON.stringify(seedId)}.`);
      console.error(`Clean seeds to start from: ${clean.join(", ")}`);
      console.error(`Operators: ${OPERATORS.map((o) => o.id).join(", ")}`);
      process.exit(2);
    }
    const outDir = flag("--out", join("build", "variants", seed.id))!;
    const variants = generateVariants(seed, { operatorIds, count });
    mkdirSync(outDir, { recursive: true });
    for (const v of variants) writeFileSync(join(outDir, `${v.id}.scenario.json`), toScenarioFile(v));
    const controls = variants.filter((v) => v.operators?.[0]?.endsWith(":control")).length;
    console.log(`seed       ${seed.id}  (${seed.title})`);
    console.log(`operators  ${operatorIds ? operatorIds.join(", ") : `all ${OPERATORS.length}`}`);
    console.log(`variants   1 seed -> ${variants.length} variants (${variants.length - controls} trap, ${controls} pay-control), deduped by fingerprint`);
    console.log(`written    ${outDir}/`);
    console.log(`run them   node src/lab-cli.ts run careful 3 --scenarios ${outDir}`);
    break;
  }
  case "run":
  case "qualify": {
    const target = targetFor(args[0] ?? "careful");
    // Thirty by default — a rate needs an n that can tell signal from noise
    // (build prompt Phase 4). Pass a smaller number as the second argument for a
    // quick check.
    const trials = Number(args[1] ?? 30);

    // --full runs the original pack plus the hard library: 75 scenarios.
    // --scenarios <dir> runs a suite of declarative files instead, which is how a
    // customer runs their own scenarios alongside ours.
    const dirFlag = args.indexOf("--scenarios");
    let pack = args.includes("--full") ? await fullSuite() : undefined;
    let suite: { id: string; version?: string } | undefined;

    if (dirFlag > -1) {
      const dir = args[dirFlag + 1];
      if (!dir) {
        console.error("--scenarios needs a directory of *.scenario.json files");
        process.exit(2);
      }
      const { scenarios, problems } = loadScenarioDir(dir);
      const errors = problems.filter((p) => p.severity === "error");
      // Refusing to run a partial suite. Scoring 9 of 10 scenarios and reporting
      // the result as a suite score would understate coverage silently.
      if (errors.length > 0) {
        console.error(`\n  ${errors.length} scenario file(s) are invalid. Not running a partial suite.`);
        console.error(`  node src/bench/validate-scenarios.ts ${dir}\n`);
        process.exit(1);
      }
      if (scenarios.length === 0) {
        console.error(`\n  No *.scenario.json files found under ${dir}\n`);
        process.exit(2);
      }
      for (const p of problems) console.log(`  warning  ${p.file} ${p.field}: ${p.detail}`);
      console.log(`  suite from files: ${scenarios.length} scenario(s) from ${dir}\n`);
      pack = scenarios;
      suite = { id: `files:${dir.replace(/^\.\//, "")}` };
    }

    const { run, qualification } = await runSuite(target, {
      pack,
      suite,
      trials,
      qualifyFor:
        command === "qualify"
          ? {
              workflow: "invoice-payment",
              rail: "ach",
              currency: "USD",
              amountLimit: 5_000,
              approvalPolicy: "A person approves anything above the qualified ceiling or off the vendor file.",
              payeeScope: "on-file",
            }
          : undefined,
    });

    console.log(formatLabRun(run));

    if (qualification) {
      console.log("");
      console.log(`Qualification  ${qualification.id}`);
      console.log(`  level     ${qualification.level}`);
      console.log(`  scope     ${qualification.binding.workflow} / ${qualification.binding.rail} / up to ${qualification.binding.amountLimit.toLocaleString()} ${qualification.binding.currency} / vendors ${qualification.binding.payeeScope}`);
      // What the run pulled in from what was asked for, so the scope card shows
      // the revoked capabilities rather than only the ones that survived.
      for (const n of qualification.scopeNarrowing ?? []) {
        console.log(`  narrowed  ${n.dimension}: ${n.from} → ${n.to}${n.evidence.length ? `  (${n.evidence.slice(0, 3).join(", ")}${n.evidence.length > 3 ? ", …" : ""})` : ""}`);
      }
      console.log(`  bound to  ${qualification.binding.agent.name} v${qualification.binding.agent.version}, tools ${qualification.binding.agent.toolConfigHash.slice(0, 12)}, suite ${qualification.binding.suite.id} ${qualification.binding.suite.version}`);
      console.log(`  expires   ${qualification.expiresAt.slice(0, 10)}`);
      const check = verifyQualification(qualification);
      console.log(`  signature ${check.ok ? "verifies" : check.problems.join("; ")}`);
    }
    break;
  }

  // The same scenarios under several configurations. Each arm is <agent>:<mode>,
  // where agent is a reference name or a URL and mode is off, advisory or
  // enforced. Every arm runs the identical pack.
  case "compare": {
    const armSpecs = args.filter((a) => !a.startsWith("--") && !CONTROL_MODES.includes(a as ControlMode) && !/^\d+$/.test(a) && a !== flag("--scenarios") && a !== flag("--trials"));
    if (armSpecs.length < 2) {
      console.error("compare needs at least two arms, each <agent>:<off|advisory|enforced>. Example: careful:off careful:enforced");
      process.exit(2);
    }
    // An arm is <agent>:<mode>, optionally "<label>=<agent>:<mode>" so a URL
    // arm can carry a readable name. The label is what every screen shows.
    const arms = armSpecs.map((spec) => {
      const labelled = spec.match(/^([^=]+)=(.+)$/);
      const rest = labelled ? labelled[2] : spec;
      const m = rest.match(/^(.*):(off|advisory|enforced)$/);
      const agent = m ? m[1] : rest;
      const mode = (m ? m[2] : "off") as ControlMode;
      return { label: labelled ? labelled[1].trim() : `${agent}:${mode}`, target: targetFor(agent), controls: mode };
    });
    const trials = Number(flag("--trials", "3"));
    const dir = flag("--scenarios");
    let pack = payments;
    let suite: { id: string } | undefined;
    if (dir) {
      const { scenarios, problems } = loadScenarioDir(dir);
      const errors = problems.filter((p) => p.severity === "error");
      if (errors.length > 0 || scenarios.length === 0) {
        console.error(`\n  ${errors.length} invalid scenario file(s) under ${dir}, or none found. Not comparing on a partial suite.\n`);
        process.exit(1);
      }
      pack = scenarios;
      suite = { id: `files:${dir.replace(/^\.\//, "")}` };
    }
    const record = await compareArms(arms, { pack, trials, suite });
    console.log("");
    console.log(formatCompare(record));
    console.log("");
    break;
  }
  case "compares": {
    for (const c of readCompares()) {
      const v = verifyCompare(c);
      console.log(`${c.id}  ${c.createdAt.slice(0, 16)}  ${c.suite.id} × ${c.suite.trials}  arms: ${c.arms.map((a) => `${a.label} (${a.criticalViolations} critical)`).join(", ")}  recommended: ${c.recommendation.label ?? "none"}  ${v.ok ? "verifies" : "BROKEN"}`);
    }
    break;
  }
  case "runs": {
    const runs = readLabRuns();
    if (runs.length === 0) console.log("No Lab runs yet.  node src/lab-cli.ts run careful");
    for (const run of runs) {
      const verified = verifyLabRun(run).ok ? "sealed" : "BROKEN";
      console.log(
        `${run.createdAt}  ${run.id}  ${run.agent.name.padEnd(24)} ${run.axes.level.padEnd(20)} safety ${String(
          run.axes.safety.score,
        ).padStart(3)}  cap ${String(run.axes.capability.score).padStart(3)}  rec ${String(
          run.axes.recovery.score,
        ).padStart(3)}  rel ${String(run.axes.reliability?.score ?? "-").padStart(3)}  ${verified}`,
      );
    }
    break;
  }

  case "trace": {
    const traces = readTraces(args[0]).filter((t) => !args[1] || t.scenarioId === args[1]);
    if (traces.length === 0) console.log("No episodes for that run.");
    for (const trace of traces.slice(0, 12)) {
      console.log(`\n${trace.scenarioId}  trial ${trace.trial}  → ${trace.effective}${trace.error ? `  (${trace.error})` : ""}`);
      for (const call of trace.calls) {
        console.log(`  ${String(call.seq).padStart(2)}. ${call.tool}(${JSON.stringify(call.args)})`);
        console.log(`      → ${JSON.stringify(call.result).slice(0, 160)}`);
      }
      if (trace.declared) console.log(`  finished: ${trace.declared.action} — ${trace.declared.reason ?? ""}`);
    }
    break;
  }

  case "quals": {
    const quals = readQualifications();
    if (quals.length === 0) console.log("No qualifications issued.  node src/lab-cli.ts qualify careful");
    for (const q of quals) {
      const state = q.revokedAt ? "revoked" : Date.parse(q.expiresAt) < Date.now() ? "expired" : "valid";
      console.log(
        `${q.id}  ${q.level.padEnd(20)} ${state.padEnd(8)} ${q.binding.agent.name} v${q.binding.agent.version}  up to ${q.binding.amountLimit.toLocaleString()} ${q.binding.currency} ${q.binding.rail}  expires ${q.expiresAt.slice(0, 10)}`,
      );
    }
    break;
  }

  case "scope": {
    const [id, amount] = args;
    const check = checkScope(id ?? "", {
      agentName: "reference-careful-tools",
      agentVersion: "0.2.0",
      workflow: "invoice-payment",
      rail: "ach",
      currency: "USD",
      amount: Number(amount ?? 1000),
      payeeOnFile: true,
    });
    console.log(`within scope       ${check.withinScope}`);
    console.log(`requires approval  ${check.requiresApproval}`);
    for (const [index, reason] of check.reasons.entries()) {
      console.log(`  ${check.codes[index]}: ${reason}`);
    }
    break;
  }

  case "revoke": {
    const revoked = revokeQualification(args[0] ?? "", args[1] ?? "revoked from the CLI");
    console.log(revoked ? `Revoked ${revoked.id}` : "No active qualification with that id.");
    break;
  }

  default:
    console.log("Usage: node src/lab-cli.ts run|qualify|runs|trace|quals|scope|revoke");
}
