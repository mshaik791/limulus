import Link from "next/link";
import { candidates, environment, outcomes, records } from "@/lib/api";
import { safe } from "@/lib/safe";
import { productionMiss } from "@/lib/misses";
import { ago, int, money, when } from "@/lib/format";
import { agentDisplay } from "@/lib/names";
import { Button, Card, ExecutionPath, LinkButton, Note, Offline, PageHeader, Pill, StateBadge, toneForVerdict } from "@/components/ui";
import { decideAction } from "./actions";

export const metadata = { title: "Incidents" };

// Two sources feed this page. Production misses: a gate decision the rail then
// contradicted, read straight from the decision chain and its outcomes. And
// candidates: signals the Monitor turned into candidate regression scenarios,
// synthesised from a synthetic seed so no customer value is in them. Nothing
// enters a suite until a person approves it here.

export default async function Incidents() {
  const [list, chain, outs, env] = await Promise.all([safe(candidates()), safe(records()), safe(outcomes()), environment()]);
  if (!list || !chain || !outs) return <Offline />;
  const pending = list.filter((c) => c.status === "pending");
  const decided = list.filter((c) => c.status !== "pending").reverse();
  const byDecision = new Map(outs.map((o) => [o.decisionId, o]));
  const misses = [...chain]
    .reverse()
    .filter((r) => !r.preview)
    .map((r) => ({ r, miss: productionMiss(r, byDecision.get(r.id)) }))
    .filter((x): x is { r: (typeof chain)[number]; miss: string } => Boolean(x.miss));

  return (
    <>
      <PageHeader title="Incidents" subtitle="Production misses and near misses, and the candidate regression scenarios made from them. A person decides what enters the suite." />

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Card>
          <div className="text-[12px] text-ink-3">{env.sandbox ? "Simulated misses" : "Production misses"}</div>
          <div className={`mt-1 text-[28px] font-semibold tabular ${misses.length ? "text-crit-ink" : ""}`}>{int(misses.length)}</div>
          <div className="text-[11.5px] text-ink-3">decision contradicted by the observed outcome</div>
        </Card>
        <Card>
          <div className="text-[12px] text-ink-3">Candidates awaiting review</div>
          <div className={`mt-1 text-[28px] font-semibold tabular ${pending.length ? "text-warn-ink" : ""}`}>{int(pending.length)}</div>
        </Card>
        <Card>
          <div className="text-[12px] text-ink-3">Approved into suites</div>
          <div className="mt-1 text-[28px] font-semibold tabular text-good-ink">{int(list.filter((c) => c.status === "approved").length)}</div>
        </Card>
        <Card>
          <div className="text-[12px] text-ink-3">Rejected</div>
          <div className="mt-1 text-[28px] font-semibold tabular">{int(list.filter((c) => c.status === "rejected").length)}</div>
        </Card>
      </div>

      {misses.length > 0 && (
        <Card title={env.sandbox ? "Simulated misses" : "Production misses"} aside={`${int(misses.length)} · from the decision chain`} emphasis="crit" className="mb-5" padded={false}>
          <ul>
            {misses.slice(0, 12).map(({ r, miss }) => (
              <li key={r.id} className="flex items-center gap-4 border-b border-line px-6 py-3 last:border-0 hover:bg-surface-2">
                <StateBadge state="INCIDENT" label={env.sandbox ? "SIMULATED MISS" : "INCIDENT"} />
                <div className="min-w-0 flex-1">
                  <Link href={`/decisions/${r.id}`} className="text-[13px] font-medium">
                    {money(r.paymentOrder.amount, r.paymentOrder.currency)} to {r.paymentOrder.payeeName} · {agentDisplay(r.declaration.agentId)}
                  </Link>
                  <div className="text-[12px] text-crit-ink">
                    Limulus would {r.outcome === "released" ? "release" : r.outcome === "held" ? "hold" : "escalate"} · {miss}
                  </div>
                </div>
                <div className="text-[12px] text-ink-3">{ago(r.createdAt)}</div>
                <LinkButton href={`/decisions/${r.id}`} tone="crit">
                  Investigate
                </LinkButton>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {pending.length === 0 ? (
        <Card className="mb-5">
          <div className="text-[16px] font-medium">No candidates awaiting review.</div>
          <p className="mt-1 text-[13px] text-ink-3">Candidates appear when the Monitor sees a production signal that matches a failure shape: a gate block, a rail return, a person overriding a block, a shadow disagreement.</p>
          <div className="mt-4">
            <ExecutionPath steps={[{ label: "Production signal", tone: "accent" }, { label: "Candidate incident", tone: "warn" }, { label: "Human review", tone: "neutral" }, { label: "Regression scenario", tone: "good" }]} />
          </div>
          <div className="mt-4">
            <LinkButton href="/decisions">View Production Activity</LinkButton>
          </div>
        </Card>
      ) : (
        <div className="mb-5 grid gap-3">
          {pending.map((c) => (
            <Card key={c.id} emphasis="warn">
              <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StateBadge state="REVIEW" label={c.scenario.severity.toUpperCase()} />
                    <span className="mono text-[12px] text-ink-3">{c.taxonomyNode}</span>
                    <span className="text-[12px] text-ink-3">· {int(c.count)} signal(s) · org {c.org}</span>
                  </div>
                  <div className="mt-2 text-[18px] font-semibold leading-snug">{c.scenario.title}</div>
                  <p className="mt-1 text-[13px] text-ink-2">
                    {c.preservedProperty}. Correct answer: <span className="text-ink">{c.scenario.expected}</span>.
                  </p>
                  <p className="mt-2 text-[12.5px] text-ink-3">{c.scenario.intent}</p>
                  <p className="mt-2 text-[12px] text-ink-3">Detected {ago(c.createdAt)}</p>
                </div>
                <form action={decideAction} className="grid content-start gap-2 text-[13px]">
                  <input name="reason" placeholder="reason, for the record" />
                  <input type="hidden" name="id" value={c.id} />
                  <div className="flex flex-wrap gap-2">
                    <button name="decision" value="approve" className="rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-white">
                      Create Regression Test
                    </button>
                    <Button tone="neutral">Dismiss</Button>
                  </div>
                  <p className="text-[11.5px] text-ink-3">Approving writes the scenario file into this org&apos;s suite. No customer value is in it.</p>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <Card title="Decided candidates" aside={`${int(decided.length)}`} padded={false}>
          <ul>
            {decided.map((c) => (
              <li key={c.id} className="flex items-center gap-4 border-b border-line px-6 py-3 last:border-0">
                <Pill tone={toneForVerdict(c.status === "approved" ? "pass" : "rejected")}>{c.status}</Pill>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{c.scenario.title}</div>
                  <div className="mono text-[11px] text-ink-3">
                    {c.id} · {c.taxonomyNode}
                  </div>
                </div>
                <div className="text-[12px] text-ink-3">{c.decidedAt ? when(c.decidedAt) : "–"}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="mt-4">
        <Note>Two rules enforced in code: a failure produces a candidate, never a scenario; and a candidate is synthesised from a synthetic seed, so no real account, name, amount or document from the source event is ever copied in.</Note>
      </div>
    </>
  );
}
