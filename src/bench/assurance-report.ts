import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readLabRuns, verifyLabRun, type LabRun } from "../sandbox/lab.ts";
import { readQualifications } from "../qualification.ts";
import { FAMILIES } from "./families.ts";
import { publicKeyPem } from "../record.ts";

// The thing a controller hands to somebody else.
//
// A score in a dashboard is not what a finance team is buying. What they need
// is a document they can put in front of their CFO or their auditor that says
// what was tested, what happened, what limit follows from it, and how to check
// that the document has not been altered. The score is one line of it.
//
// Two rules shaped this. It states what was NOT tested as prominently as what
// was — a coverage claim a reader cannot check is worth nothing. And it is
// generated only from a held-out run, because a report from the open pool would
// look identical and mean nothing.
//
//   node src/bench/assurance-report.ts                  most recent held-out run
//   node src/bench/assurance-report.ts --run lab_xxx
//   node src/bench/assurance-report.ts --out build/reports

const arg = (flag: string, fallback?: string) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};

export type FamilyResult = {
  key: string;
  tests: string;
  source: string;
  expected: string;
  episodes: number;
  correct: number;
  criticalViolations: number;
  /** The scenario ids that went wrong, so a reader can ask about them. */
  failures: string[];
};

export type AssuranceReport = {
  kind: "limulus.assurance.v1";
  generatedAt: string;
  run: {
    id: string;
    createdAt: string;
    hash: string;
    signature: string;
    chainVerified: boolean;
  };
  subject: {
    agent: string;
    version: string;
    toolConfigHash: string;
    endpoint: string;
  };
  evaluation: {
    pool: "held-out";
    cohort?: string;
    scenarios: number;
    trialsEach: number;
    episodes: number;
    families: FamilyResult[];
  };
  scores: { safety: number; capability: number; recovery: number; reliability: number | null };
  outcome: {
    level: string;
    reason: string;
    /** What this level actually permits, in plain terms. */
    permits: string[];
    /** What it does not. */
    withholds: string[];
  };
  qualification?: { id: string; expiresAt: string; amountLimit: number; rail: string; payeeScope: string };
  limitations: string[];
  verification: {
    publicKey: string;
    howTo: string[];
  };
};

const LEVEL_MEANING: Record<string, { permits: string[]; withholds: string[] }> = {
  experimental: {
    permits: ["Running in a sandbox where no money moves."],
    withholds: ["Any contact with a live payment rail.", "Any payment, supervised or not."],
  },
  "shadow-ready": {
    permits: [
      "Running alongside a person who makes the actual decision.",
      "Recording what it would have done, for comparison.",
    ],
    withholds: ["Releasing a payment on its own.", "Acting without a person reviewing each decision."],
  },
  "human-supervised": {
    permits: ["Preparing payments for a named approver to release."],
    withholds: ["Releasing without an approval.", "Operating outside business hours."],
  },
  "limited-autonomous": {
    permits: [
      "Releasing payments inside the qualified scope without a person.",
      "Escalating anything outside it.",
    ],
    withholds: [
      "Payments above the qualified ceiling.",
      "Payees not on file.",
      "Rails other than the qualified one.",
    ],
  },
  "expanded-autonomous": {
    permits: ["Releasing payments across the qualified workflows without a person."],
    withholds: ["Anything the authorization itself does not permit."],
  },
};

const familyOf = (scenarioId: string) =>
  FAMILIES.find((f) => scenarioId.startsWith(`held-${f.key}-`))?.key ?? "unclassified";

export function buildReport(run: LabRun): AssuranceReport {
  if (run.pool !== "held-out") {
    throw new Error(
      `Run ${run.id} came from the ${run.pool} pool. An assurance report is only generated from a ` +
        `held-out run — one from the open pool would look identical and certify nothing.`,
    );
  }

  const chain = verifyLabRun(run);

  // ---- results per family ------------------------------------------------
  const families: FamilyResult[] = [];
  for (const family of FAMILIES) {
    const grades = run.grades.filter((g) => familyOf(g.scenarioId) === family.key);
    if (grades.length === 0) continue;
    families.push({
      key: family.key,
      tests: family.tests,
      source: family.source,
      expected: family.expected,
      episodes: grades.length,
      correct: grades.filter((g) => g.effective === g.expected).length,
      criticalViolations: grades.reduce((a, g) => a + (g.criticalCount ?? 0), 0),
      failures: [...new Set(grades.filter((g) => g.effective !== g.expected).map((g) => g.scenarioId))],
    });
  }

  const qualification = readQualifications()
    .filter((q) => q.runId === run.id)
    .at(-1);

  const meaning = LEVEL_MEANING[run.axes.level] ?? { permits: [], withholds: [] };

  // ---- what this cannot tell you -----------------------------------------
  // Stated in the report rather than in a footnote, because a reader who
  // over-reads it is the failure mode that matters.
  const trials = run.suite.trials ?? 1;
  const limitations: string[] = [
    `Every result here comes from a simulated world. No money moved and no live rail was used.`,
    `${trials} trial(s) per scenario. Small samples only detect frequent failures — at five trials, ` +
      `a failure rate below roughly 40% is indistinguishable from zero.`,
    `This measures one configuration: ${run.agent.name} ${run.agent.version}, tool set ` +
      `${run.agent.toolConfigHash.slice(0, 12)}. Change the prompt, the model or a tool description and ` +
      `this result no longer describes the agent you are running.`,
  ];

  const untested = FAMILIES.filter((f) => !families.some((r) => r.key === f.key));
  if (untested.length > 0) {
    limitations.push(
      `Not exercised in this run: ${untested.map((f) => f.key).join(", ")}. No claim is made about them.`,
    );
  }
  if (run.axes.recovery.score === 0) {
    limitations.push(
      `The recovery axis was not exercised — no rail fault occurred — so its score of 0 means ` +
        `"not measured", not "failed".`,
    );
  }

  return {
    kind: "limulus.assurance.v1",
    generatedAt: new Date().toISOString(),
    run: {
      id: run.id,
      createdAt: run.createdAt,
      hash: run.hash,
      signature: run.signature,
      chainVerified: chain.ok,
    },
    subject: {
      agent: run.agent.name,
      version: run.agent.version,
      toolConfigHash: run.agent.toolConfigHash,
      endpoint: run.agent.endpoint,
    },
    evaluation: {
      pool: "held-out",
      cohort: run.cohort,
      scenarios: run.suite.scenarioCount,
      trialsEach: trials,
      episodes: run.grades.length,
      families,
    },
    scores: {
      safety: run.axes.safety.score,
      capability: run.axes.capability.score,
      recovery: run.axes.recovery.score,
      reliability: run.axes.reliability?.score ?? null,
    },
    outcome: {
      level: run.axes.level,
      reason: run.axes.levelReason,
      permits: meaning.permits,
      withholds: meaning.withholds,
    },
    ...(qualification
      ? {
          qualification: {
            id: qualification.id,
            expiresAt: qualification.expiresAt,
            amountLimit: qualification.binding.amountLimit,
            rail: qualification.binding.rail,
            payeeScope: qualification.binding.payeeScope,
          },
        }
      : {}),
    limitations,
    verification: {
      publicKey: publicKeyPem,
      howTo: [
        `The run is sealed: its body hashes to ${run.hash.slice(0, 16)}… and is signed with the key below.`,
        `Recompute it with: node src/verify-cli.ts`,
        `Or POST the receipt to /v1/receipts/verify, which takes no API key — a report only we can ` +
          `check is not evidence.`,
        `Every episode behind these numbers is kept as a trace and can be replayed call by call.`,
      ],
    },
  };
}

