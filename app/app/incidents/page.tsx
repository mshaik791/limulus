import { candidates } from "@/lib/api";
import { safe } from "@/lib/safe";
import { int, when } from "@/lib/format";
import { Button, Card, EmptyState, Metric, Note, Offline, PageHeader, Pill, toneForVerdict } from "@/components/ui";
import { decideAction } from "./actions";

export const metadata = { title: "Incidents" };

// Where production failures become regression tests. Each candidate was
// synthesised from a production event by re-applying the mutation that failed
// to a synthetic seed: the shape of the failure, never the customer's values.
// Nothing enters a suite without a person approving it here.

export default async function Incidents() {
  const list = await safe(candidates());
  if (!list) return <Offline />;
  const pending = list.filter((c) => c.status === "pending");
  const decided = list.filter((c) => c.status !== "pending").reverse();

  return (
    <>
      <PageHeader title="Incidents" subtitle="Production failures and near misses, each turned into a candidate regression scenario. A person decides what enters the suite." />
      <div className="mb-6 grid grid-cols-3 gap-4">
        <Metric label="Awaiting review" value={int(pending.length)} tone={pending.length ? "warn" : "neutral"} />
        <Metric label="Approved into suites" value={int(list.filter((c) => c.status === "approved").length)} tone="good" />
        <Metric label="Rejected" value={int(list.filter((c) => c.status === "rejected").length)} />
      </div>

      {pending.length === 0 ? (
        <EmptyState title="No incidents awaiting review." body="Candidates appear when the Monitor sees a production event that matches a failure shape: a gate block, a rail return, a person overriding a block, a shadow disagreement." />
      ) : (
        <div className="mb-6 grid gap-3">
          {pending.map((c) => (
            <Card key={c.id} emphasis="warn">
              <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone="warn">pending</Pill>
                    <span className="mono text-[12px] text-ink-3">{c.taxonomyNode}</span>
                    <span className="text-[12px] text-ink-3">· {int(c.count)} event(s) · org {c.org}</span>
                  </div>
                  <div className="mt-1.5 text-[16px] font-semibold">{c.scenario.title}</div>
                  <p className="mt-1 text-[13px] text-ink-2">{c.preservedProperty}. Correct answer: {c.scenario.expected}.</p>
                  <p className="mt-2 text-[12px] text-ink-3">{c.scenario.intent}</p>
                </div>
                <form action={decideAction} className="grid content-start gap-2 text-[13px]">
                  <input type="hidden" name="id" value={c.id} />
                  <input name="reason" placeholder="reason, for the record" />
                  <div className="flex gap-2">
                    <button name="decision" value="approve" className="rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-white">
                      Add to regression suite
                    </button>
                    <Button tone="neutral">Reject</Button>
                  </div>
                  <p className="text-[11px] text-ink-3">Approving writes the scenario file into this org&apos;s suite. No customer value is in it.</p>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <Card title="Decided" padded={false}>
          <table className="w-full">
            <thead>
              <tr>
                <th className="pl-5">candidate</th>
                <th>failure shape</th>
                <th>status</th>
                <th className="pr-5">decided</th>
              </tr>
            </thead>
            <tbody>
              {decided.map((c) => (
                <tr key={c.id}>
                  <td className="pl-5">
                    <div className="text-[13px]">{c.scenario.title}</div>
                    <div className="mono text-[11px] text-ink-3">{c.id}</div>
                  </td>
                  <td className="mono text-[12px]">{c.taxonomyNode}</td>
                  <td>
                    <Pill tone={toneForVerdict(c.status === "approved" ? "pass" : "rejected")}>{c.status}</Pill>
                  </td>
                  <td className="pr-5 text-[12px] text-ink-3">{c.decidedAt ? when(c.decidedAt) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <div className="mt-4">
        <Note>Two rules enforced in code: a failure produces a candidate, never a scenario; and a candidate is synthesised from a synthetic seed, so no real account, name, amount or document from the source event is ever copied in.</Note>
      </div>
    </>
  );
}
