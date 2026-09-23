import Link from "next/link";
import { compare } from "@/lib/api";
import { safe } from "@/lib/safe";
import { int, money, ms, when } from "@/lib/format";
import { ArmBars, ArmSwatch } from "@/components/charts";
import { Breadcrumb } from "@/components/shell";
import { Card, EmptyState, EnvBar, Note, Offline, PageHeader, Pill, Rate, StateBadge, toneForVerdict } from "@/components/ui";

export const metadata = { title: "Comparison" };

export default async function CompareDetail(props: PageProps<"/labs/arena/[id]">) {
  const { id } = await props.params;
  const rec = await safe(compare(id));
  if (!rec) return <Offline />;
  const best = rec.arms.find((a) => a.label === rec.recommendation.label);

  return (
    <>
      <Breadcrumb items={[{ href: "/labs/arena", label: "Model Arena" }, { label: rec.id }]} />
      <PageHeader
        eyebrow={`Comparison · ${when(rec.createdAt)}`}
        title={`${int(rec.arms.length)} configurations on ${int(rec.suite.scenarioCount)} scenarios`}
        subtitle={
          <>
            <span className="mono">{rec.suite.id}</span> {rec.suite.version} · {rec.suite.trials} trials each · took {ms(rec.durationMs)}
          </>
        }
        actions={rec.verification ? <Pill tone={rec.verification.ok ? "good" : "crit"}>{rec.verification.ok ? "signature verifies" : "signature broken"}</Pill> : undefined}
      />
      <EnvBar />

      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card padded={false} aside="critical violations are what the agent attempted; the simulated wrongful amount is what settled in the sandbox">
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap">
              <thead>
                <tr>
                  <th className="pl-5">configuration</th>
                  <th>gate</th>
                  <th className="text-right">safety</th>
                  <th className="text-right">capability</th>
                  <th className="text-right">critical (attempted)</th>
                  <th className="text-right">false blocks</th>
                  <th className="text-right">simulated wrongful</th>
                  <th className="text-right">avg episode</th>
                  <th className="text-right">est. cost</th>
                  <th className="pr-5">skipped gate</th>
                </tr>
              </thead>
              <tbody>
                {rec.arms.map((a, i) => (
                  <tr key={a.label} className={best?.label === a.label ? "bg-accent-soft/50" : ""}>
                    <td className="pl-5">
                      <ArmSwatch index={i} /> <span className="ml-1.5 font-medium">{a.label}</span>
                      <div className="text-[11.5px] text-ink-3">
                        {a.agent.name} v{a.agent.version}
                        {a.agent.subject.model ? ` · ${a.agent.subject.model}` : ""} · <Link href={`/labs/tests/${a.runId}`} className="mono">{a.runId}</Link>
                      </div>
                    </td>
                    <td>
                      <Pill tone={a.controls.mode === "enforced" ? "good" : a.controls.mode === "advisory" ? "warn" : "neutral"}>{a.controls.mode}</Pill>
                    </td>
                    <td className="text-right">
                      <Rate score={a.axes.safety.score} n={a.axes.safety.n} />
                    </td>
                    <td className="text-right">
                      <Rate score={a.axes.capability.score} n={a.axes.capability.n} />
                    </td>
                    <td className={`text-right tabular ${a.criticalViolations ? "text-crit-ink" : ""}`}>
                      {int(a.criticalViolations)} <span className="text-ink-3">in {int(a.episodes)}</span>
                    </td>
                    <td className="text-right tabular">{int(a.falseBlocks)}</td>
                    <td className="text-right tabular">{money(a.simulatedWrongfulAmount)}</td>
                    <td className="text-right tabular text-ink-2">{a.episodes ? ms(a.durationMs / a.episodes) : "–"}</td>
                    <td className="text-right text-ink-3">not measured</td>
                    <td className="pr-5 text-[12px]">
                      {a.skippedControlLabel}
                      {a.controls.mode === "advisory" && !a.measuresSkipBehaviour && <span className="ml-1 text-warn-ink">(measures nothing here)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card emphasis={best ? "accent" : undefined}>
          <div className="eyebrow">Recommended</div>
          <div className="mt-2">{best ? <StateBadge state="READY" label={best.label.toUpperCase()} size="lg" /> : <StateBadge state="NONE" label="NO CLEAN ARM" size="lg" />}</div>
          <p className="mt-3 text-[13px]">{rec.recommendation.reason}</p>
          <p className="mt-2 text-[11.5px] text-ink-3">rule: {rec.recommendation.rule}</p>
          {best && (
            <pre className="mono mt-3 rounded-[var(--radius-sm)] bg-sunken p-2.5 text-[11px] text-ink-2">{`# gate this configuration against the committed baseline
node src/bench/ci-gate.ts --scenarios scenarios --agent ${best.agent.endpoint === "in-process" ? best.label.split(":")[0].replace("reference-", "").replace("-tools", "") : best.agent.endpoint}`}</pre>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card title="Axes by configuration" aside="colour follows the row above">
          <ArmBars arms={rec.arms} />
          <ul className="mt-3 flex flex-wrap gap-3 text-[12px] text-ink-2">
            {rec.arms.map((a, i) => (
              <li key={a.label}>
                <ArmSwatch index={i} /> <span className="ml-1">{a.label}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Notes">
          <div className="grid gap-1.5">
            {rec.notes.map((n, i) => (
              <Note key={i}>{n}</Note>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Where the configurations differ" aside={`${int(rec.differences.length)} scenario(s)`} padded={false}>
          {rec.differences.length === 0 ? (
            <div className="p-5">
              <EmptyState title="Every configuration reached the same verdict on every scenario." />
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th className="pl-5">scenario</th>
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
                    <td className="mono pl-5">{d.scenarioId}</td>
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
