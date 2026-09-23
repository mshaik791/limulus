import Link from "next/link";
import { Activity, ShieldAlert, ShieldCheck, Target } from "lucide-react";
import { qualifications, records, shadowRecords } from "@/lib/api";
import { safe } from "@/lib/safe";
import { day, int, money, ofN, pct, when } from "@/lib/format";
import { agentDisplay, agentRaw, suiteName } from "@/lib/names";
import { MetricCard } from "@/components/blocks";
import { Card, EmptyState, Hash, Offline, PageHeader, Pill } from "@/components/ui";

export const metadata = { title: "Assurance Checks" };

// Deterministic checks every financial action is evaluated against, grouped
// by what they protect. Two counts are kept apart: check interventions (a
// check that fired, counted per check) and unique transactions held or
// escalated (counted per decision, however many checks fired on it).

const CHECKS: { id: string; name: string; category: string; severity: "critical" | "high" | "medium" }[] = [
  { id: "vendor_approved", name: "Vendor is on the approved list", category: "Authorization", severity: "critical" },
  { id: "within_limit", name: "Amount within the per-payment limit", category: "Authorization", severity: "critical" },
  { id: "invoice_approved", name: "Invoice carries a human approval", category: "Authorization", severity: "critical" },
  { id: "payee_account", name: "Payee account matches the authorized vendor record", category: "Beneficiary", severity: "critical" },
  { id: "bank_detail_change", name: "No recent, unverified bank detail change", category: "Beneficiary", severity: "high" },
  { id: "declaration_matches_order", name: "Payment order matches the declared intent", category: "Execution integrity", severity: "critical" },
  { id: "sources_cited", name: "Source documents cited and hashed", category: "Execution integrity", severity: "medium" },
  { id: "duplicate", name: "Invoice not already paid", category: "Duplicate protection", severity: "critical" },
  { id: "similar_recent_payment", name: "No similar payment to the same payee recently", category: "Duplicate protection", severity: "medium" },
  { id: "embedded_instructions", name: "No instructions hidden in the documents", category: "Policy", severity: "high" },
];

