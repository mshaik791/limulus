import Link from "next/link";
import { shadowRecords, shadowSummary } from "@/lib/api";
import { safe } from "@/lib/safe";
import { int, money, ofN } from "@/lib/format";
import { Card, EmptyState, Metric, Note, Offline, PageHeader, Pill, StateBadge, toneForVerdict } from "@/components/ui";

export const metadata = { title: "Shadow Mode" };

// Production decisions beside what the three-way match would have done. The
// word "held" only ever follows "would have"; nothing here can touch a payment.

const rec = (a: string) => (a === "agree" ? "AGREE" : a === "would_have_held" ? "WOULD HOLD" : a === "would_have_escalated" ? "WOULD ESCALATE" : "WOULD RELEASE");

export default async function Shadow(props: PageProps<"/production">) {
  const search = await props.searchParams;
  const org = typeof search.org === "string" && search.org ? search.org : "default";
  const [summary, all] = await Promise.all([safe(shadowSummary(org)), safe(shadowRecords(org))]);
  if (!summary || !all) return <Offline />;
  const rows = [...all].reverse();
  const disagreements = summary.wouldHaveHeld.value + summary.wouldHaveEscalated.value + summary.wouldHaveReleased.value;

  return (
    <>
      <PageHeader
        title="Shadow Mode"
        subtitle="See what Limulus would have held before enabling enforcement. Read-only: every outcome here is the customer's own system's."
        actions={
          <form className="flex items-center gap-2 text-[12px]">
            <label htmlFor="org" className="text-ink-3">
              org
            </label>
            <input id="org" name="org" defaultValue={org} className="w-[160px]" />
            <button className="rounded-[var(--radius-sm)] border border-line-2 px-2.5 py-1.5">show</button>
          </form>
        }
      />

      {summary.evaluated === 0 ? (
        <EmptyState
          title="No production traffic connected."
          body="Send each production decision, with what the agent declared and what reached the rail, and see what the three-way match would have done. Nothing is blocked while Shadow Mode is enabled."
          code="POST /v1/shadow/evaluate  { declaration, paymentOrder, documents, production: { outcome } }"
        />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Metric label="Decisions observed" value={int(summary.evaluated)} />
            <Metric label="Agreed" value={ofN(summary.agreed.value, summary.agreed.of)} tone="good" />
            <Metric label="Would have held" value={ofN(summary.wouldHaveHeld.value, summary.evaluated)} tone={summary.wouldHaveHeld.value ? "crit" : "neutral"} />
            <Metric label="Would have escalated" value={ofN(summary.wouldHaveEscalated.value, summary.evaluated)} tone={summary.wouldHaveEscalated.value ? "warn" : "neutral"} />
            <Metric
              label="Exposure we would have stopped"
              value={money(summary.exposureWeWouldHaveStopped.amount, summary.exposureWeWouldHaveStopped.currency ?? "USD")}
              sub={`${int(summary.exposureWeWouldHaveStopped.payments)} payment(s) released by the customer's system`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
            <Card title="Decisions" aside={`${int(rows.length)} most recent`} padded={false}>
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="pl-5">agent</th>
                    <th>action</th>
                    <th className="text-right">amount</th>
                    <th>actual outcome</th>
                    <th>Limulus</th>
                    <th className="pr-5">reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="row-link">
                      <td className="pl-5">
                        <Link href={`/production/${r.id}`} className="mono">
                          {r.agentId}
                        </Link>
                      </td>
                      <td className="text-[12.5px]">
                        Pay {r.payment.payeeName} · <span className="mono">{r.payment.invoiceId}</span> · {r.payment.rail}
                      </td>
                      <td className="text-right tabular">{money(r.payment.amount, r.payment.currency)}</td>
                      <td>
                        <Pill tone={toneForVerdict(r.production.outcome)}>{r.production.outcome}</Pill>
                      </td>
                      <td>
                        <StateBadge state={r.agreement === "agree" ? "PASS" : r.agreement === "would_have_held" ? "HOLD" : r.agreement === "would_have_escalated" ? "ESCALATE" : "RELEASE"} label={rec(r.agreement)} />
                      </td>
                      <td className="max-w-[320px] pr-5 text-[12px] text-ink-3">
                        <span className="line-clamp-1">{r.agreement === "agree" ? "" : r.reasons[0]}</span>
                        {r.review && <Pill tone={r.review.verdict === "false_positive" ? "warn" : r.review.verdict === "confirmed" ? "good" : "neutral"}>{r.review.verdict.replaceAll("_", " ")}</Pill>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <div className="grid content-start gap-4">
              <Card title="Review">
                <div className="grid gap-3">
                  <Metric label="Disagreements" value={int(disagreements)} sub={`${int(summary.reviewed.falsePositives + summary.reviewed.confirmed + summary.reviewed.unsure)} reviewed by a person`} />
                  <Metric label="False-positive rate" value={summary.falsePositiveRate ? ofN(summary.falsePositiveRate.value, summary.falsePositiveRate.of) : "–"} sub="over reviewed disagreements only" />
                </div>
              </Card>
              <Card title="Checks behind the disagreements">
                {summary.topChecks.length === 0 ? (
                  <p className="text-[13px] text-ink-3">None yet.</p>
                ) : (
                  <ul className="grid gap-1.5 text-[13px]">
                    {summary.topChecks.map((c) => (
                      <li key={c.id} className="flex justify-between gap-2">
                        <span>{c.name}</span>
                        <span className="tabular text-ink-3">{int(c.count)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Note>{summary.note}</Note>
            </div>
          </div>
        </>
      )}
    </>
  );
}
