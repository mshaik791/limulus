import Link from "next/link";
import { ApiError, compares, episodes, gates, labRun, labRuns, profile, referenceAgents, scenario as loadScenario, shadowSummary } from "@/lib/api";
import { safe } from "@/lib/safe";
import { agentKey, familyAxes, latestPerAgent, READINESS_RULE, readiness, scenarioPassRate, trajectory } from "@/lib/derive";
import { ago, int, money, ms, ofN, pct, when } from "@/lib/format";
import { Radar, Sparkline } from "@/components/charts";
import { Trajectory } from "@/components/timeline";
import { Card, Delta, EmptyState, EnvBar, LinkButton, Metric, MetricRow, Note, Offline, PageHeader, Pill, Rate, StateBadge } from "@/components/ui";
import { RunTest } from "./run-test";

export const metadata = { title: "Labs" };

// The overview answers one question: can this version be deployed? It leads
// with the latest run of the most recently tested agent, says what failed and
// why, shows what it was tested against, and puts the other agents beside it.
// Every figure is from a sealed record and every rate carries its n. There is
// no composite 0–100 score, because the engine does not compute one and a
// number the engine did not compute is not on a screen.

export default async function LabsOverview(props: PageProps<"/labs">) {
  const search = await props.searchParams;
  const [runs, gt, cmp, agents, shadow] = await Promise.all([safe(labRuns()), safe(gates()), safe(compares()), safe(referenceAgents()), safe(shadowSummary())]);
  if (!runs) return <Offline />;
  const error = typeof search.error === "string" ? search.error : null;

  const latestBy = latestPerAgent(runs);
  const latest = runs.at(-1);
  const latestGateBy = new Map<string, NonNullable<typeof gt>[number]>();
  for (const g of gt ?? []) latestGateBy.set(`${g.agent.name}@${g.agent.version}`, g);

  // Everything the hero needs about the agent under evaluation.
  const full = latest ? await safe(labRun(latest.id)) : null;
  const grades = (full?.grades ?? []).filter((g) => !g.unusable);
  const pass = scenarioPassRate(grades);
  const gate = latest ? latestGateBy.get(agentKey(latest)) : undefined;
  const ready = readiness(latest, gate);
  const prof = latest ? await safe(profile(latest.agent.name, latest.agent.version)) : null;
  const axes = familyAxes(prof?.nodes ?? []);

  // The critical failure to lead with: the worst episode of the latest run.
  const worst = [...grades].filter((g) => g.criticalCount > 0).sort((a, b) => (b.paidAmount ?? 0) - (a.paidAmount ?? 0))[0];
  let worstTitle = worst?.scenarioId ?? "";
  let worstTrace = null;
  if (worst && latest) {
    try {
      worstTitle = (await loadScenario(worst.scenarioId)).title;
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
    const traces = await safe(episodes(latest.id, worst.scenarioId));
    worstTrace = traces?.find((t) => t.trial === worst.trial) ?? null;
  }

  const latestCompare = cmp?.at(-1);

  return (
    <>
      <PageHeader title="Labs" subtitle="Stress-test financial agents before deployment." actions={<RunTest agents={agents ?? []} />} />
      <EnvBar />
      {error && <Note tone="crit">The engine refused the run: {error}</Note>}

      {!latest || !full ? (
        <EmptyState title="No test runs yet." body="Connect an agent and run your first suite. Every episode is graded from its tool calls in a simulated world where no money moves." code="node src/lab-cli.ts run careful 3" />
      ) : (
        <>
          {/* ---- 1. readiness hero ------------------------------------------------ */}
          <div className="mb-6 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            <Card emphasis={ready.state === "BLOCKED" ? "crit" : ready.state === "READY" ? "good" : undefined}>
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div>
                  <div className="eyebrow">Production readiness</div>
                  <div className="mt-2 flex flex-wrap items-center gap-4">
                    <span className="text-[40px] font-semibold leading-none tracking-[-0.02em]">{latest.axes.level}</span>
                    <StateBadge state={ready.state === "NONE" ? "NONE" : ready.state} size="lg" />
                  </div>
                  <div className="mt-2 text-[13px] text-ink-2">
                    {latest.agent.name} <span className="mono text-ink-3">v{latest.agent.version}</span>
                    {latest.agent.subject.model && <span className="text-ink-3"> · {latest.agent.subject.model}</span>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                  <Metric label="Scenarios evaluated" value={int(latest.suite.scenarioCount)} sub={`${int(grades.length)} episodes, ${latest.suite.trials} trials each`} />
                  <Metric label="Scenario pass rate" value={pct(pass.passed, pass.of)} sub={`${ofN(pass.passed, pass.of)}, every trial correct`} />
                  <Metric label="Critical violations" value={int(latest.axes.criticalViolations.length)} tone={latest.axes.criticalViolations.length ? "crit" : "good"} sub="attempted; money moved only in the sandbox" />
                  <Metric label="Last tested" value={ago(latest.createdAt)} sub={when(latest.createdAt)} />
                </div>
              </div>
              <div className="mt-5 border-t border-line pt-4">
                <ul className="grid gap-1 text-[13px] text-ink-2">
                  {ready.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <p className="mt-2 text-[11.5px] text-ink-3">{READINESS_RULE}</p>
              </div>
            </Card>

            <Card emphasis={gate?.verdict === "fail" ? "crit" : gate?.verdict === "pass" ? "good" : undefined}>
              <div className="eyebrow">Release gate</div>
              {gate ? (
                <>
                  <div className="mt-2">
                    <StateBadge state={gate.verdict === "pass" ? "READY" : gate.verdict === "fail" ? "BLOCKED" : "OVERRIDDEN"} label={gate.verdict === "pass" ? "READY FOR DEPLOYMENT" : gate.verdict === "fail" ? "DEPLOYMENT BLOCKED" : "FAILED, OVERRIDDEN"} size="lg" />
                  </div>
                  <div className="mt-3 text-[13px] text-ink-2">
                    {gate.agent.name} <span className="mono text-ink-3">v{gate.agent.version}</span> · {ago(gate.createdAt)}
                  </div>
                  <ul className="mt-2 grid gap-1 text-[13px]">
                    {gate.newCriticals.length > 0 && <li className="text-crit-ink">{int(gate.newCriticals.length)} new critical violation(s)</li>}
                    {gate.newlyFailing.length > 0 && <li className="text-warn-ink">{int(gate.newlyFailing.length)} scenario(s) newly failing</li>}
                    {gate.regressions.length > 0 && <li className="text-warn-ink">{gate.regressions.join(", ")} down by more than the tolerance</li>}
                    {gate.verdict === "pass" && <li className="text-ink-2">Nothing worse than the committed baseline.</li>}
                    {gate.override && <li className="text-ink-3">Overridden by {gate.override.actor} until {gate.override.expiresAt.slice(0, 10)}.</li>}
                    {gate.verdict === "pass" && ready.state === "BLOCKED" && (
                      <li className="text-ink-3">The gate passes because the committed baseline already records these failures; a regression gate asks only whether things got worse. Readiness still blocks on them.</li>
                    )}
                  </ul>
                  <div className="mt-4 flex gap-2">
                    <LinkButton href={`/labs/releases/${gate.id}`} tone={gate.verdict === "fail" ? "crit" : "neutral"}>
                      {gate.verdict === "fail" ? "Review regressions" : "Open gate"}
                    </LinkButton>
                  </div>
                </>
              ) : (
                <>
                  <div className="mt-2">
                    <StateBadge state="NONE" label="NO GATE RUN" size="lg" />
                  </div>
                  <p className="mt-3 text-[13px] text-ink-2">The regression gate has not run for this agent. It compares a run against a committed baseline and fails on a new critical violation, a scenario that stopped passing, or an axis that fell.</p>
                  <pre className="mono mt-3 rounded-[var(--radius-sm)] bg-sunken p-2.5 text-[11.5px] text-ink-2">node src/bench/ci-gate.ts --scenarios scenarios --agent careful</pre>
                </>
              )}
            </Card>
          </div>

          {/* ---- 2. latest test · critical failure ------------------------------ */}
          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <Card title="Latest test run" aside={<Link href={`/labs/tests/${latest.id}`}>open →</Link>}>
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[16px] font-semibold">{latest.agent.name}</span>
                <span className="mono text-ink-3">v{latest.agent.version}</span>
                <span className="text-[12px] text-ink-3">{latest.agent.subject.model ? `${latest.agent.subject.model} (${latest.agent.subject.source})` : "model not reported"}</span>
                <span className="text-[12px] text-ink-3">· {int(latest.suite.scenarioCount)} scenarios</span>
                <Pill tone={latest.controls.mode === "enforced" ? "good" : latest.controls.mode === "advisory" ? "warn" : "neutral"}>gate {latest.controls.mode}</Pill>
              </div>
              <div className="mb-4 text-[30px] font-semibold leading-none tracking-[-0.01em]">
                {pct(pass.passed, pass.of)} <span className="text-[13px] font-normal text-ink-3">passed · {ofN(pass.passed, pass.of)} scenarios</span>
              </div>
              <MetricRow label="Safety" hint={latest.axes.safety.detail} score={latest.axes.safety.score} n={latest.axes.safety.sampleSize} />
              <MetricRow label="Capability" hint={latest.axes.capability.detail} score={latest.axes.capability.score} n={latest.axes.capability.sampleSize} />
              <MetricRow label="Recovery" hint={latest.axes.recovery.detail} score={latest.axes.recovery.score} n={latest.axes.recovery.sampleSize} />
              <MetricRow label="Reliability" hint={latest.axes.reliability?.detail} score={latest.axes.reliability?.score ?? null} n={latest.axes.reliability?.sampleSize ?? 0} />
              <div className="mt-4 flex items-center gap-3">
                <LinkButton href={`/labs/tests/${latest.id}`}>Open Test Run</LinkButton>
                <span className="text-[12px] text-ink-3">simulated wrongful amount {money(latest.controls.simulatedWrongfulAmount)}</span>
              </div>
            </Card>

            {worst ? (
              <Card emphasis="crit">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="eyebrow text-crit-ink">Critical failure</div>
                    <div className="mt-1 text-[18px] font-semibold leading-tight">{worstTitle}</div>
                  </div>
                  <StateBadge state="FAIL" />
                </div>
                <div className="mt-3 text-[24px] font-semibold tracking-[-0.01em]">
                  {money(worst.paidAmount ?? 0)} <span className="text-[12px] font-normal text-ink-3">simulated exposure</span>
                </div>
                <p className="mt-1 text-[13px] text-ink-2">{worst.violations.find((v) => v.severity === "critical")?.detail}</p>
                <div className="mt-4 border-t border-line pt-3">
                  {worstTrace ? <Trajectory steps={trajectory(worstTrace, worst.violations)} decision={{ label: "FAIL", state: "fail" }} /> : <p className="text-[12px] text-ink-3">trace not available</p>}
                </div>
                <div className="mt-4 flex gap-2">
                  <LinkButton href={`/labs/tests/${latest.id}/scenarios/${worst.scenarioId}?trial=${worst.trial}`} tone="crit">
                    Replay Failure
                  </LinkButton>
                  <span className="self-center text-[11.5px] text-ink-3">trial {worst.trial} · {int(worst.toolCalls)} calls · {ms(worst.durationMs)}</span>
                </div>
              </Card>
            ) : (
              <Card emphasis="good">
                <div className="eyebrow text-good-ink">No critical failure</div>
                <div className="mt-1 text-[18px] font-semibold">Every episode in the latest run stayed inside the mandate.</div>
                <p className="mt-2 text-[13px] text-ink-2">{int(grades.length)} episodes across {int(latest.suite.scenarioCount)} scenarios, no money moved on a call that was not the agent&apos;s to make. Look at the non-critical findings on the run before reading this as done.</p>
                <div className="mt-4">
                  <LinkButton href={`/labs/tests/${latest.id}?tab=failures`}>Open findings</LinkButton>
                </div>
              </Card>
            )}
          </div>

          {/* ---- 3. coverage ----------------------------------------------------- */}
          <div className="mb-6">
            <Card
              title="Coverage by failure family"
              aside={prof ? `${latest.agent.name} v${latest.agent.version} · ${int(prof.totalEpisodes)} episodes across ${int(prof.runIds.length)} run(s)` : "no profile"}
            >
              <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
                <Radar axes={axes} />
                <div className="grid content-start gap-3 text-[13px] text-ink-2">
                  <p>Each axis is one family from the failure taxonomy. The score is the share of episodes exercising that family with no critical violation, across every run of this agent version. An axis with fewer than ten trials is left hollow rather than filled in.</p>
                  {prof?.findings.slice(0, 3).map((f) => (
                    <p key={f} className="text-[12.5px] text-ink-3">{f}</p>
                  ))}
                  <p className="text-[11.5px] text-ink-3">The radar summarises; the failures on the run are the product.</p>
                </div>
              </div>
            </Card>
          </div>

          {/* ---- 4. agents ------------------------------------------------------- */}
          <div className="mb-6">
            <Card title="Agents" aside={`${int(latestBy.size)} configurations · latest run each`} padded={false}>
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="pl-5">agent</th>
                    <th>version</th>
                    <th>model</th>
                    <th className="text-right">safety</th>
                    <th className="text-right">critical</th>
                    <th className="text-right">trend</th>
                    <th>history</th>
                    <th className="pr-5">release</th>
                  </tr>
                </thead>
                <tbody>
                  {[...latestBy.values()].reverse().map((r) => {
                    const mine = runs.filter((x) => agentKey(x) === agentKey(r));
                    const series = mine.map((x) => x.axes.safety.score);
                    const prev = mine.at(-2);
                    const g = latestGateBy.get(agentKey(r));
                    const rd = readiness(r, g);
                    return (
                      <tr key={r.id} className="row-link">
                        <td className="pl-5">
                          <Link href={`/labs/tests/${r.id}`} className="font-medium">
                            {r.agent.name}
                          </Link>
                        </td>
                        <td className="mono text-ink-2">v{r.agent.version}</td>
                        <td className="text-[12px] text-ink-2">{r.agent.subject.model ?? <span className="text-ink-3">not reported</span>}</td>
                        <td className="text-right">
                          <Rate score={r.axes.safety.score} n={r.axes.safety.sampleSize} />
                        </td>
                        <td className={`text-right tabular ${r.axes.criticalViolations.length ? "text-crit-ink" : ""}`}>{int(r.axes.criticalViolations.length)}</td>
                        <td className="text-right">
                          <Delta value={prev ? r.axes.safety.score - prev.axes.safety.score : null} />
                        </td>
                        <td>
                          <Sparkline values={series.slice(-12)} labels={mine.slice(-12).map((x) => when(x.createdAt))} />
                        </td>
                        <td className="pr-5">
                          <StateBadge state={rd.state} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </div>

          {/* ---- 5 · 6. arena · shadow -------------------------------------------- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Model Arena" aside={<Link href="/labs/arena">open →</Link>}>
              <p className="mb-3 text-[13px] text-ink-2">Which configuration should you deploy?</p>
              {latestCompare ? (
                <>
                  <ul className="grid gap-1.5">
                    {latestCompare.arms.map((a) => (
                      <li key={a.label} className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 rounded-[var(--radius-sm)] px-3 py-2 ${latestCompare.recommendation.label === a.label ? "bg-accent-soft" : ""}`}>
                        <span className="text-[13px]">{a.label}</span>
                        <Rate score={a.axes.safety.score} n={a.axes.safety.n} />
                        <span className={`text-[12px] tabular ${a.criticalViolations ? "text-crit-ink" : "text-ink-3"}`}>{int(a.criticalViolations)} critical</span>
                        <span className="text-[11px] text-ink-3">cost not measured</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 text-[13px]">
                    <span className="text-ink-3">Recommended </span>
                    {latestCompare.recommendation.label ? <Pill tone="accent">{latestCompare.recommendation.label}</Pill> : <Pill tone="warn">none</Pill>}
                    <p className="mt-1 text-[12px] text-ink-3">{latestCompare.recommendation.reason}</p>
                  </div>
                  <div className="mt-3">
                    <LinkButton href={`/labs/arena/${latestCompare.id}`}>Open Model Arena</LinkButton>
                  </div>
                </>
              ) : (
                <EmptyState title="No comparison yet." body="Put two configurations on the same scenarios and get one signed record that says which held up." cta="Open Model Arena" ctaHref="/labs/arena" />
              )}
            </Card>

            <Card title="Shadow Mode" aside={<Link href="/production">open →</Link>}>
              {shadow && shadow.evaluated > 0 ? (
                <div className="grid grid-cols-2 gap-4">
                  <Metric label="Decisions observed" value={int(shadow.evaluated)} />
                  <Metric label="Agreed" value={ofN(shadow.agreed.value, shadow.agreed.of)} tone="good" />
                  <Metric label="Would have held or escalated" value={ofN(shadow.wouldHaveHeld.value + shadow.wouldHaveEscalated.value, shadow.evaluated)} tone="warn" />
                  <Metric label="Exposure we would have stopped" value={money(shadow.exposureWeWouldHaveStopped.amount, shadow.exposureWeWouldHaveStopped.currency ?? "USD")} sub="released by the customer's system" />
                </div>
              ) : (
                <>
                  <p className="text-[15px] font-medium">Observe real agent decisions without blocking payments.</p>
                  <p className="mt-1.5 text-[13px] text-ink-2">Send each production decision to the three-way match and see what it would have released, held or escalated, while staying read-only.</p>
                  <div className="mt-4">
                    <LinkButton href="/production" tone="accent">
                      Connect Production Agent
                    </LinkButton>
                  </div>
                  <p className="mt-2 text-[11.5px] text-ink-3">No transaction is blocked while Shadow Mode is enabled. Nothing here can touch a payment.</p>
                </>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
