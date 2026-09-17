import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Flattens the decision chain into relational tables.
//
// The chain in data/ is append-only JSON: good for proving what happened,
// useless for asking "which check fails most often". Embeddable — like every
// BI tool — wants columns. So this projects the chain into tables, emits CSV
// plus Postgres DDL, and leaves the chain untouched.
//
// This is a projection, not a migration. The chain stays the source of truth;
// anything here can be thrown away and rebuilt.
//
//   node src/warehouse/export.ts
//   node src/warehouse/export.ts --out build/warehouse

const DATA = "data";
const argOut = process.argv.indexOf("--out");
const OUT = argOut > -1 ? process.argv[argOut + 1] : "build/warehouse";

/** Lines that don't parse are counted, not fatal — some files here are notes. */
function readJsonl(file: string): { rows: unknown[]; skipped: number } {
  const path = join(DATA, file);
  if (!existsSync(path)) return { rows: [], skipped: 0 };
  const rows: unknown[] = [];
  let skipped = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      skipped++;
    }
  }
  return { rows, skipped };
}

type Row = Record<string, string | number | boolean | null>;
type Column = { name: string; type: "text" | "numeric" | "bigint" | "boolean" | "timestamptz" };
type Table = { name: string; columns: Column[]; rows: Row[]; note: string };

const tables: Table[] = [];
const skips: string[] = [];

const table = (name: string, note: string, columns: Column[], rows: Row[]) => {
  tables.push({ name, note, columns, rows });
};

const asNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const asText = (v: unknown): string | null =>
  v === null || v === undefined ? null : typeof v === "string" ? v : String(v);
const asBool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

// ---------------------------------------------------------------- decisions
{
  const { rows: records, skipped } = readJsonl("records.jsonl");
  if (skipped) skips.push(`records.jsonl: ${skipped} unparsed line(s)`);

  const decisions: Row[] = [];
  const reasons: Row[] = [];
  const checks: Row[] = [];

  for (const r of records as Record<string, any>[]) {
    const decl = r.declaration ?? {};
    const order = r.paymentOrder ?? {};
    const auth = r.authorization ?? {};

    decisions.push({
      decision_id: asText(r.id),
      created_at: asText(r.createdAt),
      outcome: asText(r.outcome),
      agent_id: asText(decl.agentId),
      invoice_id: asText(decl.invoiceId),
      po_id: asText(decl.poId),
      payee_name: asText(decl.payeeName ?? order.payeeName),
      payee_last4: asText(decl.payeeAccountLast4 ?? order.payeeAccountLast4),
      // Amounts in this repo are major units (USD), not cents. The Increase
      // adapter converts at the boundary; nothing here does.
      amount: asNumber(decl.amount ?? order.amount),
      currency: asText(decl.currency ?? order.currency),
      rail: asText(order.rail),
      reference: asText(order.reference),
      policy_version: asText(auth.policyVersion),
      principal: asText(auth.principal),
      limit_per_payment: asNumber(auth.limitPerPayment),
      // Did the order differ from what was declared? The whole product in one column.
      order_matches_declaration:
        decl.amount !== undefined && order.amount !== undefined
          ? decl.amount === order.amount &&
            decl.payeeAccountLast4 === order.payeeAccountLast4
          : null,
      reason_count: count(r.reasons),
      check_count: count(r.checks),
      document_count: count(r.documentHashes),
      chain_hash: asText(r.hash),
      prev_hash: asText(r.prevHash),
      signed: Boolean(r.signature),
    });

    for (const reason of (r.reasons ?? []) as string[]) {
      // Reasons are stored as prose ("Payee account: vendor record ****2210…"),
      // and the chain spans a rename — the same failure appears as both
      // "Account matches the vendor record" and "Payee account" depending on
      // when it was written. Prose is therefore useless as a dimension: group
      // a dashboard on it and one failure mode looks like three.
      //
      // So split label from detail, and keep decision_checks.check_id as the
      // stable dimension to group on. The rename itself is visible in
      // `label`, which is worth seeing rather than hiding.
      const text = String(reason ?? "");
      const at = text.indexOf(": ");
      const label = at > -1 ? text.slice(0, at) : text;
      reasons.push({
        decision_id: asText(r.id),
        created_at: asText(r.createdAt),
        label: label.trim(),
        detail: at > -1 ? text.slice(at + 2).trim() : null,
        reason: text,
      });
    }
    for (const c of (r.checks ?? []) as Record<string, any>[]) {
      checks.push({
        decision_id: asText(r.id),
        created_at: asText(r.createdAt),
        check_id: asText(c.id),
        check_name: asText(c.name),
        status: asText(c.status),
        detail: asText(c.detail),
      });
    }
  }

  table("decisions", "One row per gate decision, from the hash chain.", [
    { name: "decision_id", type: "text" },
    { name: "created_at", type: "timestamptz" },
    { name: "outcome", type: "text" },
    { name: "agent_id", type: "text" },
    { name: "invoice_id", type: "text" },
    { name: "po_id", type: "text" },
    { name: "payee_name", type: "text" },
    { name: "payee_last4", type: "text" },
    { name: "amount", type: "numeric" },
    { name: "currency", type: "text" },
    { name: "rail", type: "text" },
    { name: "reference", type: "text" },
    { name: "policy_version", type: "text" },
    { name: "principal", type: "text" },
    { name: "limit_per_payment", type: "numeric" },
    { name: "order_matches_declaration", type: "boolean" },
    { name: "reason_count", type: "bigint" },
    { name: "check_count", type: "bigint" },
    { name: "document_count", type: "bigint" },
    { name: "chain_hash", type: "text" },
    { name: "prev_hash", type: "text" },
    { name: "signed", type: "boolean" },
  ], decisions);

  table("decision_reasons",
    "Explanations given, one row each. Group on decision_checks.check_id instead — these labels are prose and span a rename.", [
    { name: "decision_id", type: "text" },
    { name: "created_at", type: "timestamptz" },
    { name: "label", type: "text" },
    { name: "detail", type: "text" },
    { name: "reason", type: "text" },
  ], reasons);

  table("decision_checks", "Every individual check run, with its verdict.", [
    { name: "decision_id", type: "text" },
    { name: "created_at", type: "timestamptz" },
    { name: "check_id", type: "text" },
    { name: "check_name", type: "text" },
    { name: "status", type: "text" },
    { name: "detail", type: "text" },
  ], checks);
}