// --------------------------------------------------------------------- CLI
if (import.meta.filename === process.argv[1]) {
  const runId = arg("--run");
  const outDir = arg("--out", "build/reports")!;

  const runs = readLabRuns().filter((r) => r.pool === "held-out");
  if (runs.length === 0) {
    console.error(
      "\n  No held-out runs on record. Produce one first:\n" +
        "    node src/bench/generate-held-out.ts\n" +
        "    node src/sandbox/selftest.ts\n",
    );
    process.exit(1);
  }

  const run = runId ? runs.find((r) => r.id === runId) : runs.at(-1);
  if (!run) {
    console.error(`  No held-out run ${runId}.`);
    process.exit(1);
  }

  const report = buildReport(run);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, `${report.run.id}.json`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

  // ---- the same thing, readable ------------------------------------------
  const pad = (s: string, n: number) => s.padEnd(n);
  const lines: string[] = [];
  lines.push("");
  lines.push("  LIMULUS ASSURANCE REPORT");
  lines.push(`  ${report.subject.agent} ${report.subject.version}`);
  lines.push(`  run ${report.run.id} · ${report.run.createdAt}`);
  lines.push("");
  lines.push(`  WHAT WAS EVALUATED`);
  lines.push(`    held-out pool${report.evaluation.cohort ? `, cohort ${report.evaluation.cohort}` : ""}`);
  lines.push(`    ${report.evaluation.scenarios} scenarios × ${report.evaluation.trialsEach} trials = ${report.evaluation.episodes} episodes`);
  lines.push(`    tool set ${report.subject.toolConfigHash.slice(0, 16)}…`);
  lines.push("");
  lines.push(`  BY FAILURE CLASS`);
  for (const f of report.evaluation.families) {
    const flag = f.criticalViolations > 0 ? "  CRITICAL" : f.correct < f.episodes ? "  missed" : "";
    lines.push(`    ${pad(f.key, 22)}${pad(`${f.correct}/${f.episodes}`, 8)}${flag}`);
    if (f.failures.length > 0) lines.push(`      failed: ${f.failures.join(", ")}`);
  }
  lines.push("");
  lines.push(`  SCORES`);
  lines.push(`    safety ${report.scores.safety}   capability ${report.scores.capability}   ` +
    `recovery ${report.scores.recovery}   reliability ${report.scores.reliability ?? "n/a"}`);
  lines.push("");
  lines.push(`  OUTCOME: ${report.outcome.level}`);
  lines.push(`    ${report.outcome.reason}`);
  lines.push("");
  lines.push(`    This permits:`);
  for (const p of report.outcome.permits) lines.push(`      · ${p}`);
  lines.push(`    This does not permit:`);
  for (const w of report.outcome.withholds) lines.push(`      · ${w}`);
  if (report.qualification) {
    lines.push("");
    lines.push(`  QUALIFICATION ${report.qualification.id}`);
    lines.push(`    ${report.qualification.rail} · ceiling ${report.qualification.amountLimit.toLocaleString()} · ` +
      `payees ${report.qualification.payeeScope} · expires ${report.qualification.expiresAt.slice(0, 10)}`);
  }
  lines.push("");
  lines.push(`  WHAT THIS DOES NOT TELL YOU`);
  for (const l of report.limitations) lines.push(`    · ${l}`);
  lines.push("");
  lines.push(`  HOW TO CHECK THIS REPORT`);
  for (const h of report.verification.howTo) lines.push(`    · ${h}`);
  lines.push(`    chain verified at generation: ${report.run.chainVerified}`);
  lines.push("");

  const text = lines.join("\n");
  const textPath = join(outDir, `${report.run.id}.txt`);
  writeFileSync(textPath, `${text}\n`);

  console.log(text);
  console.log(`  written to ${jsonPath}`);
  console.log(`            ${textPath}\n`);
}
