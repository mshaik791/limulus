import Link from "next/link";
import { Clock, FileLock2, ShieldCheck } from "lucide-react";
import { chainVerify, environment, records } from "@/lib/api";
import { safe } from "@/lib/safe";
import { ago, int, money, when } from "@/lib/format";
import { agentDisplay } from "@/lib/names";
import { MetricCard } from "@/components/blocks";
import { Card, decisionState, EmptyState, Offline, PageHeader, Pill, StateBadge } from "@/components/ui";

export const metadata = { title: "Evidence" };

// The decision chain as a ledger. Every record is signed and linked to the
// one before it; the chain is recomputed on every visit. Monospace only for
// the cryptographic identifiers.

export default async function Evidence() {
  const [chain, verify, env] = await Promise.all([safe(records()), safe(chainVerify()), environment()]);
  if (!chain) return <Offline />;
  const rows = [...chain].reverse();
  const signed = chain.filter((r) => r.signature && r.hash).length;
  const total = (verify?.decisions as { count?: number } | undefined)?.count ?? chain.length;

  return (
    <>
      <PageHeader
        title="Evidence"
        subtitle="Can you prove what happened? Every decision is signed and chained to the one before it; open one for the proof."
        actions={verify ? <Pill tone={verify.ok ? "good" : "crit"} size="md">{verify.ok ? "Chain verified end-to-end" : "Chain broken"}</Pill> : undefined}
      />
      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard icon={FileLock2} label="Records" value={int(total)} sub={`${int(signed)} signed · ${int(rows.length)} shown`} />
        <MetricCard icon={ShieldCheck} label="Chain" value={verify ? (verify.ok ? "Verified" : "Broken") : "–"} tone={verify?.ok ? "good" : "crit"} sub="every hash and signature recomputed on this visit" />
        <MetricCard icon={Clock} label="Latest record" value={rows[0] ? ago(rows[0].createdAt) : "–"} sub={rows[0] ? when(rows[0].createdAt) : undefined} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No decisions on the chain." />
      ) : (
        <Card padded={false}>
          <table className="w-full">
            <thead>
              <tr>
                <th className="pl-6">transaction</th>
                <th>agent</th>
                <th className="text-right">amount</th>
                <th>decision</th>
                <th>timestamp</th>
                <th className="pr-6">verification</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="row-link">
                  <td className="pl-6">
                    <Link href={`/evidence/${r.id}`} className="font-medium">
                      {r.paymentOrder.payeeName}
                    </Link>
                    <div className="text-[11.5px] text-ink-3">{r.declaration.invoiceId}</div>
                  </td>
                  <td className="text-[13px]" title={r.declaration.agentId}>{agentDisplay(r.declaration.agentId)}</td>
                  <td className="text-right text-[15px] tabular">{money(r.paymentOrder.amount, r.paymentOrder.currency)}</td>
                  <td>
                    <StateBadge state={decisionState(r.outcome, env.sandbox).state} label={decisionState(r.outcome, env.sandbox).label} />
                    {r.preview && <span className="ml-1.5 text-[11px] text-ink-3">preview</span>}
                  </td>
                  <td className="whitespace-nowrap text-[12.5px] text-ink-2">{when(r.createdAt)}</td>
                  <td className="pr-6">
                    <Pill tone={r.signature && r.hash ? "good" : "crit"}>{r.signature && r.hash ? "signed" : "unsigned"}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
