import type { ActivityItem } from "@/components/blocks";
import type { Candidate, CompareRecord, DecisionRecord, GateRecord, LabRunSummary, ShadowRecord } from "./api";
import { int, money } from "./format";
import { suiteName } from "./names";

// The live activity feed: every kind of sealed record, merged by time. Each
// line is a fact from the record it links to.

export function activity(input: { runs?: LabRunSummary[]; gates?: GateRecord[]; compares?: CompareRecord[]; shadow?: ShadowRecord[]; candidates?: Candidate[]; decisions?: DecisionRecord[] }, limit = 9): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const r of (input.runs ?? []).slice(-6)) {
    const crit = r.axes.criticalViolations.length;
    items.push({
      at: r.createdAt,
      kind: "run",
      tone: crit ? "crit" : "good",
      title: `${r.agent.name} v${r.agent.version} ${crit ? `failed ${int(crit)} critical` : "passed"} · ${suiteName(r.suite.id).name}`,
      sub: `${int(r.suite.scenarioCount)} scenarios × ${r.suite.trials} · safety ${r.axes.safety.score} (n=${int(r.axes.safety.sampleSize)})`,
      href: `/labs/tests/${r.id}`,
    });
  }
  for (const g of (input.gates ?? []).slice(-4)) {
    items.push({
      at: g.createdAt,
      kind: "gate",
      tone: g.verdict === "pass" ? "good" : g.verdict === "fail" ? "crit" : "warn",
      title: `Release gate ${g.verdict} · ${g.agent.name} v${g.agent.version}`,
      sub: g.verdict === "fail" ? `${int(g.newCriticals.length)} new critical, ${int(g.newlyFailing.length)} newly failing` : g.override ? `overridden by ${g.override.actor}` : "nothing worse than baseline",
      href: `/labs/releases/${g.id}`,
    });
  }
  for (const c of (input.compares ?? []).slice(-2)) {
    items.push({ at: c.createdAt, kind: "compare", tone: "model", title: `Comparison of ${int(c.arms.length)} configurations`, sub: c.recommendation.label ? `recommended ${c.recommendation.label}` : "no clean arm", href: `/labs/arena/${c.id}` });
  }
  for (const s of (input.shadow ?? []).slice(-4)) {
    items.push({
      at: s.createdAt,
      kind: "shadow",
      tone: s.agreement === "agree" ? "good" : s.agreement === "would_have_held" ? "crit" : "warn",
      title: `${money(s.payment.amount, s.payment.currency)} to ${s.payment.payeeName} · ${s.agreement.replaceAll("_", " ")}`,
      sub: s.agreement === "agree" ? `production ${s.production.outcome}` : s.reasons[0],
      href: `/production/${s.id}`,
    });
  }
  for (const c of (input.candidates ?? []).slice(-3)) {
    items.push({ at: c.decidedAt ?? c.createdAt, kind: "incident", tone: c.status === "pending" ? "warn" : c.status === "approved" ? "good" : "neutral", title: `${c.status === "pending" ? "Incident candidate" : `Candidate ${c.status}`} · ${c.taxonomyNode}`, sub: c.scenario.title, href: "/incidents" });
  }
  for (const d of (input.decisions ?? []).filter((x) => !x.preview).slice(-4)) {
    items.push({
      at: d.createdAt,
      kind: "decision",
      tone: d.outcome === "released" ? "good" : d.outcome === "held" ? "crit" : "warn",
      title: `${money(d.paymentOrder.amount, d.paymentOrder.currency)} to ${d.paymentOrder.payeeName} · ${d.outcome}`,
      sub: d.outcome === "released" ? "all checks passed" : d.reasons[0],
      href: `/decisions/${d.id}`,
    });
  }
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}
