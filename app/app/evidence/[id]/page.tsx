import { environment, receipt, record, verifyReceipt } from "@/lib/api";
import { safe } from "@/lib/safe";
import { money, when } from "@/lib/format";
import { Breadcrumb } from "@/components/shell";
import { Card, decisionState, ExecutionPath, Hash, KV, Note, Offline, PageHeader, Pill, StateBadge, toneForVerdict } from "@/components/ui";

export const metadata = { title: "Evidence packet" };

// One decision: the three records that had to agree, the checks that ran, the
// decision, and the receipt with its verification. The receipt verifies from
// the public key inside it, so a customer can hand it to an auditor.

export default async function EvidenceDetail(props: PageProps<"/evidence/[id]">) {
  const { id } = await props.params;
  const [r, env] = await Promise.all([safe(record(id)), environment()]);
  if (!r) return <Offline />;
  const rc = await safe(receipt(id));
  const verification = rc ? await safe(verifyReceipt(rc)) : null;

  const three: { title: string; eyebrow: string; rows: [string, React.ReactNode][] }[] = [
    {
      eyebrow: "Authorization",
      title: "What a person allowed",
      rows: [
        ["principal", r.authorization.principal],
        ["policy version", <span key="pv" className="mono">{r.authorization.policyVersion}</span>],
        ["per payment", money(r.authorization.limitPerPayment, r.authorization.currency)],
        ["vendors", r.authorization.approvedVendors.map((v) => `${v.name} ****${v.accountLast4}`).join("; ")],
        ["invoices", r.authorization.approvedInvoices.map((i) => `${i.invoiceId} ${money(i.amount, r.authorization.currency)}`).join("; ") || "none"],
      ],
    },
    {
      eyebrow: "Agent intent",
      title: "What the agent declared, before executing",
      rows: [
        ["agent", <span key="a" className="mono">{r.declaration.agentId}</span>],
        ["payee", `${r.declaration.payeeName} ****${r.declaration.payeeAccountLast4}`],
        ["amount", money(r.declaration.amount, r.declaration.currency)],
        ["invoice", <span key="i" className="mono">{r.declaration.invoiceId}{r.declaration.poId ? ` / ${r.declaration.poId}` : ""}</span>],
        ["reason", r.declaration.reason],
        ["source documents", r.declaration.sources.map((s) => s.name).join(", ") || "none"],
      ],
    },
    {
      eyebrow: "Execution payload",
      title: "What would reach the bank",
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
        eyebrow={`Evidence packet · ${when(r.createdAt)}${r.preview ? " · preview, not a release" : ""}`}
        title={`${money(r.paymentOrder.amount, r.paymentOrder.currency)} to ${r.paymentOrder.payeeName}`}
        subtitle={
          <>
            <span className="mono">{r.id}</span> · evidence id <Hash value={r.hash} n={20} />
          </>
        }
        actions={
          <>
            <StateBadge state={decisionState(r.outcome, env.sandbox).state} label={decisionState(r.outcome, env.sandbox).label} size="lg" />
            {verification && <Pill tone={verification.valid ? "good" : "crit"} size="md">{verification.valid ? "receipt verifies" : "receipt does not verify"}</Pill>}
          </>
        }
      />

      <div className="mb-6">
        <ExecutionPath
          steps={[
            { label: "Agent", sub: r.declaration.agentId },
            { label: "Evidence", sub: `${r.documentHashes.length} document(s)` },
            { label: "Policy", sub: r.authorization.policyVersion },
            { label: "Decision", sub: r.outcome, tone: toneForVerdict(r.outcome) },
            { label: "Payment", sub: r.outcome === "released" ? (env.sandbox ? "would have been sent" : "sent to the rail") : "not sent", tone: r.outcome === "released" ? "good" : "neutral" },
          ]}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {three.map((t) => (
          <Card key={t.title}>
            <div className="eyebrow">{t.eyebrow}</div>
            <div className="mb-3 mt-0.5 text-[14px] font-medium">{t.title}</div>
            <KV dense rows={t.rows} />
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card title="Evaluation" aside={`${r.checks.length} checks`}>
          <ul className="grid gap-2">
            {r.checks.map((c) => (
              <li key={c.id} className="grid grid-cols-[max-content_1fr] items-start gap-3 text-[13px]">
                <Pill tone={c.status === "pass" ? "good" : c.status === "fail" ? "crit" : c.status === "review" ? "warn" : "neutral"}>{c.status}</Pill>
                <div>
                  <div>{c.name}</div>
                  <div className="text-[12px] text-ink-3">{c.detail}</div>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-line pt-3">
            <div className="eyebrow">decision</div>
            {r.reasons.map((x, i) => (
              <p key={i} className="mt-1 text-[13px]">{x}</p>
            ))}
          </div>
        </Card>

        <Card title="Receipt" aside={rc ? <span className="mono">{rc.receiptId}</span> : undefined}>
          {!rc ? (
            <Note>No receipt could be built for this record.</Note>
          ) : (
            <>
              <KV
                dense
                rows={[
                  ["record hash", <Hash key="h" value={r.hash} n={28} />],
                  ["previous record", r.prevHash ? <Hash key="p" value={r.prevHash} n={28} /> : "first record"],
                  ["signature", <Hash key="s" value={r.signature} n={28} />],
                  ["timestamp", r.createdAt],
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
                <pre className="mt-2 max-h-[360px] overflow-auto rounded-[var(--radius-sm)] bg-sunken p-2.5 text-[11px] leading-snug text-ink-2">{JSON.stringify(rc, null, 2)}</pre>
              </details>
              <Note>
                Verify it yourself, offline: save the JSON and run <code className="mono">node src/verify-receipt.ts receipt.json</code>. Only the receipt and the public key inside it are needed.
              </Note>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
