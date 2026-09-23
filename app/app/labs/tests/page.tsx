import Link from "next/link";
import { labRuns } from "@/lib/api";
import { safe } from "@/lib/safe";
import { int, money, ms, when } from "@/lib/format";
import { Card, Empty, Offline, PageHeader, Pill, SandboxBar } from "@/components/ui";

export const metadata = { title: "Test runs" };

export default async function TestRuns() {
  const runs = await safe(labRuns());
  if (!runs) return <Offline />;
  const rows = [...runs].reverse();

  return (
    <>
      <PageHeader title="Test runs" subtitle="Every Lab run on record, newest first. Each row is a signed record; open one for its grades and traces." />
      <SandboxBar />
      <Card>
        {rows.length === 0 ? (
          <Empty>
            No runs yet. <code className="mono">node src/lab-cli.ts run careful 3</code>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap">
              <thead>
                <tr>
                  <th>when</th>
                  <th>agent</th>
                  <th>suite</th>
                  <th>gate</th>
                  <th>level</th>
                  <th className="text-right">safety</th>
                  <th className="text-right">capability</th>
                  <th className="text-right">recovery</th>
                  <th className="text-right">reliability</th>
                  <th className="text-right">critical</th>
                  <th className="text-right">simulated wrongful</th>
                  <th className="text-right">took</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const crit = r.axes.criticalViolations.length;
                  const cell = (d: { score: number; sampleSize: number } | null) =>
                    d && d.sampleSize > 0 ? (
                      <>
                        {d.score} <span className="text-ink-3">n={int(d.sampleSize)}</span>
                      </>
                    ) : (
                      <span className="text-ink-3">–</span>
                    );
                  return (
                    <tr key={r.id}>
                      <td className="text-ink-3">
                        <Link href={`/labs/tests/${r.id}`} className="text-ink">
                          {when(r.createdAt)}
                        </Link>
                      </td>
                      <td>
                        {r.agent.name} <span className="mono text-ink-3">v{r.agent.version}</span>
                        {r.agent.subject.source !== "unknown" && r.agent.subject.model && <span className="ml-1 text-[11px] text-ink-3">· {r.agent.subject.model}</span>}
                      </td>
                      <td>
                        <span className="mono">{r.suite.id}</span> <span className="text-ink-3">{int(r.suite.scenarioCount)}×{r.suite.trials}</span>
                        {r.pool === "held-out" && <Pill tone="accent">held-out</Pill>}
                      </td>
                      <td>
                        <Pill tone={r.controls.mode === "enforced" ? "good" : r.controls.mode === "advisory" ? "warn" : "neutral"}>{r.controls.mode}</Pill>
                      </td>
                      <td>
                        <Pill tone="accent">{r.axes.level}</Pill>
                      </td>
                      <td className="text-right tabular">{cell(r.axes.safety)}</td>
                      <td className="text-right tabular">{cell(r.axes.capability)}</td>
                      <td className="text-right tabular">{cell(r.axes.recovery)}</td>
                      <td className="text-right tabular">{cell(r.axes.reliability)}</td>
                      <td className={`text-right tabular ${crit ? "text-crit-ink" : ""}`}>{int(crit)}</td>
                      <td className="text-right tabular">{money(r.controls.simulatedWrongfulAmount)}</td>
                      <td className="text-right tabular text-ink-3">{ms(r.durationMs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
