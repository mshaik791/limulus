import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { canonical, publicKeyPem, sha256, signHash, verifySignature } from "../record.ts";

// Findings, sealed the same way decisions are.
//
// We are asking customers to trust signed evidence over assertions, so our own
// results are held to that standard: hashed, signed, and chained to the finding
// before them. A number that moved in our favour should be as hard to quietly
// revise as a payment decision.
//
// The conditions are stored alongside the numbers, because a result without the
// setup that produced it is not evidence of anything.

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const dataDir = join(root, "data");
const path = join(dataDir, "experiments.jsonl");

export type TrialOutcome = {
  condition: string;
  scenario: string;
  trial: number;
  invoiceId: string;
  attempted: boolean;
  attemptedWrongAccount: boolean;
  attemptedWrongAmount: boolean;
  moved: boolean;
  note: string;
};

export type ExperimentRecord = {
  kind: "limulus.experiment.v1";
  id: string;
  ranAt: string;
  question: string;
  /** Everything that would change the numbers if it changed. */
  setup: {
    trials: number;
    arms: string[];
    scenarios: { id: string; what: string }[];
    agentModel: string;
    agentHarness: string;
    /** How outcomes were determined. */
    measurement: string;
    /** Anything done to the environment that a reader should know about. */
    caveats: string[];
  };
  outcomes: TrialOutcome[];
  /** What we concluded, written when the result was recorded rather than later. */
  reading: string;
  prevHash: string | null;
  hash: string;
  signature: string;
  publicKey: string;
};

export function readExperiments(): ExperimentRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ExperimentRecord);
}

export function recordExperiment(
  input: Omit<ExperimentRecord, "kind" | "id" | "prevHash" | "hash" | "signature" | "publicKey">,
): ExperimentRecord {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const previous = readExperiments().at(-1) ?? null;

  const body = {
    kind: "limulus.experiment.v1" as const,
    id: `exp_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    ...input,
    prevHash: previous ? previous.hash : null,
  };

  const hash = sha256(canonical(body));
  const record: ExperimentRecord = { ...body, hash, signature: signHash(hash), publicKey: publicKeyPem };
  appendFileSync(path, `${JSON.stringify(record)}\n`);
  return record;
}

export function verifyExperiments(records: ExperimentRecord[] = readExperiments()) {
  const problems: { id: string; problem: string }[] = [];
  let expectedPrev: string | null = null;

  for (const record of records) {
    const { hash, signature, publicKey, ...body } = record;
    if (sha256(canonical(body)) !== hash) problems.push({ id: record.id, problem: "contents do not match the hash" });
    if (!verifySignature(hash, signature, publicKey)) problems.push({ id: record.id, problem: "signature does not verify" });
    if (record.prevHash !== expectedPrev) problems.push({ id: record.id, problem: "previous hash does not match the chain" });
    expectedPrev = hash;
  }

  return { ok: problems.length === 0, count: records.length, problems };
}

/** Counts per arm, per scenario, the way the report prints them. */
export function summarize(record: ExperimentRecord) {
  const scenarios = [...new Set(record.outcomes.map((o) => o.scenario))];
  const arms = record.setup.arms;

  return scenarios.map((scenario) => ({
    scenario,
    what: record.setup.scenarios.find((s) => s.id === scenario)?.what ?? scenario,
    rows: arms.map((arm) => {
      const rows = record.outcomes.filter((o) => o.scenario === scenario && o.condition === arm);
      const wrong = rows.filter((r) => r.attemptedWrongAccount || r.attemptedWrongAmount).length;
      return {
        arm,
        trials: rows.length,
        attempted: rows.filter((r) => r.attempted).length,
        wrong,
        moved: rows.filter((r) => r.moved).length,
        lost: rows.filter((r) => r.moved && (r.attemptedWrongAccount || r.attemptedWrongAmount)).length,
      };
    }),
  }));
}

/**
 * The findings file that gets committed. The sealed records live in data/ and
 * are git-ignored along with the rest of the chain, so this is the version a
 * reader of the repository sees — with the record id, so it can be checked
 * against the sealed copy.
 */
export function writeFindings(records: ExperimentRecord[] = readExperiments()): string {
  const lines = [
    "# Findings",
    "",
    "Results from running real agents against Limulus and against an ordinary payment tool.",
    "Each entry is sealed, signed and chained in `data/experiments.jsonl`; verify with",
    "`node src/experiments/log-cli.ts verify`.",
    "",
    "Numbers here have not been rounded in our favour, and the ones that went against the",
    "product are kept with the same prominence as the ones that did not.",
    "",
  ];

  for (const record of [...records].reverse()) {
    lines.push(`## ${record.ranAt.slice(0, 10)} — ${record.question}`);
    lines.push("");
    lines.push(`\`${record.id}\` · ${record.setup.trials} trials per arm · ${record.setup.agentModel}`);
    lines.push("");
    lines.push(`**How outcomes were measured.** ${record.setup.measurement}`);
    lines.push("");

    for (const scenario of summarize(record)) {
      lines.push(`### ${scenario.scenario} — ${scenario.what}`);
      lines.push("");
      lines.push("| arm | tried to pay | wrong account or amount | money moved | money lost |");
      lines.push("|---|---|---|---|---|");
      for (const row of scenario.rows) {
        const pct = (n: number) => (row.trials === 0 ? "—" : `${n}/${row.trials}`);
        lines.push(
          `| \`${row.arm}\` | ${pct(row.attempted)} | ${pct(row.wrong)} | ${pct(row.moved)} | ${row.lost === 0 ? "none" : pct(row.lost)} |`,
        );
      }
      lines.push("");
    }

    if (record.setup.caveats.length > 0) {
      lines.push("**Caveats.**");
      for (const caveat of record.setup.caveats) lines.push(`- ${caveat}`);
      lines.push("");
    }

    lines.push(`**Reading.** ${record.reading}`);
    lines.push("");
  }

  const text = lines.join("\n");
  writeFileSync(join(root, "FINDINGS.md"), text);
  return text;
}

export const experimentsFile = path;
