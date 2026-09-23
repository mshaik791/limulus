import Link from "next/link";
import { qualifications, records, shadowRecords } from "@/lib/api";
import { safe } from "@/lib/safe";
import { day, int, money, ofN, pct, when } from "@/lib/format";
import { Card, EmptyState, Hash, Metric, Offline, PageHeader, Pill } from "@/components/ui";

export const metadata = { title: "Assurance Checks" };

// Two things live here and they are kept apart on purpose. The checks are the
// deterministic rules the three-way match runs on every payment, with how
// often each has fired. The qualifications are the signed clearances those
// checks have earned an agent: what it is cleared to pay, until when.

const CHECKS: { id: string; name: string; category: string; severity: "critical" | "high" | "medium" }[] = [
  { id: "vendor_approved", name: "Approved vendor", category: "authorization", severity: "critical" },
  { id: "within_limit", name: "Per-payment limit", category: "authorization", severity: "critical" },
  { id: "invoice_approved", name: "Human approval", category: "authorization", severity: "critical" },
  { id: "declaration_matches_order", name: "Payment order vs declaration", category: "execution integrity", severity: "critical" },
  { id: "payee_account", name: "Payee account", category: "beneficiary", severity: "critical" },
  { id: "bank_detail_change", name: "Bank detail change", category: "beneficiary", severity: "high" },
  { id: "duplicate", name: "Duplicate payment", category: "duplicate protection", severity: "critical" },
  { id: "similar_recent_payment", name: "Similar recent payment", category: "duplicate protection", severity: "medium" },
  { id: "embedded_instructions", name: "Embedded instructions", category: "injection resistance", severity: "high" },
  { id: "sources_cited", name: "Source documents", category: "evidence", severity: "medium" },
];

export default async function AssuranceChecks() {
  const [quals, chain, shadow] = await Promise.all([safe(qualifications()), safe(records()), safe(shadowRecords())]);
  if (!quals || !chain) return <Offline />;

  // Usage from the last fifty decisions and the shadow records that carry checks.
  const usage = new Map<string, { ran: number; passed: number; failed: number; review: number; skipped: number; last?: string }>();
  const sources = [...chain.map((r) => ({ at: r.createdAt, checks: r.checks })), ...(shadow ?? []).filter((s) => s.checks).map((s) => ({ at: s.createdAt, checks: s.checks! }))];
  for (const s of sources) {
    for (const c of s.checks) {
      const u = usage.get(c.id) ?? { ran: 0, passed: 0, failed: 0, review: 0, skipped: 0 };
      u.ran++;
      if (c.status === "pass") u.passed++;
      else if (c.status === "fail") u.failed++;
      else if (c.status === "review") u.review++;
      else u.skipped++;
      if ((c.status === "fail" || c.status === "review") && (!u.last || s.at > u.last)) u.last = s.at;
      usage.set(c.id, u);
    }
  }
  const valid = quals.filter((q) => q.state === "valid");
  const rows = [...quals].reverse().slice(0, 60);

  return (
    <>
      <PageHeader title="Assurance Checks" subtitle="The deterministic checks every payment is held to, and the signed clearances they have earned each agent." />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Checks in the three-way match" value={int(CHECKS.length)} sub="deterministic, no model in the path" />
        <Metric label="Decisions read" value={int(sources.length)} sub="most recent on the chain, plus shadow" />
        <Metric label="Qualifications in force" value={int(valid.length)} tone={valid.length ? "good" : "neutral"} sub={`${int(quals.length)} issued in total`} />
        <Metric label="Revoked or expired" value={int(quals.length - valid.length)} />
      </div>

      <Card title="Checks" padded={false} className="mb-6">
        <table className="w-full">
          <thead>
            <tr>
              <th className="pl-5">check</th>
              <th>category</th>
              <th>severity</th>
              <th className="text-right">ran</th>
              <th className="text-right">passed</th>
              <th className="text-right">held / escalated</th>
              <th className="pr-5">last fired</th>
            </tr>
          </thead>
          <tbody>
            {CHECKS.map((c) => {
              const u = usage.get(c.id);
              return (
                <tr key={c.id}>
                  <td className="pl-5">
                    <div className="font-medium">{c.name}</div>
                    <div className="mono text-[11px] text-ink-3">{c.id}</div>
                  </td>
                  <td className="text-[12.5px] text-ink-2">{c.category}</td>
                  <td>
                    <Pill tone={c.severity === "critical" ? "crit" : c.severity === "high" ? "warn" : "neutral"}>{c.severity}</Pill>
                  </td>
                  <td className="text-right tabular">{u ? int(u.ran) : "–"}</td>
                  <td className="text-right tabular">{u && u.ran - u.skipped > 0 ? `${pct(u.passed, u.ran - u.skipped)} · ${ofN(u.passed, u.ran - u.skipped)}` : "–"}</td>
                  <td className={`text-right tabular ${u && u.failed + u.review ? "text-warn-ink" : ""}`}>{u ? int(u.failed + u.review) : "–"}</td>
                  <td className="pr-5 text-[12px] text-ink-3">{u?.last ? when(u.last) : "never"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card title="Qualifications" aside="bound to agent, version, prompt and tool hashes, workflow, rail, currency, ceiling, payee scope and suite" padded={false}>
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState title="None issued." body="A qualification is issued from a held-out run and says what an agent is cleared to pay, until when." code="node src/lab-cli.ts qualify careful" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap">
              <thead>
                <tr>
                  <th className="pl-5">state</th>
                  <th>agent</th>
                  <th>rung</th>
                  <th>scope</th>
                  <th className="text-right">ceiling</th>
                  <th className="text-right">safety</th>
                  <th>issued</th>
                  <th>expires</th>
                  <th>run</th>
                  <th className="pr-5">signature</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.id}>
                    <td className="pl-5">
                      <Pill tone={q.state === "valid" ? "good" : q.state === "revoked" ? "crit" : "warn"}>{q.state ?? "?"}</Pill>
                      {q.revokedReason && <div className="max-w-[220px] whitespace-normal text-[11px] text-ink-3">{q.revokedReason}</div>}
                    </td>
                    <td>
                      {q.binding.agent.name} <span className="mono text-ink-3">v{q.binding.agent.version}</span>
                    </td>
                    <td className="text-[12px] text-ink-2">{q.level}</td>
                    <td className="text-[12px]">
                      {q.binding.workflow} · {q.binding.rail} · {q.binding.currency} · payees {q.binding.payeeScope}
                      {q.scopeNarrowing?.length ? <div className="text-warn-ink">narrowed: {q.scopeNarrowing.map((n) => `${n.dimension} ${n.from} → ${n.to}`).join("; ")}</div> : null}
                    </td>
                    <td className="text-right tabular">{money(q.binding.amountLimit, q.binding.currency)}</td>
                    <td className="text-right tabular">{q.scores.safety}</td>
                    <td className="text-ink-3">{day(q.issuedAt)}</td>
                    <td className="text-ink-3">{day(q.expiresAt)}</td>
                    <td>
                      <Link href={`/labs/tests/${q.runId}`} className="mono text-[12px]">
                        {q.runId}
                      </Link>
                    </td>
                    <td className="pr-5">{q.verification ? <Pill tone={q.verification.ok ? "good" : "crit"}>{q.verification.ok ? "verifies" : "broken"}</Pill> : <Hash value={q.hash} n={10} />}</td>
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
