import Link from "next/link";
import { outcomes, record } from "@/lib/api";
import { safe } from "@/lib/safe";
import { money, when } from "@/lib/format";
import { Breadcrumb } from "@/components/shell";
import { Card, ExecutionPath, KV, LinkButton, Offline, PageHeader, Pill, StateBadge, toneForVerdict } from "@/components/ui";

export const metadata = { title: "Transaction" };

// One transaction as the three records side by side, with every field that
// disagrees marked. The mismatches are the same ones the checks fired on;
// this screen shows where in the three records they sit.

export default async function TransactionDetail(props: PageProps<"/decisions/[id]">) {
  const { id } = await props.params;
  const [r, outs] = await Promise.all([safe(record(id)), safe(outcomes())]);
  if (!r) return <Offline />;
  const outcome = (outs ?? []).find((o) => o.decisionId === r.id);
  const vendor = r.authorization.approvedVendors.find((v) => v.name.toLowerCase() === r.declaration.payeeName.toLowerCase());
  const approved = r.authorization.approvedInvoices.find((i) => i.invoiceId === r.declaration.invoiceId);
  const cur = r.authorization.currency;

  const fields: { label: string; auth: string; intent: string; exec: string; mismatch: string | null }[] = [
    {
      label: "Vendor",
      auth: vendor ? vendor.name : "not on the approved list",
      intent: r.declaration.payeeName,
      exec: r.paymentOrder.payeeName,
      mismatch: !vendor ? "not authorized" : r.declaration.payeeName !== r.paymentOrder.payeeName ? "intent ≠ execution" : null,
    },
    {
      label: "Amount",
      auth: approved ? `${money(approved.amount, cur)} approved · limit ${money(r.authorization.limitPerPayment, cur)}` : `no approval on file · limit ${money(r.authorization.limitPerPayment, cur)}`,
      intent: money(r.declaration.amount, r.declaration.currency),
      exec: money(r.paymentOrder.amount, r.paymentOrder.currency),
      mismatch:
        r.declaration.amount !== r.paymentOrder.amount
          ? "intent ≠ execution"
          : r.paymentOrder.amount > r.authorization.limitPerPayment
            ? "above the limit"
            : approved && Math.abs(approved.amount - r.declaration.amount) > 0.005
              ? "differs from the approval"
              : null,
    },
    {
      label: "Invoice",
      auth: approved ? `${approved.invoiceId} approved by ${approved.approvedBy}` : "no approval on file",
      intent: r.declaration.invoiceId,
      exec: r.paymentOrder.reference,
      mismatch: !approved ? "no human approval" : null,
    },
    {
      label: "Beneficiary",
      auth: vendor ? `****${vendor.accountLast4} on file` : "–",
      intent: `****${r.declaration.payeeAccountLast4}`,
      exec: `****${r.paymentOrder.payeeAccountLast4}`,
      mismatch: vendor && r.paymentOrder.payeeAccountLast4 !== vendor.accountLast4 ? "does not match the record" : r.declaration.payeeAccountLast4 !== r.paymentOrder.payeeAccountLast4 ? "intent ≠ execution" : null,
    },
    { label: "Rail", auth: "–", intent: "–", exec: r.paymentOrder.rail, mismatch: null },
  ];
  // Checks that fired but are not a disagreement between the three records:
  // a duplicate, a recent similar payment, an instruction hidden in a document.
  // They sit under the three columns so the reason for a hold is never absent.
  const covered = new Set(["vendor_approved", "within_limit", "invoice_approved", "payee_account", "declaration_matches_order"]);
  for (const c of r.checks.filter((x) => (x.status === "fail" || x.status === "review") && !covered.has(x.id))) {
    fields.push({ label: c.name, auth: "–", intent: "–", exec: c.detail, mismatch: c.status === "fail" ? c.name.toLowerCase() : `review · ${c.name.toLowerCase()}` });
  }

  return (
    <>
      <Breadcrumb items={[{ href: "/decisions", label: "Production" }, { label: r.id }]} />
      <PageHeader
        eyebrow={`Transaction · ${when(r.createdAt)}`}
        title={`${money(r.paymentOrder.amount, r.paymentOrder.currency)} to ${r.paymentOrder.payeeName}`}
        subtitle={
          <>
            {r.declaration.invoiceId} · {r.paymentOrder.rail} · agent {r.declaration.agentId}
          </>
        }
        actions={
          <>
            <StateBadge state={r.outcome === "released" ? "RELEASE" : r.outcome === "held" ? "HOLD" : "ESCALATE"} size="lg" />
            {outcome && <Pill tone={toneForVerdict(outcome.status)} size="md">rail: {outcome.status}</Pill>}
          </>
        }
      />

      <div className="mb-5">
        <ExecutionPath
          steps={[
            { label: "Agent", sub: r.declaration.agentId },
            { label: "Evidence", sub: `${r.documentHashes.length} document(s)` },
            { label: "Policy", sub: r.authorization.policyVersion },
            { label: "Decision", sub: r.outcome, tone: toneForVerdict(r.outcome) },
            { label: "Payment", sub: r.outcome === "released" ? "sent to the rail" : "not sent", tone: r.outcome === "released" ? "good" : "neutral" },
          ]}
        />
      </div>

      <Card padded={false} emphasis={r.outcome === "held" ? "crit" : r.outcome === "escalated" ? "warn" : "good"}>
        <table className="w-full">
          <thead>
            <tr>
              <th className="pl-6">field</th>
              <th>
                <span className="eyebrow">Authorization</span>
                <div className="text-[12px] normal-case tracking-normal text-ink-2">what a person allowed</div>
              </th>
              <th>
                <span className="eyebrow">Agent intent</span>
                <div className="text-[12px] normal-case tracking-normal text-ink-2">what the agent declared</div>
              </th>
              <th>
                <span className="eyebrow">Execution</span>
                <div className="text-[12px] normal-case tracking-normal text-ink-2">what would reach the bank</div>
              </th>
              <th className="pr-6">match</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.label} className={f.mismatch ? (f.mismatch.startsWith("review") ? "bg-warn-soft/30" : "bg-crit-soft/40") : ""}>
                <td className="pl-6 text-[12.5px] text-ink-3">{f.label}</td>
                <td className="text-[13.5px]">{f.auth}</td>
                <td className="text-[13.5px]">{f.intent}</td>
                <td className="text-[13.5px]">{f.exec}</td>
                <td className="pr-6">{f.mismatch ? <Pill tone={f.mismatch.startsWith("review") ? "warn" : "crit"}>{f.mismatch.startsWith("review") ? f.mismatch.toUpperCase() : `MISMATCH · ${f.mismatch}`}</Pill> : <Pill tone="good">match</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="mt-5 grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <Card title="Checks" aside={`${r.checks.length}`}>
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
          </Card>
        </div>
        <div className="grid content-start gap-4 xl:col-span-5">
          <Card emphasis={r.outcome === "held" ? "crit" : r.outcome === "escalated" ? "warn" : "good"}>
            <div className="eyebrow">Final decision</div>
            <div className="mt-2">
              <StateBadge state={r.outcome === "released" ? "RELEASE" : r.outcome === "held" ? "HOLD" : "ESCALATE"} size="lg" />
            </div>
            <ul className="mt-3 grid gap-1 text-[13px]">
              {r.reasons.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
            {outcome && (
              <div className="mt-3 border-t border-line pt-3 text-[12.5px] text-ink-2">
                Rail afterwards: <Pill tone={toneForVerdict(outcome.status)}>{outcome.status}</Pill>
                {outcome.status === "unauthorized" && <span className="ml-2 text-crit-ink">settled although the decision did not release it</span>}
              </div>
            )}
          </Card>
          <Card title="Evidence">
            <KV
              dense
              rows={[
                ["record", <Link key="r" href={`/evidence/${r.id}`} className="mono text-accent-ink">{r.id}</Link>],
                ["policy", r.authorization.policyVersion],
                ["documents", r.documentHashes.map((d) => d.name).join(", ") || "none"],
              ]}
            />
            <div className="mt-3">
              <LinkButton href={`/evidence/${r.id}`}>Open Evidence</LinkButton>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