// -------------------------------------------------------------- settlements
{
  const { rows, skipped } = readJsonl("settlements.jsonl");
  if (skipped) skips.push(`settlements.jsonl: ${skipped} unparsed line(s)`);
  table("settlements", "What the rail reported back for a decision.", [
    { name: "settlement_id", type: "text" },
    { name: "decision_id", type: "text" },
    { name: "status", type: "text" },
    { name: "amount", type: "numeric" },
    { name: "currency", type: "text" },
    { name: "payee_last4", type: "text" },
    { name: "rail_reference", type: "text" },
    { name: "occurred_at", type: "timestamptz" },
  ], (rows as Record<string, any>[]).map((s) => ({
    settlement_id: asText(s.id),
    decision_id: asText(s.decisionId),
    status: asText(s.status),
    amount: asNumber(s.amount),
    currency: asText(s.currency),
    payee_last4: asText(s.payeeAccountLast4),
    rail_reference: asText(s.railReference),
    occurred_at: asText(s.occurredAt),
  })));
}

// ----------------------------------------------------------------- outcomes
{
  const { rows, skipped } = readJsonl("outcomes.jsonl");
  if (skipped) skips.push(`outcomes.jsonl: ${skipped} unparsed line(s)`);
  table("outcomes", "Reconciled result: what we decided vs what actually happened.", [
    { name: "outcome_id", type: "text" },
    { name: "created_at", type: "timestamptz" },
    { name: "decision_id", type: "text" },
    { name: "decision_outcome", type: "text" },
    { name: "status", type: "text" },
    { name: "finding_count", type: "bigint" },
    { name: "settlement_count", type: "bigint" },
    // A finding on a reconciled outcome is the alarm worth a dashboard tile.
    { name: "has_findings", type: "boolean" },
  ], (rows as Record<string, any>[]).map((o) => ({
    outcome_id: asText(o.id),
    created_at: asText(o.createdAt),
    decision_id: asText(o.decisionId),
    decision_outcome: asText(o.decisionOutcome),
    status: asText(o.status),
    finding_count: count(o.findings),
    settlement_count: count(o.settlements),
    has_findings: count(o.findings) > 0,
  })));
}

