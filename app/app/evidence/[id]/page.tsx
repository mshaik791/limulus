import { receipt, record, verifyReceipt } from "@/lib/api";
import { safe } from "@/lib/safe";
import { money, when } from "@/lib/format";
import { Breadcrumb } from "@/components/shell";
import { Card, Hash, KV, Note, Offline, PageHeader, Pill, toneForVerdict } from "@/components/ui";

export const metadata = { title: "Evidence packet" };

// One decision: the three records that had to agree, the checks that ran, and
// the receipt with its verification. The receipt verifies from its own public
// key, so a customer can hand it to an auditor and nobody has to call us.

export default async function EvidenceDetail(props: PageProps<"/evidence/[id]">) {
  const { id } = await props.params;
  const r = await safe(record(id));
  if (!r) return <Offline />;
  const rc = await safe(receipt(id));
  const verification = rc ? await safe(verifyReceipt(rc)) : null;

  const three: { title: string; rows: [string, React.ReactNode][] }[] = [
    {
      title: "Authorization — what a person allowed",
      rows: [
        ["principal", r.authorization.principal],
        ["policy", r.authorization.policyVersion],
        ["per payment", money(r.authorization.limitPerPayment, r.authorization.currency)],
        ["vendors", r.authorization.approvedVendors.map((v) => `${v.name} ****${v.accountLast4}`).join("; ")],
        ["invoices", r.authorization.approvedInvoices.map((i) => `${i.invoiceId} ${money(i.amount, r.authorization.currency)}`).join("; ") || "none"],
      ],
    },
    {
      title: "Declared intent — what the agent said, before executing",
      rows: [
        ["agent", <span key="a" className="mono">{r.declaration.agentId}</span>],
        ["payee", `${r.declaration.payeeName} ****${r.declaration.payeeAccountLast4}`],
        ["amount", money(r.declaration.amount, r.declaration.currency)],
        ["invoice", <span key="i" className="mono">{r.declaration.invoiceId}{r.declaration.poId ? ` / ${r.declaration.poId}` : ""}</span>],
        ["reason", r.declaration.reason],
        ["sources", r.declaration.sources.map((s) => s.name).join(", ") || "none"],
      ],
    },
    {
      title: "Execution — what would reach the bank",
      rows: [
        ["rail", r.paymentOrder.rail],
        ["payee", `${r.paymentOrder.payeeName} ****${r.paymentOrder.payeeAccountLast4}`],
        ["amount", money(r.paymentOrder.amount, r.paymentOrder.currency)],
        ["reference", <span key="r" className="mono">{r.paymentOrder.reference}</span>],
        ...(r.paymentOrder.externalId ? ([["at the bank", <span key="e" className="mono">{r.paymentOrder.externalId}</span>]] as [string, React.ReactNode][]) : []),
      ],
    },
  ];

  return (
    <>
      <Breadcrumb items={[{ href: "/evidence", label: "Evidence" }, { label: r.id }]} />
      <PageHeader
        title={`${money(r.paymentOrder.amount, r.paymentOrder.currency)} to ${r.paymentOrder.payeeName}`}
        subtitle={`${when(r.createdAt)}${r.preview ? " · preview, not a release" : ""}`}
        actions={
          <>
            <Pill tone={toneForVerdict(r.outcome)}>{r.outcome}</Pill>
            {verification && <Pill tone={verification.valid ? "good" : "crit"}>{verification.valid ? "receipt verifies" : "receipt does not verify"}</Pill>}
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        {three.map((t) => (
          <Card key={t.title} title={t.title}>
            <KV rows={t.rows} />
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card title="Checks" aside={`${r.checks.length}`}>
          <ul className="grid gap-1.5">
            {r.checks.map((c) => (
              <li key={c.id} className="grid grid-cols-[max-content_1fr] items-start gap-2 text-[13px]">
                <Pill tone={c.status === "pass" ? "good" : c.status === "fail" ? "crit" : c.status === "review" ? "warn" : "neutral"}>{c.status}</Pill>
                <div>
                  <div>{c.name}</div>
                  <div className="text-[12px] text-ink-3">{c.detail}</div>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-line pt-3 text-[13px]">
            <div className="text-[11px] text-ink-3">decision</div>
            {r.reasons.map((x, i) => (
              <div key={i}>{x}</div>
            ))}
          </div>
        </Card>

        <Card title="Receipt" aside={rc ? <span className="mono">{rc.receiptId}</span> : undefined}>
          {!rc ? (
            <Note>No receipt could be built for this record.</Note>
          ) : (
            <>
              <KV
                rows={[
                  ["record hash", <Hash key="h" value={r.hash} n={24} />],
                  ["previous", r.prevHash ? <Hash key="p" value={r.prevHash} n={24} /> : "first record"],
                  ["signature", <Hash key="s" value={r.signature} n={24} />],
                ]}
              />
              {verification && (
                <ul className="mt-3 grid gap-1 text-[12px]">
                  {verification.checks.map((c) => (
                    <li key={c.name} className="flex items-start gap-2">
                      <Pill tone={c.ok ? "good" : "crit"}>{c.ok ? "ok" : "fail"}</Pill>
                      <span>
                        {c.name} <span className="text-ink-3">{c.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <details className="mt-3">
                <summary className="cursor-pointer text-[12px] text-ink-2">the receipt as JSON</summary>
                <pre className="mt-2 max-h-[360px] overflow-auto rounded-[var(--radius-sm)] bg-sunken p-2 text-[11px] leading-snug text-ink-2">{JSON.stringify(rc, null, 2)}</pre>
              </details>
              <Note>
                Verify it yourself, offline: save the JSON and run <code className="mono">node src/verify-receipt.ts receipt.json</code>.
              </Note>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
