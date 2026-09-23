import Link from "next/link";
import { chainVerify, records } from "@/lib/api";
import { safe } from "@/lib/safe";
import { int, money, when } from "@/lib/format";
import { Card, Empty, Hash, Offline, PageHeader, Pill, toneForVerdict } from "@/components/ui";

export const metadata = { title: "Evidence" };

// The decision chain. Every payment the gate ruled on, signed and linked to the
// one before it; open one for the receipt anyone can verify without us.

export default async function Evidence() {
  const [chain, verify] = await Promise.all([safe(records()), safe(chainVerify())]);
  if (!chain) return <Offline />;
  const rows = [...chain].reverse();

  return (
    <>
      <PageHeader
        title="Evidence"
        subtitle="The signed decision chain, most recent first."
        actions={verify ? <Pill tone={verify.ok ? "good" : "crit"}>{verify.ok ? `chain verifies` : "chain broken"}</Pill> : undefined}
      />
      <Card>
        {rows.length === 0 ? (
          <Empty>No decisions on the chain.</Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th>when</th>
                <th>outcome</th>
                <th>payment</th>
                <th>agent</th>
                <th>reasons</th>
                <th>record</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/evidence/${r.id}`}>{when(r.createdAt)}</Link>
                  </td>
                  <td>
                    <Pill tone={toneForVerdict(r.outcome)}>{r.outcome}</Pill>
                    {r.preview && <span className="ml-1 text-[11px] text-ink-3">preview</span>}
                  </td>
                  <td className="text-[12px]">
                    {money(r.paymentOrder.amount, r.paymentOrder.currency)} to {r.paymentOrder.payeeName} ****{r.paymentOrder.payeeAccountLast4} · <span className="mono">{r.declaration.invoiceId}</span> · {r.paymentOrder.rail}
                  </td>
                  <td className="mono text-[12px]">{r.declaration.agentId}</td>
                  <td className="max-w-[360px] text-[12px] text-ink-3">{r.reasons[0]}{r.reasons.length > 1 ? ` (+${int(r.reasons.length - 1)})` : ""}</td>
                  <td>
                    <Hash value={r.hash} n={10} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