// ----------------------------------------------------------- qualifications
{
  const { rows, skipped } = readJsonl("qualifications.jsonl");
  if (skipped) skips.push(`qualifications.jsonl: ${skipped} unparsed line(s)`);
  table("qualifications", "Scoped, expiring permission to pay, with the scores that earned it.", [
    { name: "qualification_id", type: "text" },
    { name: "issued_at", type: "timestamptz" },
    { name: "expires_at", type: "timestamptz" },
    { name: "revoked_at", type: "timestamptz" },
    { name: "revoked_reason", type: "text" },
    { name: "level", type: "text" },
    { name: "workflow", type: "text" },
    { name: "rail", type: "text" },
    { name: "currency", type: "text" },
    { name: "amount_limit", type: "numeric" },
    { name: "payee_scope", type: "text" },
    { name: "agent_name", type: "text" },
    { name: "agent_version", type: "text" },
    { name: "tool_config_hash", type: "text" },
    { name: "safety", type: "numeric" },
    { name: "capability", type: "numeric" },
    { name: "recovery", type: "numeric" },
    { name: "reliability", type: "numeric" },
    { name: "run_id", type: "text" },
    { name: "is_active", type: "boolean" },
  ], (rows as Record<string, any>[]).map((q) => {
    const b = q.binding ?? {};
    const s = q.scores ?? {};
    const expired = q.expiresAt ? new Date(q.expiresAt).getTime() < Date.now() : false;
    return {
      qualification_id: asText(q.id),
      issued_at: asText(q.issuedAt),
      expires_at: asText(q.expiresAt),
      revoked_at: asText(q.revokedAt),
      revoked_reason: asText(q.revokedReason),
      level: asText(q.level),
      workflow: asText(b.workflow),
      rail: asText(b.rail),
      currency: asText(b.currency),
      amount_limit: asNumber(b.amountLimit),
      payee_scope: asText(b.payeeScope),
      agent_name: asText(b.agent?.name),
      agent_version: asText(b.agent?.version),
      tool_config_hash: asText(b.agent?.toolConfigHash),
      safety: asNumber(s.safety),
      capability: asNumber(s.capability),
      recovery: asNumber(s.recovery),
      reliability: asNumber(s.reliability),
      run_id: asText(q.runId),
      is_active: !q.revokedAt && !expired,
    };
  }));
}

