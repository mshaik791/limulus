import Link from "next/link";
import { Activity, ShieldAlert, ShieldCheck, Wallet } from "lucide-react";
import { chainVerify, health, outcomes, records } from "@/lib/api";
import { safe } from "@/lib/safe";
import { ago, int, money, ofN } from "@/lib/format";
import { MetricCard } from "@/components/blocks";
import { Card, EmptyState, Offline, PageHeader, Pill, StateBadge, toneForVerdict } from "@/components/ui";

export const metadata = { title: "Production" };

// Financial mission control for the gate's real decisions. The stream is the
// chain, newest first, with what the rail did with each; the right rail is
// the risk events, the system state and each agent's record.

export default async function Production() {
  const [chain, outs, verify, h] = await Promise.all([safe(records()), safe(outcomes()), safe(chainVerify()), health()]);
  if (!chain || !outs) return <Offline />;
  const byDecision = new Map(outs.map((o) => [o.decisionId, o]));
  const rows = [...chain].reverse().filter((r) => !r.preview);
  const count = (k: string) => rows.filter((r) => r.outcome === k).length;
  const heldAmount = rows.filter((r) => r.outcome !== "released").reduce((n, r) => n + r.paymentOrder.amount, 0);
  const unauthorized = outs.filter((o) => o.status === "unauthorized");
  const risk = rows.filter((r) => r.outcome !== "released").slice(0, 6);
  const agents = new Map<string, { n: number; held: number; escalated: number }>();
  for (const r of rows) {
    const a = agents.get(r.declaration.agentId) ?? { n: 0, held: 0, escalated: 0 };
    a.n++;
    if (r.outcome === "held") a.held++;
    if (r.outcome === "escalated") a.escalated++;
    agents.set(r.declaration.agentId, a);
  }

  return (
    <>
      <PageHeader title="Production" subtitle="Every payment the gate ruled on, and what the rail did afterwards." />
      {rows.length === 0 ? (
        <EmptyState title="No production decisions." body="When an agent pays through the gate, the decision lands here, signed, with the settlement that followed." code={"curl -X POST localhost:8787/v1/release -d '{\"scenario\":\"clean\"}'"} />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-5">
            <MetricCard icon={Activity} label="Transactions evaluated" value={int(rows.length)} sub="most recent on the chain" />
            <MetricCard icon={ShieldCheck} label="Released" value={ofN(count("released"), rows.length)} tone="good" />
            <MetricCard icon={ShieldAlert} label="Held" value={ofN(count("held"), rows.length)} tone={count("held") ? "crit" : "neutral"} />
            <MetricCard icon={ShieldAlert} label="Escalated" value={ofN(count("escalated"), rows.length)} tone={count("escalated") ? "warn" : "neutral"} />
            <MetricCard icon={Wallet} label="Held from the rail" value={money(heldAmount)} sub="payments the gate held or escalated" />
          </div>

          <div className="grid gap-4 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <Card title="Live transaction stream" aside={`${int(rows.length)} decisions`} padded={false}>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="pl-6">agent</th>
                      <th>payee</th>
                      <th className="text-right">amount</th>
                      <th>decision</th>
                      <th>rail</th>
                      <th className="pr-6">reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const o = byDecision.get(r.id);
                      return (
                        <tr key={r.id} className="row-link">
                          <td className="pl-6">
                            <Link href={`/decisions/${r.id}`} className="font-medium">
                              {r.declaration.agentId}
                            </Link>
                            <div className="text-[11.5px] text-ink-3">{ago(r.createdAt)}</div>
                          </td>
                          <td>
                            → {r.paymentOrder.payeeName}
                            <div className="text-[11.5px] text-ink-3">
                              {r.declaration.invoiceId} · {r.paymentOrder.rail} · ****{r.paymentOrder.payeeAccountLast4}
                            </div>
                          </td>
                          <td className="text-right text-[15px] tabular">{money(r.paymentOrder.amount, r.paymentOrder.currency)}</td>
                          <td>
                            <StateBadge state={r.outcome === "released" ? "RELEASE" : r.outcome === "held" ? "HOLD" : "ESCALATE"} />
                          </td>
                          <td>{o ? <Pill tone={toneForVerdict(o.status)}>{o.status}</Pill> : <span className="text-[12px] text-ink-3">no settlement yet</span>}</td>
                          <td className="max-w-[300px] pr-6 text-[12px] text-ink-3">
                            <span className="line-clamp-1">{r.outcome === "released" ? "" : r.reasons[0]}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            </div>
            <div className="grid content-start gap-4 xl:col-span-4">
              <Card title="Risk events" aside={`${int(risk.length)}`}>
                {risk.length === 0 ? (
                  <p className="text-[13px] text-ink-3">Nothing held or escalated in the recent decisions.</p>
                ) : (
                  <ul className="grid gap-2">
                    {risk.map((r) => (
                      <li key={r.id}>
                        <Link href={`/decisions/${r.id}`} className="block rounded-[var(--radius-sm)] border border-line bg-surface-2 px-3 py-2 hover:border-line-hover">
                          <div className="flex items-center justify-between gap-2 text-[13px]">
                            <span>
                              {money(r.paymentOrder.amount, r.paymentOrder.currency)} to {r.paymentOrder.payeeName}
                            </span>
                            <StateBadge state={r.outcome === "held" ? "HOLD" : "ESCALATE"} />
                          </div>
                          <div className="mt-0.5 line-clamp-1 text-[12px] text-ink-3">{r.reasons[0]}</div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {unauthorized.length > 0 && <p className="mt-3 text-[12.5px] text-crit-ink">{int(unauthorized.length)} payment(s) settled although the decision held or escalated them. Something executed outside the control.</p>}
              </Card>
              <Card title="System state">
                <ul className="grid gap-2 text-[13px]">
                  <li className="flex items-center justify-between">
                    <span className="text-ink-2">Engine</span>
                    <Pill tone={h?.ok ? "good" : "crit"}>{h?.ok ? "operational" : "offline"}</Pill>
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-ink-2">Decision chain</span>
                    <Pill tone={verify?.ok ? "good" : "crit"}>{verify?.ok ? "verifies" : "broken"}</Pill>
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-ink-2">Payment rail</span>
                    <Pill tone="warn">sandbox, none connected</Pill>
                  </li>
                </ul>
              </Card>
              <Card title="Agent health" padded={false}>
                <ul>
                  {[...agents].map(([id, a]) => (
                    <li key={id} className="flex items-center justify-between gap-3 border-b border-line px-6 py-2.5 text-[13px] last:border-0">
                      <span className="truncate">{id}</span>
                      <span className="shrink-0 text-[12px] tabular text-ink-3">
                        {int(a.n)} decisions · <span className={a.held ? "text-crit-ink" : ""}>{int(a.held)} held</span> · {int(a.escalated)} escalated
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}
