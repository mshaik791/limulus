import { shadowRecord } from "@/lib/api";
import { safe } from "@/lib/safe";
import { money, when } from "@/lib/format";
import { Breadcrumb } from "@/components/shell";
import { Button, Card, ExecutionPath, Hash, KV, Note, Offline, PageHeader, Pill, StateBadge, toneForVerdict } from "@/components/ui";
import { reviewAction } from "../actions";

export const metadata = { title: "Shadow decision" };

export default async function ShadowDetail(props: PageProps<"/production/[id]">) {
  const { id } = await props.params;
  const r = await safe(shadowRecord(id));
  if (!r) return <Offline />;
  const checks = r.checks ?? [];
  const failed = checks.filter((c) => c.status === "fail" || c.status === "review");

  return (
    <>
      <Breadcrumb items={[{ href: "/production", label: "Shadow Mode" }, { label: r.id }]} />
      <PageHeader
        eyebrow={`Shadow decision · ${when(r.createdAt)}`}
        title={`${money(r.payment.amount, r.payment.currency)} to ${r.payment.payeeName}`}
        subtitle={
          <>
            <span className="mono">{r.payment.invoiceId}</span> · {r.payment.rail} · ****{r.payment.payeeAccountLast4} · agent <span className="mono">{r.agentId}</span> · org <span className="mono">{r.org}</span>
          </>
        }
        actions={r.verification ? <Pill tone={r.verification.ok ? "good" : "crit"}>{r.verification.ok ? "signature verifies" : "signature broken"}</Pill> : undefined}
      />

      <div className="mb-6">
        <ExecutionPath
          steps={[
            { label: "Agent", sub: r.agentId },
            { label: "Evidence", sub: `${r.documentHashes.length} document(s)` },
            { label: "Policy", sub: r.authorizationPolicyId.slice(0, 12) },
            { label: "Decision", sub: r.wouldHave, tone: toneForVerdict(r.wouldHave) },
            { label: "Payment", sub: r.production.outcome, tone: toneForVerdict(r.production.outcome) },
          ]}
        />
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card>
          <div className="eyebrow">Production did</div>
          <div className="mt-2">
            <StateBadge state={r.production.outcome === "released" ? "RELEASE" : r.production.outcome === "held" ? "HOLD" : "ESCALATE"} size="lg" />
          </div>
          {r.production.reference && <div className="mono mt-2 text-[12px] text-ink-3">{r.production.reference}</div>}
        </Card>
        <Card>
          <div className="eyebrow">Limulus would have</div>
          <div className="mt-2">
            <StateBadge state={r.wouldHave === "released" ? "RELEASE" : r.wouldHave === "held" ? "HOLD" : "ESCALATE"} size="lg" />
          </div>
          <div className="mt-2 text-[12px] text-ink-3">{failed.length ? `${failed.length} check(s) fired` : "every check passed"}</div>
        </Card>
        <Card>
          <div className="eyebrow">So</div>
          <div className="mt-2">
            <StateBadge state={r.agreement === "agree" ? "PASS" : r.agreement === "would_have_held" ? "BLOCKED" : "REVIEW"} label={r.agreement.replaceAll("_", " ").toUpperCase()} size="lg" />
          </div>
          {r.exposure !== null && <div className="mt-2 text-[12px] text-ink-2">{money(r.exposure, r.payment.currency)} the customer&apos;s system released that the match would have stopped</div>}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card title="Three-way match" aside={`${checks.length} checks`}>
          {checks.length === 0 ? (
            <Note>This record&apos;s checks were not returned.</Note>
          ) : (
            <ul className="grid gap-2">
              {checks.map((c) => (
                <li key={c.id} className="grid grid-cols-[max-content_1fr] items-start gap-3 text-[13px]">
                  <Pill tone={c.status === "pass" ? "good" : c.status === "fail" ? "crit" : c.status === "review" ? "warn" : "neutral"}>{c.status}</Pill>
                  <div>
                    <div>{c.name}</div>
                    <div className="text-[12px] text-ink-3">{c.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 border-t border-line pt-3">
            <div className="eyebrow">reasons</div>
            <ul className="mt-1 text-[13px]">
              {r.reasons.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        </Card>

        <div className="grid content-start gap-4">
          <Card title="Record">
            <KV
              dense
              rows={[
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
                <p className="text-[11px] text-ink-3">The review sits beside the sealed record and does not alter it. A confirmed disagreement becomes a candidate in Incidents.</p>
              </form>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
