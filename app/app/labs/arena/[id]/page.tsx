import Link from "next/link";
import { compare } from "@/lib/api";
import { safe } from "@/lib/safe";
import { int, money, ms, when } from "@/lib/format";
import { ArmBars, ArmSwatch } from "@/components/charts";
import { Breadcrumb } from "@/components/shell";
import { Card, Empty, Note, Offline, PageHeader, Pill, SandboxBar, toneForVerdict } from "@/components/ui";

export const metadata = { title: "Comparison" };

export default async function CompareDetail(props: PageProps<"/labs/arena/[id]">) {
  const { id } = await props.params;
  const rec = await safe(compare(id));
  if (!rec) return <Offline />;

  return (
    <>
      <Breadcrumb items={[{ href: "/labs/arena", label: "Compare" }, { label: rec.id }]} />
      <PageHeader
        title="Comparison"
        subtitle={`${rec.suite.id} ${rec.suite.version} · ${int(rec.suite.scenarioCount)} scenarios × ${rec.suite.trials} trials · ${when(rec.createdAt)} · took ${ms(rec.durationMs)}`}
        actions={rec.verification ? <Pill tone={rec.verification.ok ? "good" : "crit"}>{rec.verification.ok ? "signature verifies" : "signature broken"}</Pill> : undefined}
      />
      <SandboxBar />

      <Card title="Arms" aside="critical violations are what the agent attempted; the simulated wrongful amount is what settled in the sandbox">
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap">
            <thead>
              <tr>
                <th>arm</th>
                <th>agent</th>
                <th>gate</th>
                <th className="text-right">critical (attempted)</th>
                <th className="text-right">false blocks</th>
                <th className="text-right">simulated wrongful</th>
                <th className="text-right">safety</th>
                <th className="text-right">capability</th>
                <th className="text-right">recovery</th>
                <th>skipped the gate</th>
                <th>run</th>
              </tr>
            </thead>
            <tbody>
              {rec.arms.map((a, i) => (
                <tr key={a.label}>
                  <td>
                    <ArmSwatch index={i} /> <span className="ml-1.5 font-medium">{a.label}</span>
                  </td>
                  <td>
                    {a.agent.name} <span className="mono text-ink-3">v{a.agent.version}</span>
                  </td>
                  <td>
                    <Pill tone={a.controls.mode === "enforced" ? "good" : a.controls.mode === "advisory" ? "warn" : "neutral"}>{a.controls.mode}</Pill>
                  </td>
                  <td className={`text-right tabular ${a.criticalViolations ? "text-crit-ink" : ""}`}>
                    {int(a.criticalViolations)} <span className="text-ink-3">in {int(a.episodes)}</span>
                  </td>
                  <td className="text-right tabular">{int(a.falseBlocks)}</td>
                  <td className="text-right tabular">{money(a.simulatedWrongfulAmount)}</td>
                  <td className="text-right tabular">
                    {a.axes.safety.score} <span className="text-ink-3">n={int(a.axes.safety.n)}</span>
                  </td>
                  <td className="text-right tabular">
                    {a.axes.capability.n ? (
                      <>
                        {a.axes.capability.score} <span className="text-ink-3">n={int(a.axes.capability.n)}</span>
                      </>
                    ) : (
                      <span className="text-ink-3">–</span>
                    )}
                  </td>
                  <td className="text-right tabular">
                    {a.axes.recovery.n ? (
                      <>
                        {a.axes.recovery.score} <span className="text-ink-3">n={int(a.axes.recovery.n)}</span>
                      </>
                    ) : (
                      <span className="text-ink-3">–</span>
                    )}
                  </td>
                  <td className="text-[12px]">
                    {a.skippedControlLabel}
                    {a.controls.mode === "advisory" && !a.measuresSkipBehaviour && <span className="ml-1 text-warn-ink">(measures nothing here)</span>}
                  </td>
                  <td>
                    <Link href={`/labs/tests/${a.runId}`} className="mono text-[12px]">
                      {a.runId}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card title="Axes by arm" aside="colour follows the arm, top to bottom in the table above">
          <ArmBars arms={rec.arms} />
          <ul className="mt-3 flex flex-wrap gap-3 text-[12px] text-ink-2">
            {rec.arms.map((a, i) => (
              <li key={a.label}>
                <ArmSwatch index={i} /> <span className="ml-1">{a.label}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Recommendation">
          <div className="mb-2">{rec.recommendation.label ? <Pill tone="accent">{rec.recommendation.label}</Pill> : <Pill tone="warn">none</Pill>}</div>
          <p className="text-[13px]">{rec.recommendation.reason}</p>
          <p className="mt-2 text-[11px] text-ink-3">rule: {rec.recommendation.rule}</p>
          <div className="mt-3 grid gap-1.5">
            {rec.notes.map((n, i) => (
              <Note key={i}>{n}</Note>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Where the arms differ" aside={`${int(rec.differences.length)} scenario(s)`}>
          {rec.differences.length === 0 ? (
            <Empty>Every arm reached the same verdict on every scenario.</Empty>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th>scenario</th>
                  <th>expected</th>
                  <th>severity</th>
                  {rec.arms.map((a, i) => (
                    <th key={a.label}>
                      <ArmSwatch index={i} /> <span className="ml-1">{a.label}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rec.differences.map((d) => (
                  <tr key={d.scenarioId}>
                    <td className="mono">{d.scenarioId}</td>
                    <td>
                      <Pill tone={toneForVerdict(d.expected)}>{d.expected}</Pill>
                    </td>
                    <td>
                      <Pill tone={d.severity === "critical" ? "crit" : d.severity === "high" ? "warn" : "neutral"}>{d.severity}</Pill>
                    </td>
                    {rec.arms.map((a) => (
                      <td key={a.label}>
                        <Link href={`/labs/tests/${a.runId}/scenarios/${d.scenarioId}`}>
                          <Pill tone={toneForVerdict(d.byArm[a.label])}>{d.byArm[a.label]}</Pill>
                        </Link>
                      </td>
                    ))}
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
