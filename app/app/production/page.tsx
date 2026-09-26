import Link from "next/link";
import { Eye, ShieldAlert, ShieldCheck, Wallet } from "lucide-react";
import { shadowRecords, shadowSummary } from "@/lib/api";
import { safe } from "@/lib/safe";
import { int, money, ofN } from "@/lib/format";
import { MetricCard } from "@/components/blocks";
import { Card, ExecutionPath, LinkButton, Note, Offline, PageHeader, Pill, StateBadge, toneForVerdict } from "@/components/ui";

export const metadata = { title: "Shadow Mode" };

// Observe real financial-agent decisions without blocking anything. Empty, the
// page is onboarding: the flow, three steps, the call. With data it is a
// dashboard where "held" only ever follows "would have".

const rec = (a: string) => (a === "agree" ? "Agree" : a === "would_have_held" ? "Would hold" : a === "would_have_escalated" ? "Would escalate" : "Would release");

export default async function Shadow(props: PageProps<"/production">) {
  const search = await props.searchParams;
  const org = typeof search.org === "string" && search.org ? search.org : "default";
  const [summary, all] = await Promise.all([safe(shadowSummary(org)), safe(shadowRecords(org))]);
  if (!summary || !all) return <Offline />;
  const rows = [...all].reverse();

  return (
    <>
      <PageHeader
        title="Shadow Mode"
        subtitle="What would Limulus have blocked? Real decisions, observed; nothing is held."
        actions={
          <form className="flex items-center gap-2 text-[12px]">
            <label htmlFor="org" className="text-ink-3">
              org
            </label>
            <input id="org" name="org" defaultValue={org} className="w-[160px]" />
            <button className="rounded-[var(--radius-sm)] border border-line-2 bg-surface-2 px-2.5 py-1.5">show</button>
          </form>
        }
      />

      {summary.evaluated === 0 ? (
        <div className="mx-auto max-w-[760px]">
          <Card className="px-2 py-4 text-center">
            <p className="text-[18px] font-medium">Observe real agent decisions without blocking anything.</p>
            <p className="mt-1 text-[13px] text-ink-3">Nothing observed yet for org <span className="mono">{org}</span>. No transaction is ever held while Shadow Mode is on.</p>
            <div className="mx-auto mt-6 max-w-[560px]">
              <ExecutionPath steps={[{ label: "Your agent", tone: "accent" }, { label: "Limulus shadow", sub: "re-decides, read-only", tone: "model" }, { label: "Your payment system", sub: "unchanged", tone: "good" }]} />
            </div>
            <div className="mt-6">
              <LinkButton href="#connect" tone="accent">
                Connect Production Agent
              </LinkButton>
            </div>
          </Card>
          <details id="connect" className="mt-4">
            <summary className="cursor-pointer text-[13px] text-accent-ink">How to connect</summary>
            <Card className="mt-3">
              <ol className="grid gap-3 md:grid-cols-3">
                {[
                  ["Connect the production agent", "Give each decision an agent id and an org, so disagreements land in the right place."],
                  ["Mirror the decision payloads", "Send the declaration, the payment order, the documents and what production did."],
                  ["Review what Limulus would have held", "Disagreements are listed with the check that decided them; a person marks each right or wrong."],
                ].map(([t, b], i) => (
                  <li key={t} className="rounded-[var(--radius-sm)] border border-line bg-surface-2 p-4">
                    <div className="text-[11px] font-semibold tracking-[0.08em] text-accent-ink">STEP {i + 1}</div>
                    <div className="mt-1 text-[14px] font-medium">{t}</div>
                    <div className="mt-1 text-[12.5px] text-ink-3">{b}</div>
                  </li>
                ))}
              </ol>
              <div className="mt-5 text-[12px] text-ink-3">The call</div>
                <pre className="mono mt-2 rounded-[var(--radius-sm)] bg-sunken p-3 text-[11.5px] leading-relaxed text-ink-2">{`POST /v1/shadow/evaluate
{
  "org": "${org}",
  "agentId": "ap-agent",
  "authorization": { … },          // optional: defaults to the stored policy
  "declaration": { "payeeName": "…", "payeeAccountLast4": "…", "amount": 0, "currency": "USD", "invoiceId": "…", "reason": "…", "sources": [] },
  "paymentOrder": { "rail": "ach", "payeeName": "…", "payeeAccountLast4": "…", "amount": 0, "currency": "USD", "reference": "…" },
  "documents": [ { "name": "…", "type": "invoice", "text": "…" } ],
  "production": { "outcome": "released", "reference": "pay_…" }
}`}</pre>
              <p className="mt-3 text-[12px] text-ink-3">Selftest orgs exist on this engine; try org <span className="mono">selftest-*</span> from the search.</p>
            </Card>
          </details>
        </div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-5">
            <MetricCard icon={Eye} label="Decisions observed" value={int(summary.evaluated)} />
            <MetricCard icon={ShieldCheck} label="Would release" value={ofN(summary.agreed.value + summary.wouldHaveReleased.value, summary.evaluated)} tone="good" sub="agreed or more permissive" />
            <MetricCard icon={ShieldAlert} label="Would hold" value={ofN(summary.wouldHaveHeld.value, summary.evaluated)} tone={summary.wouldHaveHeld.value ? "crit" : "neutral"} />
            <MetricCard icon={ShieldAlert} label="Would escalate" value={ofN(summary.wouldHaveEscalated.value, summary.evaluated)} tone={summary.wouldHaveEscalated.value ? "warn" : "neutral"} />
            <MetricCard
              icon={Wallet}
              label="Potential exposure"
              value={money(summary.exposureWeWouldHaveStopped.amount, summary.exposureWeWouldHaveStopped.currency ?? "USD")}
              sub={`${int(summary.exposureWeWouldHaveStopped.payments)} payment(s) production released that the match would have stopped`}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <Card title="Decision stream" aside={`${int(rows.length)} most recent`} padded={false}>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="pl-6">agent</th>
                      <th>action</th>
                      <th className="text-right">amount</th>
                      <th>actual outcome</th>
                      <th>Limulus</th>
                      <th className="pr-6">reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="row-link">
                        <td className="pl-6">
                          <Link href={`/production/${r.id}`} className="font-medium">
                            {r.agentId}
                          </Link>
                        </td>
                        <td className="text-[12.5px]">
                          Pay {r.payment.payeeName}
                          <div className="text-[11.5px] text-ink-3">
                            {r.payment.invoiceId} · {r.payment.rail}
                          </div>
                        </td>
                        <td className="text-right text-[15px] tabular">{money(r.payment.amount, r.payment.currency)}</td>
                        <td>
                          <Pill tone={toneForVerdict(r.production.outcome)}>{r.production.outcome}</Pill>
                        </td>
                        <td>
                          <StateBadge state={r.agreement === "agree" ? "PASS" : r.agreement === "would_have_held" ? "HOLD" : r.agreement === "would_have_escalated" ? "ESCALATE" : "RELEASE"} label={rec(r.agreement)} />
                        </td>
                        <td className="max-w-[300px] pr-6 text-[12px] text-ink-3">
                          <span className="line-clamp-1">{r.agreement === "agree" ? "" : r.reasons[0]}</span>
                          {r.review && <Pill tone={r.review.verdict === "false_positive" ? "warn" : r.review.verdict === "confirmed" ? "good" : "neutral"}>{r.review.verdict.replaceAll("_", " ")}</Pill>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
            <div className="grid content-start gap-4 xl:col-span-4">
              <Card title="Review">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[12px] text-ink-3">disagreements</div>
                    <div className="text-[26px] font-semibold tabular">{int(summary.wouldHaveHeld.value + summary.wouldHaveEscalated.value + summary.wouldHaveReleased.value)}</div>
                    <div className="text-[12px] text-ink-3">{int(summary.reviewed.falsePositives + summary.reviewed.confirmed + summary.reviewed.unsure)} reviewed</div>
                  </div>
                  <div>
                    <div className="text-[12px] text-ink-3">false-positive rate</div>
                    <div className="text-[26px] font-semibold tabular">{summary.falsePositiveRate ? ofN(summary.falsePositiveRate.value, summary.falsePositiveRate.of) : "–"}</div>
                    <div className="text-[12px] text-ink-3">over reviewed only</div>
                  </div>
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
