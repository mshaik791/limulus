import Link from "next/link";
import { Activity, ShieldAlert, ShieldCheck } from "lucide-react";
import { environment, outcomes, records } from "@/lib/api";
import { safe } from "@/lib/safe";
import { ago, int, money, ofN } from "@/lib/format";
import { agentDisplay } from "@/lib/names";
import { productionMiss } from "@/lib/misses";
import { MetricCard } from "@/components/blocks";
import { Card, decisionState, EmptyState, Note, Offline, PageHeader, Pill, StateBadge, toneForVerdict } from "@/components/ui";

export const metadata = { title: "Production" };

// The gate's decisions and what the rail did with each. The environment drives
// the copy: with the simulated rail this is a sandbox decision stream and the
// words are "would release" and "simulated value"; with a live rail they are
// "released" and "held". A release the rail then contradicted is an incident,
// never an ordinary success.

export default async function Production() {
  const [chain, outs, env] = await Promise.all([safe(records()), safe(outcomes()), environment()]);
  if (!chain || !outs) return <Offline />;
  const sb = env.sandbox;
  const byDecision = new Map(outs.map((o) => [o.decisionId, o]));
  const rows = [...chain].reverse().filter((r) => !r.preview);
  const count = (k: string) => rows.filter((r) => r.outcome === k).length;
  const heldAmount = rows.filter((r) => r.outcome !== "released").reduce((n, r) => n + r.paymentOrder.amount, 0);
  const misses = rows.map((r) => ({ r, miss: productionMiss(r, byDecision.get(r.id)) })).filter((x) => x.miss);
  const risk = rows.filter((r) => r.outcome !== "released").slice(0, 6);
  const agents = new Map<string, { n: number; held: number; escalated: number; misses: number }>();
  for (const r of rows) {
    const a = agents.get(r.declaration.agentId ?? "unknown") ?? { n: 0, held: 0, escalated: 0, misses: 0 };
    a.n++;
    if (r.outcome === "held") a.held++;
    if (r.outcome === "escalated") a.escalated++;
    if (productionMiss(r, byDecision.get(r.id))) a.misses++;
    agents.set(r.declaration.agentId ?? "unknown", a);
  }

  return (
    <>
      <PageHeader
        title={sb ? "Sandbox Decision Stream" : "Production"}
        subtitle={sb ? "What would Limulus allow or stop? Every payment the gate ruled on against the simulated rail; no money moved." : `What is Limulus allowing or stopping right now? Every payment the gate ruled on, and what the rail (${env.rail}) did afterwards.`}
      />
      {sb && <Note tone="warn">Sandbox. The rail is {env.rail}: {env.note ?? "no bank is involved"}. Decisions are real records; the executions they describe are simulated.</Note>}
      {rows.length === 0 ? (
        <EmptyState title={sb ? "No sandbox decisions." : "No production decisions."} body="When an agent pays through the gate, the decision lands here, signed, with the settlement that followed." code={"curl -X POST localhost:8787/v1/release -d '{\"scenario\":\"clean\"}'"} />
      ) : (
        <>
          <div className="mb-5 mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <MetricCard icon={Activity} label={sb ? "Simulated transactions" : "Transactions"} value={int(rows.length)} sub="most recent on the chain" />
            <MetricCard icon={ShieldCheck} label={sb ? "Would release" : "Released"} value={ofN(count("released"), rows.length)} tone="good" />
            <MetricCard icon={ShieldAlert} label={sb ? "Would hold" : "Held"} value={ofN(count("held"), rows.length)} tone={count("held") ? "crit" : "neutral"} sub={`${money(heldAmount)} ${sb ? "simulated" : ""} held or escalated`} />
            <MetricCard icon={ShieldAlert} label={sb ? "Would escalate" : "Escalated"} value={ofN(count("escalated"), rows.length)} tone={count("escalated") ? "warn" : "neutral"} />
          </div>

          <div className="grid gap-4 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <Card title={sb ? "Simulated decision stream" : "Live transaction stream"} aside={`${int(rows.length)} decisions`} padded={false}>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="pl-6">agent</th>
                      <th>payee</th>
                      <th className="text-right">amount</th>
                      <th>Limulus decision</th>
                      <th>observed outcome</th>
                      <th className="pr-6">status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const o = byDecision.get(r.id);
                      const miss = productionMiss(r, o);
                      const d = decisionState(r.outcome, sb);
                      return (
                        <tr key={r.id} className="row-link">
                          <td className="pl-6">
                            <Link href={`/decisions/${r.id}`} className="font-medium">
                              {r.declaration.agentId ? agentDisplay(r.declaration.agentId) : "unknown agent"}
                            </Link>
                            <div className="text-[11.5px] text-ink-3" title={r.declaration.agentId}>
                              {ago(r.createdAt)}
                            </div>
                          </td>
                          <td>
                            → {r.paymentOrder.payeeName}
                            <div className="text-[11.5px] text-ink-3">
                              {r.declaration.invoiceId} · {r.paymentOrder.rail} · ****{r.paymentOrder.payeeAccountLast4}
                            </div>
                          </td>
                          <td className="text-right text-[15px] tabular">{money(r.paymentOrder.amount, r.paymentOrder.currency)}</td>
                          <td>
                            <StateBadge state={d.state} label={d.label} />
                          </td>
                          <td>{o ? <Pill tone={toneForVerdict(o.status)}>{o.status}</Pill> : <span className="text-[12px] text-ink-3">no settlement yet</span>}</td>
                          <td className="pr-6">
                            {miss ? (
                              <span>
                                <StateBadge state="INCIDENT" label={sb ? "Simulated miss" : "Incident"} />
                                <div className="mt-0.5 text-[11.5px] text-ink-3">{miss}</div>
                              </span>
                            ) : r.outcome === "released" ? (
                              <span className="text-[12px] text-ink-3">{o ? "as decided" : "awaiting rail"}</span>
                            ) : (
                              <span className="line-clamp-1 max-w-[260px] text-[12px] text-ink-3">{r.reasons[0]}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            </div>
            <div className="grid content-start gap-4 xl:col-span-4">
              <Card title={sb ? "Simulated misses" : "Production misses"} aside={`${int(misses.length)}`}>
                {misses.length === 0 ? (
                  <p className="text-[13px] text-ink-3">No decision was contradicted by the rail.</p>
                ) : (
                  <ul className="grid gap-2">
                    {misses.slice(0, 6).map(({ r, miss }, i) => (
                      <li key={`${r.id}-${i}`}>
                        <Link href={`/decisions/${r.id}`} className="block rounded-[var(--radius-sm)] border border-line bg-surface-2 px-3 py-2 hover:border-line-hover">
                          <div className="flex items-center justify-between gap-2 text-[13px]">
                            <span>
                              {money(r.paymentOrder.amount, r.paymentOrder.currency)} to {r.paymentOrder.payeeName}
                            </span>
                            <StateBadge state="INCIDENT" label="Miss" />
                          </div>
                          <div className="mt-0.5 text-[12px] text-ink-3">{miss}</div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-[11.5px] text-ink-3">A miss is a release the rail then returned, duplicated or mismatched, or a hold that settled anyway. Each is listed under Incidents.</p>
              </Card>
              <Card title="Risk events" aside={`${int(risk.length)}`}>
                {risk.length === 0 ? (
                  <p className="text-[13px] text-ink-3">Nothing held or escalated in the recent decisions.</p>
                ) : (
                  <ul className="grid gap-2">
                    {risk.map((r, i) => {
                      const d = decisionState(r.outcome, sb);
                      return (
                        <li key={`${r.id}-${i}`}>
                          <Link href={`/decisions/${r.id}`} className="block rounded-[var(--radius-sm)] border border-line bg-surface-2 px-3 py-2 hover:border-line-hover">
                            <div className="flex items-center justify-between gap-2 text-[13px]">
                              <span>
                                {money(r.paymentOrder.amount, r.paymentOrder.currency)} to {r.paymentOrder.payeeName}
                              </span>
                              <StateBadge state={d.state} label={d.label} />
                            </div>
                            <div className="mt-0.5 line-clamp-1 text-[12px] text-ink-3">{r.reasons[0]}</div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
              <details>
                <summary className="cursor-pointer text-[13px] text-accent-ink">By agent</summary>
                <Card padded={false} className="mt-2">
                <ul>
                  {[...agents].map(([id, a]) => (
                    <li key={id} className="border-b border-line px-6 py-2.5 text-[13px] last:border-0">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate">{agentDisplay(id)}</span>
                        <span className="shrink-0 text-[12px] tabular text-ink-3">
                          {int(a.n)} · <span>{int(a.held)} {sb ? "would hold" : "held"}</span> · {int(a.escalated)} {sb ? "would escalate" : "escalated"}
                          {a.misses ? <span> · {int(a.misses)} <span className="text-crit-ink">miss</span></span> : null}
                        </span>
                      </div>
                      <div className="mono text-[11px] text-ink-3">{id}</div>
                    </li>
                  ))}
                </ul>
                </Card>
              </details>
            </div>
          </div>
        </>
      )}
    </>
  );
}
