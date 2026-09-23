import Link from "next/link";
import { outcomes, records } from "@/lib/api";
import { safe } from "@/lib/safe";
import { int, money, ofN, when } from "@/lib/format";
import { Card, EmptyState, Metric, Offline, PageHeader, Pill, StateBadge, toneForVerdict } from "@/components/ui";

export const metadata = { title: "Production" };

// The gate's real decisions, and what the rail then did with each. "Unauthorized"
// is the status that matters most: something settled although the decision held
// or escalated it, which is a payment that executed outside the control.

export default async function Production() {
  const [chain, outs] = await Promise.all([safe(records()), safe(outcomes())]);
  if (!chain || !outs) return <Offline />;
  const byDecision = new Map(outs.map((o) => [o.decisionId, o]));
  const rows = [...chain].reverse().filter((r) => !r.preview);
  const count = (k: string) => rows.filter((r) => r.outcome === k).length;
  const unauthorized = outs.filter((o) => o.status === "unauthorized").length;

  return (
    <>
      <PageHeader title="Production" subtitle="Every payment the gate ruled on, and what the rail did afterwards. Previews are left out." />
      {rows.length === 0 ? (
        <EmptyState title="No production decisions." body="When an agent pays through the gate, the decision lands here, signed, with the settlement that followed." code={"curl -X POST localhost:8787/v1/release -d '{\"scenario\":\"clean\"}'"} />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Metric label="Decisions" value={int(rows.length)} sub="most recent on the chain" />
            <Metric label="Released" value={ofN(count("released"), rows.length)} tone="good" />
            <Metric label="Held" value={ofN(count("held"), rows.length)} tone={count("held") ? "crit" : "neutral"} />
            <Metric label="Escalated" value={ofN(count("escalated"), rows.length)} tone={count("escalated") ? "warn" : "neutral"} />
            <Metric label="Settled outside the control" value={int(unauthorized)} tone={unauthorized ? "crit" : "good"} sub="held or escalated, yet settled" />
          </div>
          <Card padded={false}>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="pl-5">when</th>
                  <th>agent</th>
                  <th>payment</th>
                  <th>decision</th>
                  <th>rail</th>
                  <th className="pr-5">reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const o = byDecision.get(r.id);
                  return (
                    <tr key={r.id} className="row-link">
                      <td className="pl-5 whitespace-nowrap">
                        <Link href={`/evidence/${r.id}`}>{when(r.createdAt)}</Link>
                      </td>
                      <td className="mono text-[12px]">{r.declaration.agentId}</td>
                      <td className="text-[12.5px]">
                        {money(r.paymentOrder.amount, r.paymentOrder.currency)} to {r.paymentOrder.payeeName} ****{r.paymentOrder.payeeAccountLast4} · <span className="mono">{r.declaration.invoiceId}</span>
                      </td>
                      <td>
                        <StateBadge state={r.outcome === "released" ? "RELEASE" : r.outcome === "held" ? "HOLD" : "ESCALATE"} />
                      </td>
                      <td>{o ? <Pill tone={toneForVerdict(o.status)}>{o.status}</Pill> : <span className="text-[12px] text-ink-3">no settlement yet</span>}</td>
                      <td className="max-w-[360px] pr-5 text-[12px] text-ink-3">
                        <span className="line-clamp-1">{r.reasons[0]}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
