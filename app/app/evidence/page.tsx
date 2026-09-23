import Link from "next/link";
import { chainVerify, records } from "@/lib/api";
import { safe } from "@/lib/safe";
import { int, money, when } from "@/lib/format";
import { Card, EmptyState, Hash, Offline, PageHeader, Pill, StateBadge } from "@/components/ui";

export const metadata = { title: "Evidence" };

// The decision chain. Every payment the gate ruled on, signed and linked to
// the one before it. Open one for the packet anyone can verify without us.

export default async function Evidence() {
  const [chain, verify] = await Promise.all([safe(records()), safe(chainVerify())]);
  if (!chain) return <Offline />;
  const rows = [...chain].reverse();

  return (
    <>
      <PageHeader
        title="Evidence"
        subtitle="The signed decision chain, most recent first. Each record carries its hash, its signature and the hash of the record before it."
        actions={verify ? <Pill tone={verify.ok ? "good" : "crit"} size="md">{verify.ok ? "chain verifies end to end" : "chain broken"}</Pill> : undefined}
      />
      {rows.length === 0 ? (
        <EmptyState title="No decisions on the chain." />
      ) : (
        <Card padded={false}>
          <table className="w-full">
            <thead>
              <tr>
                <th className="pl-5">record</th>
                <th>when</th>
                <th>agent</th>
                <th>payment</th>
                <th>decision</th>
                <th className="pr-5">evidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="row-link">
                  <td className="pl-5">
                    <Link href={`/evidence/${r.id}`} className="mono text-[12px]">
                      {r.id}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap text-[12.5px]">{when(r.createdAt)}</td>
                  <td className="mono text-[12px]">{r.declaration.agentId}</td>
                  <td className="text-[12.5px]">
                    {money(r.paymentOrder.amount, r.paymentOrder.currency)} to {r.paymentOrder.payeeName} · <span className="mono">{r.declaration.invoiceId}</span>
                  </td>
                  <td>
                    <StateBadge state={r.outcome === "released" ? "RELEASE" : r.outcome === "held" ? "HOLD" : "ESCALATE"} />
                    {r.preview && <span className="ml-1.5 text-[11px] text-ink-3">preview</span>}
                  </td>
                  <td className="pr-5">
                    <Pill tone="good">signed</Pill> <Hash value={r.hash} n={10} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <p className="mt-3 text-[11.5px] text-ink-3">{int(rows.length)} shown. The chain itself is verified above, every hash and signature recomputed.</p>
    </>
  );
}
