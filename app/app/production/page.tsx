import Link from "next/link";
import { shadowRecords, shadowSummary } from "@/lib/api";
import { safe } from "@/lib/safe";
import { int, money, ofN, when } from "@/lib/format";
import { Card, Empty, Note, Offline, PageHeader, Pill, Stat, toneForVerdict } from "@/components/ui";

export const metadata = { title: "Shadow" };

// Production decisions, re-decided, no authority. Every figure here is what the
// customer's own system did and what the three-way match would have done. The
// word "held" only ever follows "would have".

export default async function Production(props: PageProps<"/production">) {
  const search = await props.searchParams;
  const org = typeof search.org === "string" && search.org ? search.org : "default";
  const [summary, all] = await Promise.all([safe(shadowSummary(org)), safe(shadowRecords(org))]);
  if (!summary || !all) return <Offline />;
  const rows = [...all].reverse();
  const disagreements = summary.wouldHaveHeld.value + summary.wouldHaveEscalated.value + summary.wouldHaveReleased.value;

  return (
    <>
      <PageHeader
        title="Shadow mode"
        subtitle={
          <>
            org <span className="mono">{org}</span> · production outcomes beside what the three-way match would have done. Limulus held nothing.
          </>
        }
      />
      <form className="mb-4 flex items-center gap-2 text-[12px]">
        <label htmlFor="org" className="text-ink-3">
          org
        </label>
        <input id="org" name="org" defaultValue={org} className="w-[180px]" />
        <button className="rounded-[var(--radius-sm)] border border-line-strong px-2 py-1">show</button>
      </form>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Evaluated" value={int(summary.evaluated)} />
        <Stat label="Agreed" value={ofN(summary.agreed.value, summary.agreed.of)} tone="good" />
        <Stat label="Would have held or escalated" value={ofN(summary.wouldHaveHeld.value + summary.wouldHaveEscalated.value, summary.evaluated)} tone={summary.wouldHaveHeld.value + summary.wouldHaveEscalated.value > 0 ? "warn" : "neutral"} />
        <Stat
          label="Exposure we would have stopped"
          value={money(summary.exposureWeWouldHaveStopped.amount, summary.exposureWeWouldHaveStopped.currency ?? "USD")}
          sub={`${int(summary.exposureWeWouldHaveStopped.payments)} payment(s) released by the customer's system`}
        />
        <Stat
          label="False-positive rate"
          value={summary.falsePositiveRate ? ofN(summary.falsePositiveRate.value, summary.falsePositiveRate.of) : "–"}
          sub={summary.falsePositiveRate ? "over reviewed disagreements" : `${int(disagreements)} disagreement(s), none reviewed yet`}
        />
      </div>

      <Note>{summary.note}</Note>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card title="Decisions" aside={`${int(rows.length)} most recent`}>
          {rows.length === 0 ? (
            <Empty>
              Nothing sent yet. <code className="mono">POST /v1/shadow/evaluate</code> with a declaration, payment order and the production outcome.
            </Empty>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th>when</th>
                  <th>payment</th>
                  <th>production</th>
                  <th>we would have</th>
                  <th>agreement</th>
                  <th className="text-right">exposure</th>
                  <th>review</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">
                      <Link href={`/production/${r.id}`}>{when(r.createdAt)}</Link>
                    </td>
                    <td className="text-[12px]">
                      {money(r.payment.amount, r.payment.currency)} to {r.payment.payeeName} ****{r.payment.payeeAccountLast4} · <span className="mono">{r.payment.invoiceId}</span> · {r.payment.rail}
                    </td>
                    <td>
                      <Pill tone={toneForVerdict(r.production.outcome)}>{r.production.outcome}</Pill>
                    </td>
                    <td>
                      <Pill tone={toneForVerdict(r.wouldHave)}>{r.wouldHave}</Pill>
                    </td>
                    <td>
                      <Pill tone={toneForVerdict(r.agreement)}>{r.agreement.replaceAll("_", " ")}</Pill>
                    </td>
                    <td className="text-right tabular">{r.exposure === null ? <span className="text-ink-3">–</span> : money(r.exposure, r.payment.currency)}</td>
                    <td className="text-[12px]">{r.review ? <Pill tone={r.review.verdict === "false_positive" ? "warn" : r.review.verdict === "confirmed" ? "good" : "neutral"}>{r.review.verdict.replaceAll("_", " ")}</Pill> : r.agreement === "agree" ? "" : <span className="text-ink-3">awaiting</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Checks behind the disagreements">
          {summary.topChecks.length === 0 ? (
            <Empty>None yet.</Empty>
          ) : (
            <table className="w-full">
              <tbody>
                {summary.topChecks.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.name}
                      <div className="mono text-[11px] text-ink-3">{c.id}</div>
                    </td>
                    <td className="text-right tabular">{int(c.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
