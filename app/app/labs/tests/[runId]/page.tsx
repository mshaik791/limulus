import Link from "next/link";
import { labRun, type EpisodeGrade } from "@/lib/api";
import { safe } from "@/lib/safe";
import { LADDER, int, money, ms, when } from "@/lib/format";
import { AxesBars } from "@/components/charts";
import { Breadcrumb } from "@/components/shell";
import { Card, Empty, Hash, KV, Offline, PageHeader, Pill, SandboxBar, toneForVerdict } from "@/components/ui";

export const metadata = { title: "Run" };

// One run. The ladder with the earned rung, the four axes with their n,
// critical violations grouped by code, then one cell per scenario with one dot
// per trial. The grid opens the trial that went wrong, not trial 1.

export default async function RunDetail(props: PageProps<"/labs/tests/[runId]">) {
  const { runId } = await props.params;
  const run = await safe(labRun(runId));
  if (!run) return <Offline />;

  const grades = run.grades.filter((g) => !g.unusable);
  const byScenario = new Map<string, EpisodeGrade[]>();
  for (const g of grades) byScenario.set(g.scenarioId, [...(byScenario.get(g.scenarioId) ?? []), g]);

  const byCode = new Map<string, { severity: string; count: number; scenarios: Set<string> }>();
  for (const g of grades) {
    for (const v of g.violations) {
      const e = byCode.get(v.code) ?? { severity: v.severity, count: 0, scenarios: new Set<string>() };
      e.count++;
      e.scenarios.add(g.scenarioId);
      byCode.set(v.code, e);
    }
  }
  const codes = [...byCode].sort((a, b) => sev(b[1].severity) - sev(a[1].severity) || b[1].count - a[1].count);

  const rung = LADDER.indexOf(run.axes.level);
  const skipped = run.controls.mode === "enforced" ? "Not possible — enforced at the rail" : run.controls.mode === "off" ? "No gate in this arm" : `${int(run.controls.skippedControl ?? 0)} of ${int(run.controls.episodes)}`;

  return (
    <>
      <Breadcrumb items={[{ href: "/labs/tests", label: "Test runs" }, { label: run.id }]} />
      <PageHeader
        title={
          <>
            {run.agent.name} <span className="mono text-[16px] text-ink-3">v{run.agent.version}</span>
          </>
        }
        subtitle={`${run.suite.id} · ${int(run.suite.scenarioCount)} scenarios × ${run.suite.trials} trials · ${when(run.createdAt)} · took ${ms(run.durationMs)}`}
        actions={
          run.verification ? (
            <Pill tone={run.verification.ok ? "good" : "crit"}>{run.verification.ok ? "signature verifies" : "signature broken"}</Pill>
          ) : undefined
        }
      />
      <SandboxBar />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card title="Readiness">
          <ol className="mb-4 flex flex-wrap gap-1.5">
            {LADDER.map((l, i) => (
              <li key={l} className={`rounded-full border px-2.5 py-[3px] text-[12px] ${i === rung ? "border-accent bg-accent-soft text-accent-ink" : i < rung ? "border-line text-ink-2" : "border-line text-ink-3"}`}>
                {l}
              </li>
            ))}
          </ol>
          <AxesBars axes={run.axes} />
          <p className="mt-3 text-[12px] text-ink-3">{run.axes.levelReason}</p>
          {run.axes.unusableEpisodes > 0 && (
            <p className="mt-2 text-[12px] text-warn-ink">
              {int(run.axes.unusableEpisodes)} episode(s) were unusable: the subject never answered. They are in no denominator above.
            </p>
          )}
        </Card>

        <Card title="How controls were wired">
          <KV
            rows={[
              ["mode", <Pill key="m" tone={run.controls.mode === "enforced" ? "good" : run.controls.mode === "advisory" ? "warn" : "neutral"}>{run.controls.mode}</Pill>],
              ["", <span key="d" className="text-ink-3">{run.controls.description}</span>],
              ["simulated wrongful amount", money(run.controls.simulatedWrongfulAmount)],
              ["false blocks", `${int(run.controls.falseBlocks)} of ${int(run.controls.episodes)} episodes`],
              ["skipped the gate", skipped],
              ["subject", run.agent.subject.model ? `${run.agent.subject.model}${run.agent.subject.modelVersion ? ` @ ${run.agent.subject.modelVersion}` : ""} (${run.agent.subject.source})` : `unknown (${run.agent.subject.source})`],
              ["tool config", <Hash key="t" value={run.agent.toolConfigHash} />],
              ...(run.agent.promptHash ? ([["prompt", <Hash key="p" value={run.agent.promptHash} />]] as [string, React.ReactNode][]) : []),
              ["record", <Hash key="h" value={run.hash} />],
            ]}
          />
          {run.agent.subject.inconsistent?.length ? (
            <p className="mt-3 text-[12px] text-warn-ink">Subject identity was inconsistent across episodes: {run.agent.subject.inconsistent.join("; ")}</p>
          ) : null}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card title="Violations by code" aside={`${int(grades.reduce((n, g) => n + g.violations.length, 0))} findings in ${int(grades.length)} episodes`}>
          {codes.length === 0 ? (
            <Empty>No violations in any episode.</Empty>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th>code</th>
                  <th>severity</th>
                  <th className="text-right">count</th>
                  <th>scenarios</th>
                </tr>
              </thead>
              <tbody>
                {codes.map(([code, e]) => (
                  <tr key={code}>
                    <td className="mono">{code}</td>
                    <td>
                      <Pill tone={e.severity === "critical" ? "crit" : e.severity === "high" ? "warn" : "neutral"}>{e.severity}</Pill>
                    </td>
                    <td className="text-right tabular">{int(e.count)}</td>
                    <td className="text-[12px] text-ink-3">
                      {[...e.scenarios].slice(0, 4).map((s) => (
                        <Link key={s} href={`/labs/tests/${run.id}/scenarios/${s}`} className="mr-2 mono">
                          {s}
                        </Link>
                      ))}
                      {e.scenarios.size > 4 && `+${e.scenarios.size - 4}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Scenarios" aside="one row per scenario, one dot per trial; opens the trial that went wrong">
          <table className="w-full">
            <thead>
              <tr>
                <th>scenario</th>
                <th>expected</th>
                <th>trials</th>
                <th className="text-right">critical</th>
              </tr>
            </thead>
            <tbody>
              {[...byScenario].map(([sid, gs]) => {
                const worst = gs.find((g) => g.criticalCount > 0) ?? gs.find((g) => g.effective !== g.expected) ?? gs[0];
                const crit = gs.reduce((n, g) => n + g.criticalCount, 0);
                return (
                  <tr key={sid}>
                    <td>
                      <Link href={`/labs/tests/${run.id}/scenarios/${sid}`} className="mono">
                        {sid}
                      </Link>
                    </td>
                    <td>
                      <Pill tone={toneForVerdict(gs[0].expected)}>{gs[0].expected}</Pill>
                    </td>
                    <td>
                      <span className="inline-flex gap-1">
                        {gs.map((g) => (
                          <Link
                            key={g.episodeId}
                            href={`/labs/tests/${run.id}/scenarios/${sid}?trial=${g.trial}`}
                            title={`trial ${g.trial}: ${g.effective}${g.criticalCount ? `, ${g.criticalCount} critical` : ""}`}
                            aria-label={`trial ${g.trial}: ${g.effective}`}
                            className={`inline-block h-[10px] w-[10px] rounded-full ring-2 ring-surface ${g.criticalCount > 0 ? "bg-crit" : g.effective === g.expected ? "bg-good" : "bg-warn"} ${g === worst ? "outline outline-1 outline-line-strong" : ""}`}
                          />
                        ))}
                      </span>
                    </td>
                    <td className={`text-right tabular ${crit ? "text-crit-ink" : ""}`}>{int(crit)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}

const sev = (s: string) => (s === "critical" ? 3 : s === "high" ? 2 : 1);
