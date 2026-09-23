import Link from "next/link";
import { Clock, FileLock2, ShieldCheck, Signature } from "lucide-react";
import { chainVerify, records } from "@/lib/api";
import { safe } from "@/lib/safe";
import { ago, int, money, pct, when } from "@/lib/format";
import { MetricCard } from "@/components/blocks";
import { Card, EmptyState, Hash, Offline, PageHeader, Pill, StateBadge } from "@/components/ui";

export const metadata = { title: "Evidence Ledger" };

// The decision chain as a ledger. Every record is signed and linked to the
// one before it; the chain is recomputed on every visit. Monospace only for
// the cryptographic identifiers.

export default async function Evidence() {
  const [chain, verify] = await Promise.all([safe(records()), safe(chainVerify())]);
  if (!chain) return <Offline />;
  const rows = [...chain].reverse();
  const signed = chain.filter((r) => r.signature && r.hash).length;
  const total = (verify?.decisions as { count?: number } | undefined)?.count ?? chain.length;

  return (
    <>
      <PageHeader
        title="Evidence Ledger"
        subtitle="The signed decision chain. Each record carries its hash, its signature and the hash of the record before it."
        actions={verify ? <Pill tone={verify.ok ? "good" : "crit"} size="md">{verify.ok ? "Chain verified end-to-end" : "Chain broken"}</Pill> : undefined}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard icon={FileLock2} label="Records" value={int(total)} sub={`${int(rows.length)} shown`} />
        <MetricCard icon={Signature} label="Signed" value={pct(signed, chain.length)} sub="Ed25519 over a SHA-256 hash" tone="good" />
        <MetricCard icon={ShieldCheck} label="Verification" value={verify ? (verify.ok ? "Healthy" : "Broken") : "–"} tone={verify?.ok ? "good" : "crit"} sub="every hash and signature recomputed" />
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
                <th>policy</th>
                <th>timestamp</th>
                <th className="pr-6">signature</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="row-link">
                  <td className="pl-6">
                    <Link href={`/evidence/${r.id}`} className="font-medium">
                      {r.paymentOrder.payeeName}
                    </Link>
                    <div className="mono text-[11px] text-ink-3">{r.id}</div>
                  </td>
                  <td className="text-[13px]">{r.declaration.agentId}</td>
                  <td className="text-right text-[15px] tabular">{money(r.paymentOrder.amount, r.paymentOrder.currency)}</td>
                  <td>
                    <StateBadge state={r.outcome === "released" ? "RELEASE" : r.outcome === "held" ? "HOLD" : "ESCALATE"} />
                    {r.preview && <span className="ml-1.5 text-[11px] text-ink-3">preview</span>}
                  </td>
                  <td className="text-[12.5px] text-ink-2">{r.authorization.policyVersion}</td>
                  <td className="whitespace-nowrap text-[12.5px] text-ink-2">{when(r.createdAt)}</td>
                  <td className="pr-6">
                    <Pill tone="good">signed</Pill> <Hash value={r.hash} n={10} />
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
