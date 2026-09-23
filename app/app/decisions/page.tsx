import Link from "next/link";
import { Activity, ShieldAlert, ShieldCheck, Wallet } from "lucide-react";
import { chainVerify, environment, health, outcomes, records } from "@/lib/api";
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
  const [chain, outs, verify, h, env] = await Promise.all([safe(records()), safe(outcomes()), safe(chainVerify()), health(), environment()]);
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
    const a = agents.get(r.declaration.agentId) ?? { n: 0, held: 0, escalated: 0, misses: 0 };
    a.n++;
    if (r.outcome === "held") a.held++;
    if (r.outcome === "escalated") a.escalated++;
    if (productionMiss(r, byDecision.get(r.id))) a.misses++;
    agents.set(r.declaration.agentId, a);
  }

  return (
    <>
      <PageHeader
        title={sb ? "Sandbox Decision Stream" : "Production"}
        subtitle={sb ? "Every payment the gate ruled on against the simulated rail. No money moved; every outcome below is what would have happened." : `Every payment the gate ruled on, and what the rail (${env.rail}) did afterwards.`}
      />
      {sb && <Note tone="warn">Sandbox. The rail is {env.rail}: {env.note ?? "no bank is involved"}. Decisions are real records; the executions they describe are simulated.</Note>}
      {rows.length === 0 ? (
        <EmptyState title={sb ? "No sandbox decisions." : "No production decisions."} body="When an agent pays through the gate, the decision lands here, signed, with the settlement that followed." code={"curl -X POST localhost:8787/v1/release -d '{\"scenario\":\"clean\"}'"} />
      ) : (
        <>
          <div className="mb-5 mt-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
            <MetricCard icon={Activity} label={sb ? "Simulated transactions" : "Transactions evaluated"} value={int(rows.length)} sub="most recent on the chain" />
            <MetricCard icon={ShieldCheck} label={sb ? "Would release" : "Released"} value={ofN(count("released"), rows.length)} tone="good" />
            <MetricCard icon={ShieldAlert} label={sb ? "Would hold" : "Held"} value={ofN(count("held"), rows.length)} tone={count("held") ? "crit" : "neutral"} />
            <MetricCard icon={ShieldAlert} label={sb ? "Would escalate" : "Escalated"} value={ofN(count("escalated"), rows.length)} tone={count("escalated") ? "warn" : "neutral"} />
            <MetricCard icon={Wallet} label={sb ? "Simulated value that would be held" : "Value held from the rail"} value={money(heldAmount)} sub={`${int(count("held") + count("escalated"))} payment(s)`} />
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
                        <tr key={r.id} className={`row-link ${miss ? "bg-crit-soft/30" : ""}`}>
                          <td className="pl-6">
                            <Link href={`/decisions/${r.id}`} className="font-medium">
                              {agentDisplay(r.declaration.agentId)}
                            </Link>
                            <div className="text-[11.5px] text-ink-3">
                              <span className="mono">{r.declaration.agentId}</span> · {ago(r.createdAt)}
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
                                <StateBadge state="INCIDENT" label={sb ? "SIMULATED MISS" : "INCIDENT"} />
                                <div className="mt-0.5 text-[11.5px] text-crit-ink">{miss}</div>
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
              <Card title={sb ? "Simulated misses" : "Production misses"} aside={`${int(misses.length)}`} emphasis={misses.length ? "crit" : undefined}>
                {misses.length === 0 ? (
                  <p className="text-[13px] text-ink-3">No decision was contradicted by the rail.</p>
                ) : (
                  <ul className="grid gap-2">
                    {misses.slice(0, 6).map(({ r, miss }) => (
                      <li key={r.id}>
                        <Link href={`/decisions/${r.id}`} className="block rounded-[var(--radius-sm)] border border-crit/30 bg-surface-2 px-3 py-2 hover:border-crit">
                          <div className="flex items-center justify-between gap-2 text-[13px]">
                            <span>
                              {money(r.paymentOrder.amount, r.paymentOrder.currency)} to {r.paymentOrder.payeeName}
                            </span>
                            <StateBadge state="INCIDENT" label="MISS" />
                          </div>
                          <div className="mt-0.5 text-[12px] text-crit-ink">{miss}</div>
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
                    {risk.map((r) => {
                      const d = decisionState(r.outcome, sb);
                      return (
                        <li key={r.id}>
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
                    <Pill tone={sb ? "warn" : "good"}>{sb ? `simulated · ${env.rail}` : env.rail}</Pill>
                  </li>
                </ul>
              </Card>
              <Card title="Agent health" padded={false}>
                <ul>
                  {[...agents].map(([id, a]) => (
                    <li key={id} className="border-b border-line px-6 py-2.5 text-[13px] last:border-0">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate">{agentDisplay(id)}</span>
                        <span className="shrink-0 text-[12px] tabular text-ink-3">
                          {int(a.n)} · <span className={a.held ? "text-crit-ink" : ""}>{int(a.held)} {sb ? "would hold" : "held"}</span> · {int(a.escalated)} {sb ? "would escalate" : "escalated"}
                          {a.misses ? <span className="text-crit-ink"> · {int(a.misses)} miss</span> : null}
                        </span>
                      </div>
                      <div className="mono text-[11px] text-ink-3">{id}</div>
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