// --------------------------------------------------------- lab runs + grades
{
  const { rows, skipped } = readJsonl("lab-runs.jsonl");
  if (skipped) skips.push(`lab-runs.jsonl: ${skipped} unparsed line(s)`);

  const runs: Row[] = [];
  const grades: Row[] = [];

  for (const r of rows as Record<string, any>[]) {
    const a = r.axes ?? {};
    runs.push({
      run_id: asText(r.id),
      created_at: asText(r.createdAt),
      agent_name: asText(r.agent?.name),
      agent_version: asText(r.agent?.version),
      tool_config_hash: asText(r.agent?.toolConfigHash),
      suite_id: asText(r.suite?.id),
      suite_version: asText(r.suite?.version),
      scenario_count: asNumber(r.suite?.scenarioCount),
      trials: asNumber(r.suite?.trials),
      episodes: asNumber(r.suite?.episodes),
      safety: asNumber(a.safety?.score),
      capability: asNumber(a.capability?.score),
      recovery: asNumber(a.recovery?.score),
      reliability: asNumber(a.reliability?.score),
      critical_violations: count(a.criticalViolations),
      inconsistent_scenarios: count(a.inconsistentScenarios),
      level: asText(a.level),
      level_reason: asText(a.levelReason),
      duration_ms: asNumber(r.durationMs),
    });

    for (const g of (r.grades ?? []) as Record<string, any>[]) {
      grades.push({
        run_id: asText(r.id),
        episode_id: asText(g.episodeId),
        scenario_id: asText(g.scenarioId),
        trial: asNumber(g.trial),
        effective: asText(g.effective),
        expected: asText(g.expected),
        // The grade that matters: did the agent do the right thing, by action?
        correct: g.effective !== undefined && g.expected !== undefined
          ? g.effective === g.expected
          : null,
        violation_count: count(g.violations),
        critical_count: asNumber(g.criticalCount),
        completed_task: asBool(g.completedTask),
        tool_calls: asNumber(g.toolCalls),
        duration_ms: asNumber(g.durationMs),
      });
    }
  }

  table("lab_runs", "One sealed run of the scenario pack, with four-axis scores.", [
    { name: "run_id", type: "text" },
    { name: "created_at", type: "timestamptz" },
    { name: "agent_name", type: "text" },
    { name: "agent_version", type: "text" },
    { name: "tool_config_hash", type: "text" },
    { name: "suite_id", type: "text" },
    { name: "suite_version", type: "text" },
    { name: "scenario_count", type: "bigint" },
    { name: "trials", type: "bigint" },
    { name: "episodes", type: "bigint" },
    { name: "safety", type: "numeric" },
    { name: "capability", type: "numeric" },
    { name: "recovery", type: "numeric" },
    { name: "reliability", type: "numeric" },
    { name: "critical_violations", type: "bigint" },
    { name: "inconsistent_scenarios", type: "bigint" },
    { name: "level", type: "text" },
    { name: "level_reason", type: "text" },
    { name: "duration_ms", type: "bigint" },
  ], runs);

  table("lab_grades", "One row per graded episode inside a run.", [
    { name: "run_id", type: "text" },
    { name: "episode_id", type: "text" },
    { name: "scenario_id", type: "text" },
    { name: "trial", type: "bigint" },
    { name: "effective", type: "text" },
    { name: "expected", type: "text" },
    { name: "correct", type: "boolean" },
    { name: "violation_count", type: "bigint" },
    { name: "critical_count", type: "bigint" },
    { name: "completed_task", type: "boolean" },
    { name: "tool_calls", type: "bigint" },
    { name: "duration_ms", type: "bigint" },
  ], grades);
}

// ------------------------------------------------------- scenario screening
{
  const { rows, skipped } = readJsonl("hard-results.jsonl");
  if (skipped) skips.push(`hard-results.jsonl: ${skipped} unparsed line(s)`);
  const scen: Row[] = [];
  const trials: Row[] = [];
  for (const s of rows as Record<string, any>[]) {
    scen.push({
      scenario: asText(s.scenario),
      family: asText(s.family),
      what: asText(s.what),
      trials: asNumber(s.trials),
      losses: asNumber(s.losses),
      missed: asNumber(s.missed),
      loss_rate: asNumber(s.trials) ? Number(s.losses) / Number(s.trials) : null,
    });
    for (const r of (s.records ?? []) as Record<string, any>[]) {
      trials.push({
        scenario: asText(r.scenario),
        family: asText(r.family),
        trial: asNumber(r.trial),
        loss: asBool(r.loss),
        missed: asBool(r.missed),
        detail: asText(r.detail),
      });
    }
  }
  table("scenarios", "Screened hard scenarios and how often an agent lost money.", [
    { name: "scenario", type: "text" },
    { name: "family", type: "text" },
    { name: "what", type: "text" },
    { name: "trials", type: "bigint" },
    { name: "losses", type: "bigint" },
    { name: "missed", type: "bigint" },
    { name: "loss_rate", type: "numeric" },
  ], scen);
  table("scenario_trials", "Individual trials behind each screened scenario.", [
    { name: "scenario", type: "text" },
    { name: "family", type: "text" },
    { name: "trial", type: "bigint" },
    { name: "loss", type: "boolean" },
    { name: "missed", type: "boolean" },
    { name: "detail", type: "text" },
  ], trials);
}

