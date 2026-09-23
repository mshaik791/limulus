import Link from "next/link";
import { labRuns } from "@/lib/api";
import { safe } from "@/lib/safe";
import { int, money, ms, when } from "@/lib/format";
import { Card, EmptyState, EnvBar, Offline, PageHeader, Pill, Rate } from "@/components/ui";

export const metadata = { title: "Test Runs" };

export default async function TestRuns() {
  const runs = await safe(labRuns());
  if (!runs) return <Offline />;
  const rows = [...runs].reverse();

  return (
    <>
      <PageHeader title="Test Runs" subtitle="Every Lab run on record, newest first. Each row is a signed record." />
      <EnvBar />
      {rows.length === 0 ? (
        <EmptyState title="No test runs yet." body="Connect an agent and run your first suite." cta="Run First Test" ctaHref="/labs" />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap">
              <thead>
                <tr>
                  <th className="pl-5">when</th>
                  <th>agent</th>
                  <th>suite</th>
                  <th>gate</th>
                  <th>rung</th>
                  <th className="text-right">safety</th>
                  <th className="text-right">capability</th>
                  <th className="text-right">recovery</th>
                  <th className="text-right">reliability</th>
                  <th className="text-right">critical</th>
                  <th className="text-right">simulated wrongful</th>
                  <th className="pr-5 text-right">took</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const crit = r.axes.criticalViolations.length;
                  return (
                    <tr key={r.id} className="row-link">
                      <td className="pl-5">
                        <Link href={`/labs/tests/${r.id}`}>{when(r.createdAt)}</Link>
                      </td>
                      <td>
                        {r.agent.name} <span className="mono text-ink-3">v{r.agent.version}</span>
                      </td>
                      <td>
                        <span className="mono">{r.suite.id}</span> <span className="text-ink-3">{int(r.suite.scenarioCount)}×{r.suite.trials}</span>
                        {r.pool === "held-out" && <Pill tone="accent">held-out</Pill>}
                      </td>
                      <td>
                        <Pill tone={r.controls.mode === "enforced" ? "good" : r.controls.mode === "advisory" ? "warn" : "neutral"}>{r.controls.mode}</Pill>
                      </td>
                      <td className="text-[12px] text-ink-2">{r.axes.level}</td>
                      <td className="text-right">
                        <Rate score={r.axes.safety.score} n={r.axes.safety.sampleSize} />
                      </td>
                      <td className="text-right">
                        <Rate score={r.axes.capability.score} n={r.axes.capability.sampleSize} />
                      </td>
                      <td className="text-right">
                        <Rate score={r.axes.recovery.score} n={r.axes.recovery.sampleSize} />
                      </td>
                      <td className="text-right">
                        <Rate score={r.axes.reliability?.score ?? null} n={r.axes.reliability?.sampleSize ?? 0} />
                      </td>
                      <td className={`text-right tabular ${crit ? "text-crit-ink" : ""}`}>{int(crit)}</td>
                      <td className="text-right tabular">{money(r.controls.simulatedWrongfulAmount)}</td>
                      <td className="pr-5 text-right tabular text-ink-3">{ms(r.durationMs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
