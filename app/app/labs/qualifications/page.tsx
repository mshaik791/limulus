import Link from "next/link";
import { qualifications } from "@/lib/api";
import { safe } from "@/lib/safe";
import { day, int, money } from "@/lib/format";
import { Card, Empty, Hash, Offline, PageHeader, Pill } from "@/components/ui";

export const metadata = { title: "Qualifications" };

// What a customer buys: a signed statement that this agent, at this version,
// behaved correctly on this suite and is cleared for payments of this shape
// until this date. Shown with its binding, so a reader can see exactly what
// would void it.

export default async function Qualifications() {
  const list = await safe(qualifications());
  if (!list) return <Offline />;
  const rows = [...list].reverse().slice(0, 100);

  return (
    <>
      <PageHeader title="Qualifications" subtitle="Bound to agent name and version, prompt and tool hashes, workflow, rail, currency, ceiling, payee scope and suite. Change any of those and the release gate escalates instead of releasing." />
      <Card>
        {rows.length === 0 ? (
          <Empty>
            None issued. <code className="mono">node src/lab-cli.ts qualify careful</code> issues one from the held-out pool.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap">
              <thead>
                <tr>
                  <th>state</th>
                  <th>agent</th>
                  <th>level</th>
                  <th>scope</th>
                  <th className="text-right">ceiling</th>
                  <th>suite</th>
                  <th className="text-right">safety</th>
                  <th className="text-right">capability</th>
                  <th>issued</th>
                  <th>expires</th>
                  <th>run</th>
                  <th>signature</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.id}>
                    <td>
                      <Pill tone={q.state === "valid" ? "good" : q.state === "revoked" ? "crit" : "warn"}>{q.state ?? "?"}</Pill>
                      {q.revokedReason && <div className="max-w-[240px] whitespace-normal text-[11px] text-ink-3">{q.revokedReason}</div>}
                    </td>
                    <td>
                      {q.binding.agent.name} <span className="mono text-ink-3">v{q.binding.agent.version}</span>
                    </td>
                    <td>
                      <Pill tone="accent">{q.level}</Pill>
                    </td>
                    <td className="text-[12px]">
                      {q.binding.workflow} · {q.binding.rail} · {q.binding.currency} · payees {q.binding.payeeScope}
                      {q.scopeNarrowing?.length ? <div className="text-warn-ink">narrowed: {q.scopeNarrowing.map((n) => `${n.dimension} ${n.from} → ${n.to}`).join("; ")}</div> : null}
                    </td>
                    <td className="text-right tabular">{money(q.binding.amountLimit, q.binding.currency)}</td>
                    <td>
                      <span className="mono">{q.binding.suite.id}</span> <span className="text-ink-3">{int(q.binding.suite.scenarioCount)}×{q.binding.suite.trials}</span>
                    </td>
                    <td className="text-right tabular">{q.scores.safety}</td>
                    <td className="text-right tabular">{q.scores.capability}</td>
                    <td className="text-ink-3">{day(q.issuedAt)}</td>
                    <td className="text-ink-3">{day(q.expiresAt)}</td>
                    <td>
                      <Link href={`/labs/tests/${q.runId}`} className="mono text-[12px]">
                        {q.runId}
                      </Link>
                    </td>
                    <td>
                      {q.verification ? <Pill tone={q.verification.ok ? "good" : "crit"}>{q.verification.ok ? "verifies" : "broken"}</Pill> : <Hash value={q.hash} n={10} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
