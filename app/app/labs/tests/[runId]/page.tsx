import Link from "next/link";
import { ApiError, episodes, gates, labRun, labRuns, profile, scenario as loadScenario, type EpisodeGrade } from "@/lib/api";
import { safe } from "@/lib/safe";
import { agentKey, counts, coverageConfidence, familyAxes, readiness, scenarioPassRate, trajectory } from "@/lib/derive";
import { LADDER, int, money, ms, ofN, pct, when } from "@/lib/format";
import { agentDisplay, agentRaw, suiteName } from "@/lib/names";
import { Radar } from "@/components/charts";
import { Breadcrumb } from "@/components/shell";
import { Card, Delta, EmptyState, EnvBar, Hash, KV, LinkButton, Metric, MetricRow, Note, Offline, PageHeader, Pill, StateBadge, Tabs, toneForSeverity, toneForVerdict } from "@/components/ui";

export const metadata = { title: "Test Run" };

// A financial-agent debugger. Overview says how it did and against what;
// Failures lists what went wrong, worst first; Scenarios is one row per
// scenario with a dot per trial; Trace lists every episode; Artifacts is the
// signature and how to verify it without us.

const TABS = ["overview", "failures", "scenarios", "trace", "artifacts"] as const;

export default async function RunDetail(props: PageProps<"/labs/tests/[runId]">) {
  const { runId } = await props.params;
  const search = await props.searchParams;
  const tab = (TABS as readonly string[]).includes(String(search.tab)) ? String(search.tab) : "overview";
  const [run, all, gt] = await Promise.all([safe(labRun(runId)), safe(labRuns()), safe(gates())]);
  if (!run || !all) return <Offline />;

  const grades = run.grades.filter((g) => !g.unusable);
  const pass = scenarioPassRate(grades);
    const mine = all.filter((r) => agentKey(r) === agentKey(run));
  const idx = mine.findIndex((r) => r.id === run.id);
  const previous = idx > 0 ? mine[idx - 1] : undefined;
  const gate = (gt ?? []).filter((g) => `${g.agent.name}@${g.agent.version}` === agentKey(run)).at(-1);
  const prof = await safe(profile(run.agent.name, run.agent.version));
  const axes = familyAxes(prof?.nodes ?? []);
  const coverage = coverageConfidence(axes);
  const c = counts(grades);
  const ready = readiness(run, gate, grades, axes);

  // Failures grouped per scenario, worst first, with the variant count.
  const byScenario = new Map<string, EpisodeGrade[]>();
  for (const g of grades) byScenario.set(g.scenarioId, [...(byScenario.get(g.scenarioId) ?? []), g]);
  const failureRows = [...byScenario]
    .map(([sid, gs]) => {
      const crit = gs.reduce((n, g) => n + g.criticalCount, 0);
      const failedTrials = gs.filter((g) => g.criticalCount > 0 || g.effective !== g.expected).length;
      const top = gs.flatMap((g) => g.violations).sort((a, b) => sev(b.severity) - sev(a.severity))[0];
      const exposure = gs.reduce((n, g) => n + (g.criticalCount > 0 ? (g.paidAmount ?? 0) : 0), 0);
      return { sid, gs, crit, failedTrials, top, exposure, worst: gs.find((g) => g.criticalCount > 0) ?? gs.find((g) => g.effective !== g.expected) ?? gs[0] };
    })
    .filter((r) => r.failedTrials > 0 || r.top)
    .sort((a, b) => b.crit - a.crit || sev(b.top?.severity ?? "") - sev(a.top?.severity ?? "") || b.failedTrials - a.failedTrials);

  const titles = new Map<string, string>();
  if (tab === "failures" || tab === "overview") {
    await Promise.all(
      failureRows.slice(0, 12).map(async (r) => {
        try {
          titles.set(r.sid, (await loadScenario(r.sid)).title);
        } catch (e) {
          if (!(e instanceof ApiError)) throw e;
        }
      }),
    );
  }

  const byCode = new Map<string, { severity: string; count: number; scenarios: Set<string> }>();
  for (const g of grades) for (const v of g.violations) {
    const e = byCode.get(v.code) ?? { severity: v.severity, count: 0, scenarios: new Set<string>() };
    e.count++;
    e.scenarios.add(g.scenarioId);
    byCode.set(v.code, e);
  }
  const codes = [...byCode].sort((a, b) => sev(b[1].severity) - sev(a[1].severity) || b[1].count - a[1].count);
  const rung = LADDER.indexOf(run.axes.level);
  const base = `/labs/tests/${run.id}`;

  return (
    <>
      <Breadcrumb items={[{ href: "/labs/tests", label: "Test Runs" }, { label: run.id }]} />
      <PageHeader
        eyebrow={`Test run · ${when(run.createdAt)}`}
        title={
          <>
            {agentDisplay(run.agent.name)} <span className="mono text-[14px] font-normal text-ink-3">{agentRaw(run.agent.name, run.agent.version)}</span>
          </>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-[20px] font-semibold text-ink">{pct(pass.passed, pass.of)} <span className="text-[12px] font-normal text-ink-3">pass</span></span>
            <span>{int(run.suite.scenarioCount)} scenarios × {run.suite.trials} trials</span>
            <span className={c.criticalEpisodes ? "text-crit-ink" : ""}>{int(c.criticalEpisodes)} episode(s) with critical failure</span>
            <span className="text-ink-3">{int(c.criticalCheckFailures)} critical check failure(s)</span>
            <span>{int(c.failingEpisodes)} failing episode(s) of {int(c.episodes)}</span>
            <span className="text-ink-3" title={run.suite.id}>{suiteName(run.suite.id).name}</span>
          </span>
        }
        actions={
          <>
            <StateBadge state={ready.state} />
            {run.verification && <Pill tone={run.verification.ok ? "good" : "crit"}>{run.verification.ok ? "signature verifies" : "signature broken"}</Pill>}
          </>
        }
      />
      <EnvBar />
      <Tabs
        base={base}
        active={tab}
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "failures", label: "Failures", count: failureRows.length },
          { key: "scenarios", label: "Scenarios", count: byScenario.size },
          { key: "trace", label: "Trace", count: grades.length },
          { key: "artifacts", label: "Artifacts" },
        ]}
      />

      {tab === "overview" && (
        <div className="grid gap-4">
          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            <Card title="Readiness">
              <ol className="mb-4 flex flex-wrap gap-1.5">
                {LADDER.map((l, i) => (
                  <li key={l} className={`rounded-full border px-2.5 py-[3px] text-[12px] ${i === rung ? "border-accent bg-accent-soft text-accent-ink" : i < rung ? "border-line text-ink-2" : "border-line text-ink-3"}`}>
                    {l}
                  </li>
                ))}
              </ol>
              <MetricRow label="Safety" hint={run.axes.safety.detail} score={run.axes.safety.score} n={run.axes.safety.sampleSize} />
              <MetricRow label="Capability" hint={run.axes.capability.detail} score={run.axes.capability.score} n={run.axes.capability.sampleSize} />
              <MetricRow label="Recovery" hint={run.axes.recovery.detail} score={run.axes.recovery.score} n={run.axes.recovery.sampleSize} />
              <MetricRow label="Reliability" hint={run.axes.reliability?.detail} score={run.axes.reliability?.score ?? null} n={run.axes.reliability?.sampleSize ?? 0} />
              <p className="mt-3 text-[12.5px] text-ink-3">{run.axes.levelReason}</p>
              {run.axes.unusableEpisodes > 0 && <p className="mt-2 text-[12px] text-warn-ink">{int(run.axes.unusableEpisodes)} episode(s) were unusable: the subject never answered. They are in no denominator.</p>}
              <div className="mt-4 border-t border-line pt-3">
                <ul className="grid gap-1 text-[12.5px]">
                  {ready.absolute?.criteria.map((x) => (
                    <li key={x.label} className="grid grid-cols-[max-content_1fr] items-start gap-2">
                      <Pill tone={x.ok ? "good" : "crit"}>{x.ok ? "ok" : "fail"}</Pill>
                      <span>
                        {x.label} <span className="text-ink-3">· {x.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-ink-3">Absolute qualification, evaluated on this run alone. The regression gate is on Release Gates.</p>
              </div>
            </Card>
            <Card title="Against the previous run" aside={previous ? when(previous.createdAt) : "none"}>
              {previous ? (
                <div className="grid grid-cols-2 gap-4">
                  {(["safety", "capability", "recovery"] as const).map((k) => (
                    <Metric key={k} label={k} value={<Delta value={run.axes[k].score - previous.axes[k].score} />} sub={`${previous.axes[k].score} → ${run.axes[k].score}, n=${int(run.axes[k].sampleSize)}`} />
                  ))}
                  <Metric label="critical violations" value={<Delta value={run.axes.criticalViolations.length - previous.axes.criticalViolations.length} upIsGood={false} />} sub={`${int(previous.axes.criticalViolations.length)} → ${int(run.axes.criticalViolations.length)}`} />
                </div>
              ) : (
                <p className="text-[13px] text-ink-3">First run of this agent version, so nothing to compare against yet.</p>
              )}
              <div className="mt-4 border-t border-line pt-3">
                <KV
                  dense
                  rows={[
                    ["gate", <Pill key="g" tone={run.controls.mode === "enforced" ? "good" : run.controls.mode === "advisory" ? "warn" : "neutral"}>{run.controls.mode}</Pill>],
                    ["simulated wrongful", money(run.controls.simulatedWrongfulAmount)],
                    ["false blocks", ofN(run.controls.falseBlocks, run.controls.episodes)],
                    ["skipped the gate", run.controls.mode === "enforced" ? "Not possible — enforced at the rail" : run.controls.mode === "off" ? "No gate in this arm" : ofN(run.controls.skippedControl ?? 0, run.controls.episodes)],
                    ["subject", run.agent.subject.model ? `${run.agent.subject.model} (${run.agent.subject.source})` : `unknown (${run.agent.subject.source})`],
                  ]}
                />
              </div>
            </Card>
          </div>

          <Card title="Coverage by failure family" aside={`safety ${run.axes.safety.score} (n=${int(run.axes.safety.sampleSize)}) · coverage confidence ${coverage.pct}% · ${ofN(coverage.measured, coverage.of)} families with sufficient evidence`}>
            <Radar axes={axes} size={220} />
          </Card>
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <Card title="Check failures by code" aside={`${int(c.checkFailures)} check failure(s) across ${int(c.failingEpisodes)} failing episode(s) of ${int(c.episodes)}`} padded={false}>
              {codes.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="No check failure in any episode." />
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="pl-5">code</th>
                      <th>severity</th>
                      <th className="text-right">count</th>
                      <th className="pr-5">scenarios</th>
                    </tr>
                  </thead>
                  <tbody>
                    {codes.map(([code, e]) => (
                      <tr key={code}>
                        <td className="mono pl-5">{code}</td>
                        <td>
                          <Pill tone={toneForSeverity(e.severity)}>{e.severity}</Pill>
                        </td>
                        <td className="text-right tabular">{int(e.count)}</td>
                        <td className="pr-5 text-[12px] text-ink-3">{int(e.scenarios.size)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card title="Critical failures" aside={`${int(failureRows.filter((r) => r.crit > 0).length)} scenario(s) · ${int(c.criticalEpisodes)} episode(s)`}>
              {failureRows.filter((r) => r.crit > 0).length === 0 ? (
                <p className="text-[13px] text-ink-3">None. See Failures for non-critical findings.</p>
              ) : (
                <ul className="grid gap-2">
                  {failureRows
                    .filter((r) => r.crit > 0)
                    .slice(0, 5)
                    .map((r) => (
                      <li key={r.sid} className="rounded-[var(--radius-sm)] border border-crit/30 bg-crit-soft/40 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <Link href={`${base}/scenarios/${r.sid}?trial=${r.worst.trial}`} className="text-[13px] font-medium">
                            {titles.get(r.sid) ?? r.sid}
                          </Link>
                          <span className="text-[12px] tabular text-ink-3">{ofN(r.failedTrials, r.gs.length)} trials failed</span>
                        </div>
                        <div className="mt-0.5 text-[12px] text-ink-2">{r.top?.detail}</div>
                        {r.exposure > 0 && <div className="mt-0.5 text-[12px] text-crit-ink">{money(r.exposure)} simulated exposure</div>}
                      </li>
                    ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === "failures" &&
        (failureRows.length === 0 ? (
          <EmptyState title="Nothing failed." body="Every trial reached the expected action with no finding." />
        ) : (
          <div className="grid gap-3">
            {failureRows.map((r) => (
              <Card key={r.sid} emphasis={r.crit > 0 ? "crit" : undefined}>
                <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                  <div>
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${r.crit > 0 ? "text-crit-ink" : r.top?.severity === "high" ? "text-warn-ink" : "text-ink-3"}`}>{r.crit > 0 ? "critical" : r.top?.severity ?? "failed"}</span>
                      <span className="mono text-[12px] text-ink-3">{r.sid}</span>
                      <Pill tone={toneForVerdict(r.gs[0].expected)}>expected {r.gs[0].expected}</Pill>
                    </div>
                    <div className="text-[16px] font-semibold">{titles.get(r.sid) ?? r.sid}</div>
                    <p className="mt-1 text-[13px] text-ink-2">{r.top?.detail ?? `Did ${r.worst.effective}.`}</p>
                    <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-ink-3">
                      <span className="tabular">{ofN(r.failedTrials, r.gs.length)} trials failed</span>
                      {r.exposure > 0 && <span className="text-crit-ink">{money(r.exposure)} simulated exposure</span>}
                      <span>{[...new Set(r.gs.flatMap((g) => g.violations.map((v) => v.code)))].join(", ")}</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <LinkButton href={`${base}/scenarios/${r.sid}?trial=${r.worst.trial}`} tone={r.crit > 0 ? "crit" : "neutral"}>
                      Replay
                    </LinkButton>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ))}

      {tab === "scenarios" && (
        <Card padded={false}>
          <table className="w-full">
            <thead>
              <tr>
                <th className="pl-5">scenario</th>
                <th>expected</th>
                <th>trials</th>
                <th className="text-right">critical</th>
                <th className="pr-5 text-right">simulated payment total</th>
              </tr>
            </thead>
            <tbody>
              {[...byScenario].map(([sid, gs]) => {
                const worst = gs.find((g) => g.criticalCount > 0) ?? gs.find((g) => g.effective !== g.expected) ?? gs[0];
                const crit = gs.reduce((n, g) => n + g.criticalCount, 0);
                return (
                  <tr key={sid} className="row-link">
                    <td className="pl-5">
                      <Link href={`${base}/scenarios/${sid}?trial=${worst.trial}`} className="mono">
                        {sid}
                      </Link>
                    </td>
                    <td>
                      <Pill tone={toneForVerdict(gs[0].expected)}>{gs[0].expected}</Pill>
                    </td>
                    <td>
                      <span className="inline-flex gap-1.5">
                        {gs.map((g) => (
                          <Link
                            key={g.episodeId}
                            href={`${base}/scenarios/${sid}?trial=${g.trial}`}
                            title={`trial ${g.trial}: ${g.effective}${g.criticalCount ? `, ${g.criticalCount} critical` : ""}`}
                            aria-label={`trial ${g.trial}: ${g.effective}`}
                            className={`inline-block h-[11px] w-[11px] rounded-full ring-2 ring-surface ${g.criticalCount > 0 ? "bg-crit" : g.effective === g.expected ? "bg-good" : "bg-warn"}`}
                          />
                        ))}
                      </span>
                    </td>
                    <td className={`text-right tabular ${crit ? "text-crit-ink" : ""}`}>{int(crit)}</td>
                    <td className="pr-5 text-right tabular">{money(gs.reduce((n, g) => n + (g.paidAmount ?? 0), 0))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "trace" && <TraceTab runId={run.id} grades={grades} />}

      {tab === "artifacts" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Signature">
            <KV
              rows={[
                ["record", <Hash key="h" value={run.hash} n={32} />],
                ["previous", run.prevHash ? <Hash key="p" value={run.prevHash} n={32} /> : "first record"],
                ["signature", <Hash key="s" value={run.signature} n={32} />],
                ["tool config", <Hash key="t" value={run.agent.toolConfigHash} n={24} />],
                ...(run.agent.promptHash ? ([["prompt", <Hash key="pr" value={run.agent.promptHash} n={24} />]] as [string, React.ReactNode][]) : []),
                ["suite", `${run.suite.id} ${run.suite.version}`],
                ["pool", run.pool + (run.cohort ? ` · ${run.cohort}` : "")],
                ["took", ms(run.durationMs)],
              ]}
            />
          </Card>
          <Card title="Take it with you">
            <p className="text-[13px] text-ink-2">The run, its grades and every trace are yours to export. The record stays verifiable against the public key inside it, so nobody has to call us.</p>
            <pre className="mono mt-3 rounded-[var(--radius-sm)] bg-sunken p-3 text-[11.5px] leading-relaxed text-ink-2">{`curl localhost:8787/v1/lab/runs/${run.id}
node src/lab-cli.ts trace ${run.id} <scenarioId>
node src/bench/failure-bundle.ts ${run.id}     # a runnable scenario per failure`}</pre>
            <Note>A failure bundle turns every failure in this run into a scenario file you can drop into your own suite, so the regression stays caught.</Note>
          </Card>
        </div>
      )}
    </>
  );
}

async function TraceTab({ runId, grades }: { runId: string; grades: EpisodeGrade[] }) {
  const traces = await safe(episodes(runId));
  const byId = new Map((traces ?? []).map((t) => [t.episodeId, t]));
  return (
    <Card padded={false} aside={traces && traces.length < grades.length ? `showing the ${int(traces.length)} most recent episodes` : undefined}>
      <table className="w-full">
        <thead>
          <tr>
            <th className="pl-5">scenario</th>
            <th>trial</th>
            <th>did</th>
            <th>trajectory</th>
            <th className="pr-5 text-right">calls</th>
          </tr>
        </thead>
        <tbody>
          {grades.map((g) => {
            const t = byId.get(g.episodeId);
            return (
              <tr key={g.episodeId} className="row-link">
                <td className="pl-5">
                  <Link href={`/labs/tests/${runId}/scenarios/${g.scenarioId}?trial=${g.trial}`} className="mono">
                    {g.scenarioId}
                  </Link>
                </td>
                <td className="tabular">{g.trial}</td>
                <td>
                  <Pill tone={g.criticalCount > 0 ? "crit" : g.effective === g.expected ? "good" : "warn"}>{g.effective}</Pill>
                </td>
                <td className="text-[12px]">
                  {t ? (
                    <span className="flex flex-wrap gap-x-2">
                      {trajectory(t, g.violations).map((s, i) => (
                        <span key={i} className={s.status === "fail" ? "text-crit-ink" : s.status === "warn" ? "text-warn-ink" : "text-ink-3"}>
                          {s.label}
                          {i < t.calls.length - 1 ? " →" : ""}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-ink-3">not loaded</span>
                  )}
                </td>
                <td className="pr-5 text-right tabular text-ink-3">{int(g.toolCalls)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

const sev = (s: string) => (s === "critical" ? 3 : s === "high" ? 2 : s === "medium" ? 1 : 0);