export default async function AssuranceChecks() {
  const [quals, chain, shadow] = await Promise.all([safe(qualifications()), safe(records()), safe(shadowRecords())]);
  if (!quals || !chain) return <Offline />;

  type Src = { at: string; checks: { id: string; status: string }[]; held: boolean; escalated: boolean };
  const sources: Src[] = [
    ...chain.map((r) => ({ at: r.createdAt, checks: r.checks, held: r.outcome === "held", escalated: r.outcome === "escalated" })),
    ...(shadow ?? []).filter((s) => s.checks).map((s) => ({ at: s.createdAt, checks: s.checks!, held: s.wouldHave === "held", escalated: s.wouldHave === "escalated" })),
  ];
  const usage = new Map<string, { ran: number; passed: number; failed: number; review: number; skipped: number; last?: string }>();
  let evaluations = 0;
  for (const s of sources) {
    for (const c of s.checks) {
      const u = usage.get(c.id) ?? { ran: 0, passed: 0, failed: 0, review: 0, skipped: 0 };
      u.ran++;
      evaluations++;
      if (c.status === "pass") u.passed++;
      else if (c.status === "fail") u.failed++;
      else if (c.status === "review") u.review++;
      else u.skipped++;
      if ((c.status === "fail" || c.status === "review") && (!u.last || s.at > u.last)) u.last = s.at;
      usage.set(c.id, u);
    }
  }
  const interventions = [...usage.values()].reduce((n, u) => n + u.failed + u.review, 0);
  const heldTx = sources.filter((s) => s.held).length;
  const escalatedTx = sources.filter((s) => s.escalated).length;
  const exercised = CHECKS.filter((c) => (usage.get(c.id)?.ran ?? 0) - (usage.get(c.id)?.skipped ?? 0) > 0).length;
  const valid = quals.filter((q) => q.state === "valid");
  const rows = [...quals].reverse().slice(0, 40);
  const categories = [...new Set(CHECKS.map((c) => c.category))];

  return (
    <>
      <PageHeader title="Assurance Checks" subtitle="Deterministic checks every financial action is evaluated against." />

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-5">
        <MetricCard icon={ShieldCheck} label="Active checks" value={int(CHECKS.length)} sub="deterministic, no model in the path" />
        <MetricCard icon={Activity} label="Evaluations" value={int(evaluations)} sub={`across ${int(sources.length)} decisions read`} />
        <MetricCard icon={ShieldAlert} label="Check interventions" value={int(interventions)} tone={interventions ? "warn" : "good"} sub="a check that held or escalated, per check" />
        <MetricCard icon={ShieldAlert} label="Unique transactions held / escalated" value={`${int(heldTx)} / ${int(escalatedTx)}`} tone={heldTx ? "crit" : "neutral"} sub="per decision, however many checks fired" />
        <MetricCard icon={Target} label="Coverage" value={pct(exercised, CHECKS.length)} sub={`${ofN(exercised, CHECKS.length)} checks exercised at least once`} />
      </div>

      <div className="mb-5 grid gap-4">
        {categories.map((cat) => (
          <Card key={cat} title={cat} padded={false}>
            <ul>
              {CHECKS.filter((c) => c.category === cat).map((c) => {
                const u = usage.get(c.id);
                const n = u ? u.ran - u.skipped : 0;
                const rate = n ? u!.passed / n : null;
                return (
                  <li key={c.id} className="grid items-center gap-4 border-b border-line px-6 py-3.5 last:border-0 md:grid-cols-[1fr_110px_120px_170px_150px]">
                    <div className="min-w-0">
                      <div className="text-[14px]">{c.name}</div>
                      <div className="mono text-[11px] text-ink-3">{c.id}</div>
                    </div>
                    <div>
                      <Pill tone={c.severity === "critical" ? "crit" : c.severity === "high" ? "warn" : "neutral"}>{c.severity}</Pill>
                    </div>
                    <div className="text-[12.5px] tabular text-ink-2">{u ? `${int(u.ran)} evaluations` : "not yet run"}</div>
                    <div>
                      <div className="flex items-baseline justify-between text-[12px]">
                        <span className="tabular">{rate === null ? "not evaluated" : `${Math.round(rate * 100)}% pass`}</span>
                        <span className="tabular text-ink-3">{u ? `${int(u.failed + u.review)} interventions` : ""}</span>
                      </div>
                      <div className="mt-1 h-[4px] overflow-hidden rounded-full bg-surface-3">{rate !== null && <div className="h-full rounded-full bg-good" style={{ width: `${Math.max(1, rate * 100)}%` }} />}</div>
                    </div>
                    <div className="text-[12px] text-ink-3">{u?.last ? `last fired ${when(u.last)}` : "never fired"}</div>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>

      <Card title="Qualifications" aside={`${int(valid.length)} in force of ${int(quals.length)} issued · signed clearances bound to agent, version, prompt and tool hashes, workflow, rail, currency, ceiling, payee scope and suite`} padded={false}>
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="None issued." body="A qualification is issued from a held-out run and says what an agent is cleared to pay, until when." code="node src/lab-cli.ts qualify careful" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap">
              <thead>
                <tr>
                  <th className="pl-6">state</th>
                  <th>agent</th>
                  <th>rung</th>
                  <th>scope</th>
                  <th className="text-right">ceiling</th>
                  <th className="text-right">safety</th>
                  <th>issued</th>
                  <th>expires</th>
                  <th className="pr-6">signature</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.id} className="row-link">
                    <td className="pl-6">
                      <Pill tone={q.state === "valid" ? "good" : q.state === "revoked" ? "crit" : "warn"}>{q.state ?? "?"}</Pill>
                    </td>
                    <td>
                      <Link href={`/labs/tests/${q.runId}`}>{agentDisplay(q.binding.agent.name)}</Link>
                      <div className="text-[11.5px] text-ink-3">
                        <span className="mono">{agentRaw(q.binding.agent.name, q.binding.agent.version)}</span> · {suiteName(q.binding.suite.id).name}
                      </div>
                    </td>
                    <td className="text-[12.5px] text-ink-2">{q.level}</td>
                    <td className="text-[12px]">
                      {q.binding.workflow} · {q.binding.rail} · payees {q.binding.payeeScope}
                      {q.scopeNarrowing?.length ? <div className="text-warn-ink">narrowed: {q.scopeNarrowing.map((n) => `${n.dimension} ${n.from} → ${n.to}`).join("; ")}</div> : null}
                    </td>
                    <td className="text-right tabular">{money(q.binding.amountLimit, q.binding.currency)}</td>
                    <td className="text-right tabular">{q.scores.safety}</td>
                    <td className="text-ink-3">{day(q.issuedAt)}</td>
                    <td className="text-ink-3">{day(q.expiresAt)}</td>
                    <td className="pr-6">{q.verification ? <Pill tone={q.verification.ok ? "good" : "crit"}>{q.verification.ok ? "verifies" : "broken"}</Pill> : <Hash value={q.hash} n={10} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
