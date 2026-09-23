import { shadowRecord } from "@/lib/api";
import { safe } from "@/lib/safe";
import { money, when } from "@/lib/format";
import { Breadcrumb } from "@/components/shell";
import { Button, Card, Hash, KV, Note, Offline, PageHeader, Pill, toneForVerdict } from "@/components/ui";
import { reviewAction } from "../actions";

export const metadata = { title: "Shadow decision" };

// The "proof before money moves" screen, in shadow. What was authorized, what
// the agent declared, what reached the rail, which checks fired, and the two
// verdicts side by side: production's, and ours.

export default async function ShadowDetail(props: PageProps<"/production/[id]">) {
  const { id } = await props.params;
  const r = await safe(shadowRecord(id));
  if (!r) return <Offline />;
  const checks = r.checks ?? [];

  return (
    <>
      <Breadcrumb items={[{ href: "/production", label: "Shadow" }, { label: r.id }]} />
      <PageHeader
        title={`${money(r.payment.amount, r.payment.currency)} to ${r.payment.payeeName}`}
        subtitle={
          <>
            <span className="mono">{r.payment.invoiceId}</span> · {r.payment.rail} · ****{r.payment.payeeAccountLast4} · agent <span className="mono">{r.agentId}</span> · {when(r.createdAt)}
          </>
        }
        actions={r.verification ? <Pill tone={r.verification.ok ? "good" : "crit"}>{r.verification.ok ? "signature verifies" : "signature broken"}</Pill> : undefined}
      />

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-[var(--radius)] border border-line bg-surface px-4 py-3">
          <div className="text-[12px] text-ink-3">production did</div>
          <div className="mt-1">
            <Pill tone={toneForVerdict(r.production.outcome)}>{r.production.outcome}</Pill>
          </div>
          {r.production.reference && <div className="mt-1 mono text-[12px] text-ink-3">{r.production.reference}</div>}
        </div>
        <div className="rounded-[var(--radius)] border border-line bg-surface px-4 py-3">
          <div className="text-[12px] text-ink-3">we would have</div>
          <div className="mt-1">
            <Pill tone={toneForVerdict(r.wouldHave)}>{r.wouldHave}</Pill>
          </div>
        </div>
        <div className="rounded-[var(--radius)] border border-line bg-surface px-4 py-3">
          <div className="text-[12px] text-ink-3">so</div>
          <div className="mt-1">
            <Pill tone={toneForVerdict(r.agreement)}>{r.agreement.replaceAll("_", " ")}</Pill>
          </div>
          {r.exposure !== null && <div className="mt-1 text-[12px] text-ink-3">{money(r.exposure, r.payment.currency)} the customer&apos;s system released that we would have stopped</div>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card title="Three-way match" aside={`${checks.length} checks`}>
          {checks.length === 0 ? (
            <Note>The list view omits checks; this record&apos;s checks were not returned.</Note>
          ) : (
            <ul className="grid gap-1.5">
              {checks.map((c) => (
                <li key={c.id} className="grid grid-cols-[max-content_1fr] items-start gap-2 text-[13px]">
                  <Pill tone={c.status === "pass" ? "good" : c.status === "fail" ? "crit" : c.status === "review" ? "warn" : "neutral"}>{c.status}</Pill>
                  <div>
                    <div>{c.name}</div>
                    <div className="text-[12px] text-ink-3">{c.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 border-t border-line pt-3">
            <div className="text-[11px] text-ink-3">reasons</div>
            <ul className="text-[13px]">
              {r.reasons.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        </Card>

        <div className="grid content-start gap-4">
          <Card title="Record">
            <KV
              rows={[
                ["org", r.org],
                ["policy", <Hash key="p" value={r.authorizationPolicyId} />],
                ["documents", r.documentHashes.length ? r.documentHashes.map((d) => d.name).join(", ") : "none supplied"],
                ["record", <Hash key="h" value={r.hash} />],
              ]}
            />
          </Card>
          <Card title="A person's review">
            {r.review ? (
              <div className="text-[13px]">
                <Pill tone={r.review.verdict === "false_positive" ? "warn" : r.review.verdict === "confirmed" ? "good" : "neutral"}>{r.review.verdict.replaceAll("_", " ")}</Pill>
                <p className="mt-2 text-ink-2">{r.review.note}</p>
                <p className="mt-1 text-[11px] text-ink-3">{when(r.review.at)}</p>
              </div>
            ) : r.agreement === "agree" ? (
              <p className="text-[13px] text-ink-3">Nothing to review: both sides agreed.</p>
            ) : (
              <form action={reviewAction} className="grid gap-2 text-[13px]">
                <input type="hidden" name="id" value={r.id} />
                <select name="verdict" defaultValue="confirmed" aria-label="verdict">
                  <option value="confirmed">confirmed: the match was right</option>
                  <option value="false_positive">false positive: production was right</option>
                  <option value="unsure">unsure</option>
                </select>
                <textarea name="note" rows={3} placeholder="What the person found, in a sentence." required minLength={3} />
                <Button tone="accent">Record review</Button>
                <p className="text-[11px] text-ink-3">The review sits beside the sealed record and does not alter it.</p>
              </form>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