// ------------------------------------------------------------- model trials
{
  const rows: Row[] = [];
  for (const file of readdirSync(DATA)) {
    if (!file.startsWith("queue-results")) continue;
    const { rows: rs, skipped } = readJsonl(file);
    if (skipped) skips.push(`${file}: ${skipped} unparsed line(s)`);
    for (const s of rs as Record<string, any>[]) {
      for (const r of (s.results ?? []) as Record<string, any>[]) {
        rows.push({
          source_file: file,
          model: asText(s.model),
          scenario: asText(r.scenario ?? s.scenario),
          what: asText(s.what),
          trap_kind: asText(r.trapKind ?? s.trapKind),
          trial: asNumber(r.trial),
          loss: asBool(r.loss),
          ordinary_paid: asNumber(r.ordinaryPaid),
          ordinary_total: asNumber(r.ordinaryTotal),
          total_payments: asNumber(r.totalPayments),
          queue_size: asNumber(s.queueSize),
          // The bimodal tell: did it halt the whole queue rather than pay the trap?
          halted_queue: asNumber(r.ordinaryPaid) === 0 && Number(r.ordinaryTotal) > 0,
        });
      }
    }
  }
  table("model_trials", "Queue runs by model — the trap plus the legitimate invoices around it.", [
    { name: "source_file", type: "text" },
    { name: "model", type: "text" },
    { name: "scenario", type: "text" },
    { name: "what", type: "text" },
    { name: "trap_kind", type: "text" },
    { name: "trial", type: "bigint" },
    { name: "loss", type: "boolean" },
    { name: "ordinary_paid", type: "bigint" },
    { name: "ordinary_total", type: "bigint" },
    { name: "total_payments", type: "bigint" },
    { name: "queue_size", type: "bigint" },
    { name: "halted_queue", type: "boolean" },
  ], rows);
}

// --------------------------------------------------------------- rail links
{
  const { rows, skipped } = readJsonl("rail-index.jsonl");
  if (skipped) skips.push(`rail-index.jsonl: ${skipped} unparsed line(s)`);
  table("rail_links", "Transfer at the bank, linked to the decision that created it.", [
    { name: "transfer_id", type: "text" },
    { name: "decision_id", type: "text" },
    { name: "linked_at", type: "timestamptz" },
  ], (rows as Record<string, any>[]).map((r) => ({
    transfer_id: asText(r.transferId),
    decision_id: asText(r.decisionId),
    linked_at: asText(r.at),
  })));
}

// ================================================================== output
const csvCell = (v: Row[string]): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

mkdirSync(OUT, { recursive: true });

const ddl: string[] = [
  "-- Limulus warehouse projection.",
  "-- Rebuilt from the decision chain by src/warehouse/export.ts; safe to drop.",
  "",
];

for (const t of tables) {
  const header = t.columns.map((c) => c.name).join(",");
  const body = t.rows.map((r) => t.columns.map((c) => csvCell(r[c.name] ?? null)).join(",")).join("\n");
  writeFileSync(join(OUT, `${t.name}.csv`), `${header}\n${body}${body ? "\n" : ""}`);

  ddl.push(`-- ${t.note}`);
  ddl.push(`DROP TABLE IF EXISTS ${t.name};`);
  ddl.push(`CREATE TABLE ${t.name} (`);
  ddl.push(t.columns.map((c) => `  ${c.name} ${c.type}`).join(",\n"));
  ddl.push(");");
  ddl.push(`\\copy ${t.name} FROM '${t.name}.csv' WITH (FORMAT csv, HEADER true);`);
  ddl.push("");
}

writeFileSync(join(OUT, "schema.sql"), ddl.join("\n"));

// A machine-readable copy of the same thing, so the loader does not have to
// parse SQL back out of schema.sql to know a column's type.
writeFileSync(
  join(OUT, "manifest.json"),
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    tables: tables.map((t) => ({
      name: t.name,
      note: t.note,
      rows: t.rows.length,
      columns: t.columns,
    })),
  }, null, 2)}\n`,
);

// ---- report -------------------------------------------------------------
const pad = (s: string, n: number) => s.padEnd(n);
console.log(`\nProjected the chain into ${tables.length} tables → ${OUT}\n`);
console.log(`  ${pad("table", 20)}${pad("rows", 8)}columns`);
console.log(`  ${"-".repeat(44)}`);
let total = 0;
for (const t of tables) {
  total += t.rows.length;
  console.log(`  ${pad(t.name, 20)}${pad(String(t.rows.length), 8)}${t.columns.length}`);
}
console.log(`  ${"-".repeat(44)}`);
console.log(`  ${pad("total", 20)}${total}\n`);

if (skips.length > 0) {
  console.log("Skipped lines (these files hold notes, not records):");
  for (const s of skips) console.log(`  · ${s}`);
  console.log("");
}

console.log("Load into Postgres:");
console.log(`  cd ${OUT} && psql "$DATABASE_URL" -f schema.sql\n`);
