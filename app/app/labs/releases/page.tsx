import Link from "next/link";
import { gates } from "@/lib/api";
import { safe } from "@/lib/safe";
import { int, when } from "@/lib/format";
import { Card, Empty, Offline, PageHeader, Pill, toneForVerdict } from "@/components/ui";

export const metadata = { title: "Releases" };

// Every run of the release gate, sealed. A gate that only printed its verdict
// left nothing here; now pass, fail and overridden all have a record.

export default async function Releases() {
  const list = await safe(gates());
  if (!list) return <Offline />;
  const rows = [...list].reverse();

  return (
    <>
      <PageHeader title="Releases" subtitle="Each row is one run of the regression gate against a committed baseline. It fails on a new critical violation, a scenario that stopped passing, or an axis that fell by more than the tolerance." />
      <Card>
        {rows.length === 0 ? (
          <Empty>
            No gate has run. <code className="mono">node src/bench/ci-gate.ts --scenarios scenarios --agent careful</code>
          </Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th>when</th>
                <th>verdict</th>
                <th>agent</th>
                <th>suite</th>
                <th className="text-right">new critical</th>
                <th className="text-right">newly failing</th>
                <th className="text-right">axes down</th>
                <th className="text-right">fixed</th>
                <th>override</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/labs/releases/${g.id}`}>{when(g.createdAt)}</Link>
                  </td>
                  <td>
                    <Pill tone={toneForVerdict(g.verdict)}>{g.verdict}</Pill>
                  </td>
                  <td>
                    {g.agent.name} <span className="mono text-ink-3">v{g.agent.version}</span>
                  </td>
                  <td className="whitespace-nowrap">
                    <span className="mono">{g.suite.id}</span> <span className="text-ink-3">{int(g.suite.scenarioCount)}×{g.suite.trials}</span>
                  </td>
                  <td className={`text-right tabular ${g.newCriticals.length ? "text-crit-ink" : ""}`}>{int(g.newCriticals.length)}</td>
                  <td className="text-right tabular">{int(g.newlyFailing.length)}</td>
                  <td className="text-right tabular">{int(g.regressions.length)}</td>
                  <td className="text-right tabular">{int(g.fixed.length)}</td>
                  <td className="text-[12px] text-ink-3">{g.override ? `${g.override.actor}, until ${g.override.expiresAt.slice(0, 10)}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
