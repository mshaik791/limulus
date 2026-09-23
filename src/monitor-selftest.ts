import { ingestEvent, computeMetrics, generateCandidates, readCandidates, approveCandidate, rejectCandidate, monitorPaths } from "./monitor.ts";
import { loadScenarioDir } from "./bench/scenario-file.ts";
import { runSuite } from "./sandbox/lab.ts";
import { referenceToolAgents } from "./sandbox/agents.ts";
import { join } from "node:path";

// The two rules that must hold, and the end-to-end the prompt asks for: a
// production event with a transposed account becomes a candidate with NO raw
// values, is approved by hand, and then runs in the next suite. All deterministic.
//
//   node src/monitor-selftest.ts

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

const org = `acme-${Date.now()}`;
const t = (n: number) => new Date(Date.parse("2026-09-21T00:00:00Z") + n * 1000).toISOString();

// Customer values that must NEVER appear in a candidate.
const RAW = { vendor: "Globex Customer Corp", record: "8842", proposed: "8482", amount: 128_500, invoice: "CUST-INV-777" };

// A production event: the agent proposed a payment to a transposed account.
const evt = ingestEvent({
  type: "payment_proposed", agentId: "cust-agent-1", configHash: "cfg-cust", runId: "sess-42", org, at: t(0),
  payload: { proposed: { payeeName: RAW.vendor, payeeAccountLast4: RAW.proposed, amount: RAW.amount, invoiceId: RAW.invoice }, recordAccountLast4: RAW.record, recordPayeeName: RAW.vendor },
});
// A second, identical-shape event from the same org — must dedup into one candidate.
ingestEvent({
  type: "payment_proposed", agentId: "cust-agent-1", configHash: "cfg-cust", runId: "sess-43", org, at: t(1),
  payload: { proposed: { payeeName: "Initech Inc", payeeAccountLast4: "7315", amount: 9_900, invoiceId: "II-55" }, recordAccountLast4: "7135" },
});

const { created, deduped } = generateCandidates();
check("a failure event produced a candidate", created >= 1, `created=${created}`);
check("an identical-shape event deduped", deduped >= 1, `deduped=${deduped}`);

const mine = readCandidates().filter((c) => c.org === org);
check("exactly one candidate for this org (deduped)", mine.length === 1, `${mine.length}`);
const cand = mine[0];
check("candidate is pending, not auto-inserted", cand.status === "pending");
check("candidate records the preserved property", /transposition/.test(cand.preservedProperty));
check("candidate maps to the right taxonomy node", cand.taxonomyNode === "account.transposed-digits", cand.taxonomyNode);
check("candidate collapsed both events", cand.count === 2, `count=${cand.count}`);

// THE leak guarantee: no raw value from the source event appears in the candidate.
const scenarioJson = JSON.stringify(cand.scenario);
const leaks = Object.entries(RAW).filter(([, v]) => scenarioJson.includes(String(v)));
check("no raw customer value leaked into the candidate", leaks.length === 0, leaks.map(([k]) => k).join(", "));
check("provenance points at the source (org + event), without payment values", cand.scenario.source.includes(org) && cand.scenario.source.includes(evt.id));

// Nothing is in the suite until approved.
const suiteDir = join(monitorPaths.suitesDir, org);
check("the private suite is empty before approval", loadScenarioDir(suiteDir).scenarios.length === 0);

// Approve → it enters the private suite → it runs.
const approved = approveCandidate(cand.id);
check("approving writes the candidate to the private suite", approved.ok && !!approved.path);
const loaded = loadScenarioDir(suiteDir);
check("the written candidate loads through the strict validator", loaded.scenarios.length === 1 && !loaded.problems.some((p) => p.severity === "error"), loaded.problems.map((p) => p.detail).join("; "));
const { run } = await runSuite(referenceToolAgents.careful, { pack: loaded.scenarios, suite: { id: "monitor-e2e" }, trials: 1, allowRetake: true });
check("the approved candidate runs in the next suite", (run.grades as unknown[]).length === 1);

// A rejected candidate does not enter a suite.
const evt3 = ingestEvent({ type: "rail_error", agentId: "cust-agent-1", configHash: "cfg-cust", runId: "sess-99", org: `${org}-r`, at: t(2), payload: { returnCode: "R03" } });
generateCandidates([evt3]);
const rc = readCandidates().find((c) => c.org === `${org}-r`)!;
check("reject removes a candidate from the queue-to-suite path", rejectCandidate(rc.id) && readCandidates().find((c) => c.id === rc.id)!.status === "rejected");

// Metrics compute and are grouped.
const metrics = computeMetrics();
check("metrics are grouped conformance/integrity/recovery/control/outcome", ["conformance", "integrity", "recovery", "control", "outcome"].every((g) => g in metrics));
check("every metric carries its denominator (n)", Object.values(metrics).every((grp) => Object.values(grp).every((mx) => typeof mx.of === "number")));

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
