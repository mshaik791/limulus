import Link from "next/link";
import { AlertOctagon, Bot, FlaskConical, Gauge, ShieldCheck, Target } from "lucide-react";
import { ApiError, candidates, compares, episodes, gates, labRun, labRuns, profile, records, referenceAgents, scenario as loadScenario, shadowRecords, shadowSummary, type EpisodeTrace, type Scenario, type Violation } from "@/lib/api";
import { safe } from "@/lib/safe";
import { activity } from "@/lib/activity";
import { CONFIG, evidence } from "@/lib/config";
import { agentKey, counts, coverageConfidence, familyAxes, latestPerAgent, READINESS_RULE, readiness, scenarioPassRate, trajectory } from "@/lib/derive";
import { ago, int, money, ms, ofN, pct, when } from "@/lib/format";
import { agentDisplay, agentRaw, modelDisplay, suiteName } from "@/lib/names";
import { ActivityFeed, ExecutionGraph, MetricCard, RecommendedActions, type GraphEdge, type GraphNode, type Recommendation } from "@/components/blocks";
import { Radar, Sparkline } from "@/components/charts";
import { Trajectory } from "@/components/timeline";
import { Card, Delta, EmptyState, EnvBar, LinkButton, Note, Offline, PageHeader, Rate, StateBadge } from "@/components/ui";
import { RunTest } from "./run-test";

export const metadata = { title: "Labs" };

// Mission control. The page answers "can this version be deployed?" and shows
// the last thing that went wrong as a path through the money. Every node, tile
// and line is a fact from a sealed record. Counts are never mixed: episodes
// are episodes, check failures are check failures, and a critical failure is
// an episode whose worst finding was critical.

export default async function LabsOverview(props: PageProps<"/labs">) {
  const search = await props.searchParams;
  const [runs, gt, cmp, agents, shadow, shadowRows, cands, chain] = await Promise.all([
    safe(labRuns()),
    safe(gates()),
    safe(compares()),
    safe(referenceAgents()),
    safe(shadowSummary()),
    safe(shadowRecords()),
    safe(candidates()),
    safe(records()),
  ]);
  if (!runs) return <Offline />;
  const error = typeof search.error === "string" ? search.error : null;

  const latestBy = latestPerAgent(runs);
  const latest = runs.at(-1);
  const latestGateBy = new Map<string, NonNullable<typeof gt>[number]>();
  for (const g of gt ?? []) latestGateBy.set(`${g.agent.name}@${g.agent.version}`, g);

  const full = latest ? await safe(labRun(latest.id)) : null;
  const grades = (full?.grades ?? []).filter((g) => !g.unusable);
  const c = counts(grades);
  const pass = scenarioPassRate(grades);
  const prof = latest ? await safe(profile(latest.agent.name, latest.agent.version)) : null;
  const axes = familyAxes(prof?.nodes ?? []);
  const coverage = coverageConfidence(axes);
  const gate = latest ? latestGateBy.get(agentKey(latest)) : undefined;
  const ready = latest ? readiness(latest, gate, grades, axes) : readiness(undefined, undefined);
  const mine = latest ? runs.filter((r) => agentKey(r) === agentKey(latest)) : [];
  const prev = mine.at(-2);

  const worst = [...grades].filter((g) => g.criticalCount > 0).sort((a, b) => (b.paidAmount ?? 0) - (a.paidAmount ?? 0))[0];
  const shown = worst ?? grades.at(-1);
  let scenario: Scenario | null = null;
  let trace: EpisodeTrace | null = null;
  if (shown && latest) {
    try {
      scenario = await loadScenario(shown.scenarioId);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
    const traces = await safe(episodes(latest.id, shown.scenarioId));
    trace = traces?.find((t) => t.trial === shown.trial) ?? null;
  }
  const graph = shown && trace && latest ? buildGraph(latest.agent, scenario, trace, shown.violations, shown.criticalCount > 0) : null;

  const episodesTotal = runs.reduce((n, r) => n + r.suite.episodes, 0);
  const latestCompare = cmp?.at(-1);
  const feed = activity({ runs, gates: gt ?? [], compares: cmp ?? [], shadow: shadowRows ?? [], candidates: cands ?? [], decisions: chain ?? [] });

  const recs: Recommendation[] = [];
  if (gate?.verdict === "fail") recs.push({ title: "Review the failed regression gate", reason: `${agentDisplay(gate.agent.name)}: ${[...gate.newCriticals, ...gate.newlyFailing].slice(0, 2).join(", ")}`, cta: "Review", href: `/labs/releases/${gate.id}`, tone: "crit" });
  if (worst && latest) recs.push({ title: "Replay the critical failure", reason: `${worst.scenarioId}, ${money(worst.paidAmount ?? 0)} simulated exposure`, cta: "Replay", href: `/labs/tests/${latest.id}/scenarios/${worst.scenarioId}?trial=${worst.trial}`, tone: "crit" });
  const pendingCands = (cands ?? []).filter((x) => x.status === "pending").length;
  if (pendingCands) recs.push({ title: `Review ${int(pendingCands)} incident candidate(s)`, reason: "Production signals waiting to become regression scenarios", cta: "Review", href: "/incidents", tone: "warn" });
  if (shadow) {
    const awaiting = shadow.reviewed.of - (shadow.reviewed.falsePositives + shadow.reviewed.confirmed + shadow.reviewed.unsure);
    if (awaiting > 0) recs.push({ title: `Review ${int(awaiting)} shadow disagreement(s)`, reason: "Where the match and production disagree, a person decides which was right", cta: "Review", href: "/production", tone: "warn" });
  }
  const thin = axes.filter((a) => a.status !== "measured");
  if (thin.length) recs.push({ title: `Raise coverage: ${thin.length} of ${axes.length} families lack evidence`, reason: `${thin.map((a) => a.label).slice(0, 3).join(", ")}${thin.length > 3 ? ", …" : ""}`, cta: "Run Tests", href: "/labs/tests", tone: "accent" });
  if (!latestCompare) recs.push({ title: "Compare two configurations", reason: "No comparison on record yet", cta: "Open Arena", href: "/labs/arena", tone: "neutral" });

  return (
    <>
      <PageHeader title="Labs" subtitle="Stress-test financial agents before deployment." actions={<RunTest agents={agents ?? []} show={["connect"]} />} />
      <EnvBar />
      {error && <Note tone="crit">The engine refused the run: {error}</Note>}

      {!latest || !full ? (
        <EmptyState title="No test runs yet." body="Connect an agent and run your first suite. Every episode is graded from its tool calls in a simulated world where no money moves." code="node src/lab-cli.ts run careful 3" />
      ) : (
        <>
          {/* ---- metric row -------------------------------------------------------- */}
          <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-6">
            <MetricCard
              icon={Gauge}
              label="Production readiness"
              value={<StateBadge state={ready.state} size="lg" />}
              sub={<span className="capitalize">{latest.axes.level}</span>}
              tone={ready.state === "BLOCKED" ? "crit" : ready.state === "READY" ? "good" : "warn"}
              href="/labs/releases"
            />
            <MetricCard icon={Bot} label="Agents tested" value={int(latestBy.size)} sub={`${int(runs.length)} runs on record`} href="/labs/tests" />
            <MetricCard icon={FlaskConical} label="Episodes evaluated" value={int(episodesTotal)} sub={`${int(c.episodes)} in the latest run`} spark={runs.slice(-12).map((r) => r.suite.episodes)} href="/labs/tests" />
            <MetricCard
              icon={AlertOctagon}
              label="Episodes with critical failure"
              value={int(c.criticalEpisodes)}
              tone={c.criticalEpisodes ? "crit" : "good"}
              sub={`${int(c.criticalCheckFailures)} critical check failure(s) · latest run`}
              href={`/labs/tests/${latest.id}?tab=failures`}
            />
            <MetricCard
              icon={ShieldCheck}
              label="Safety score"
              value={<Rate score={latest.axes.safety.score} n={latest.axes.safety.sampleSize} />}
              trend={{ value: prev ? latest.axes.safety.score - prev.axes.safety.score : null, label: "vs previous run" }}
              spark={mine.slice(-12).map((r) => r.axes.safety.score)}
              href={`/labs/tests/${latest.id}`}
            />
            <MetricCard
              icon={Target}
              label="Coverage confidence"
              value={`${coverage.pct}%`}
              tone={coverage.pct < 50 ? "warn" : "neutral"}
              sub={`${ofN(coverage.measured, coverage.of)} families with sufficient evidence`}
              href={`/labs/tests/${latest.id}`}
            />
          </div>

          {/* ---- execution map · live activity --------------------------------------- */}
          <div className="mb-5 grid gap-4 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <Card
                title="Agent Execution Map"
                aside={
                  shown ? (
                    <Link href={`/labs/tests/${latest.id}/scenarios/${shown.scenarioId}?trial=${shown.trial}`}>
                      {worst ? "the critical failure in the latest run" : "the latest episode"} · open →
                    </Link>
                  ) : undefined
                }
                emphasis={worst ? "crit" : undefined}
                className="h-full"
              >
                <p className="mb-3 text-[12.5px] text-ink-3">How authorization, evidence, policy and simulated execution connected in {scenario?.title ?? shown?.scenarioId ?? "this episode"}. Nothing here moved money.</p>
                {graph ? <ExecutionGraph nodes={graph.nodes} edges={graph.edges} /> : <p className="text-[13px] text-ink-3">No trace available for this episode.</p>}
                <div className="mt-3 flex flex-wrap gap-4 text-[11.5px] text-ink-3">
                  <span>
                    <span className="mr-1.5 inline-block h-[2px] w-4 bg-cyan align-middle" />
                    normal flow
                  </span>
                  <span>
                    <span className="mr-1.5 inline-block h-[2px] w-4 bg-crit align-middle" />
                    risky flow
                  </span>
                  <span>
                    <span className="mr-1.5 inline-block h-[10px] w-[10px] rounded-full border border-crit align-middle" />
                    simulated rail not reached
                  </span>
                </div>
              </Card>
            </div>
            <div className="xl:col-span-4">
              <Card title="Live Activity" aside={`${int(feed.length)} most recent`} className="h-full">
                <ActivityFeed items={feed} empty="Nothing sealed yet." />
              </Card>
            </div>
          </div>

          {/* ---- replay · radar · actions ------------------------------------------- */}
          <div className="mb-5 grid gap-4 xl:grid-cols-12">
            <div className="xl:col-span-5">
              <Card title="Scenario Replay" aside={shown ? <StateBadge state={worst ? "FAIL" : shown.effective === shown.expected ? "PASS" : "REVIEW"} /> : undefined} emphasis={worst ? "crit" : undefined} className="h-full">
                {shown && trace ? (
                  <>
                    <div className="text-[16px] font-semibold leading-snug">{scenario?.title ?? shown.scenarioId}</div>
                    <div className="mt-1 text-[24px] font-semibold tabular tracking-[-0.01em]">
                      {money(shown.paidAmount ?? 0)} <span className="text-[12px] font-normal text-ink-3">{worst ? "simulated exposure" : "simulated payment attempt"}</span>
                    </div>
                    <div className="mt-4 grid gap-5 md:grid-cols-2">
                      <div>
                        <div className="eyebrow mb-2">Timeline</div>
                        <Trajectory steps={trajectory(trace, shown.violations)} decision={{ label: worst ? "FAIL" : shown.effective === shown.expected ? "PASS" : "REVIEW", state: worst ? "fail" : shown.effective === shown.expected ? "ok" : "warn" }} />
                      </div>
                      <div>
                        <div className="eyebrow mb-2">Agent trajectory</div>
                        <ol className="grid gap-2 text-[12px]">
                          {trace.calls.slice(0, 5).map((x) => (
                            <li key={x.seq}>
                              <div className="text-[11px] tabular text-ink-3">+{ms(x.elapsedMs)} · tool call</div>
                              <div className="mono text-ink-2">
                                {x.tool}({Object.values(x.args).slice(0, 2).map((v) => JSON.stringify(v)).join(", ")})
                              </div>
                            </li>
                          ))}
                          <li>
                            <div className="text-[11px] text-ink-3">agent · stated reason, never trusted</div>
                            <div className="text-ink-2">{trace.declared?.reason ?? trace.error ?? "none"}</div>
                          </li>
                        </ol>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <LinkButton href={`/labs/tests/${latest.id}/scenarios/${shown.scenarioId}?trial=${shown.trial}`} tone={worst ? "crit" : "accent"}>
                        View Full Trace
                      </LinkButton>
                      <LinkButton href={`/labs/tests/${latest.id}?tab=trace`}>Every episode</LinkButton>
                    </div>
                  </>
                ) : (
                  <p className="text-[13px] text-ink-3">No episode to replay.</p>
                )}
              </Card>
            </div>
            <div className="xl:col-span-4">
              <Card title="Risk Radar" aside={prof ? `${int(prof.totalEpisodes)} episodes · ${int(prof.runIds.length)} run(s)` : undefined} className="h-full">
                <div className="mb-3 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[12px] text-ink-3">Safety score</div>
                    <div className="text-[24px] font-semibold tabular">
                      <Rate score={latest.axes.safety.score} n={latest.axes.safety.sampleSize} />
                    </div>
                  </div>
                  <div>
                    <div className="text-[12px] text-ink-3">Coverage confidence</div>
                    <div className={`text-[24px] font-semibold tabular ${coverage.pct < 50 ? "text-warn-ink" : ""}`}>{coverage.pct}%</div>
                    <div className="text-[11px] text-ink-3">{ofN(coverage.measured, coverage.of)} families with ≥ {CONFIG.minFamilyTrials} trials</div>
                  </div>
                </div>
                <Radar axes={axes} size={220} stacked />
                <p className="mt-3 text-[11.5px] text-ink-3">
                  {agentDisplay(latest.agent.name)} · <span className="mono">{agentRaw(latest.agent.name, latest.agent.version)}</span>. Unknown is not zero: an axis without evidence is left off the shape.
                </p>
              </Card>
            </div>
            <div className="xl:col-span-3">
              <Card title="Recommended Actions" className="h-full">
                <RecommendedActions items={recs.slice(0, 4)} />
              </Card>
            </div>
          </div>

          {/* ---- agents · arena · shadow ------------------------------------------- */}
          <div className="grid gap-4 xl:grid-cols-12">
            <div className="xl:col-span-7">
              <Card title="Agents" aside={`${int(latestBy.size)} configurations · latest run each`} padded={false} className="h-full">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className="pl-6">agent</th>
                        <th>model</th>
                        <th className="text-right">safety</th>
                        <th className="text-right">critical check failures</th>
                        <th className="text-right">trend</th>
                        <th>history</th>
                        <th className="pr-6">release</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...latestBy.values()].reverse().map((r) => {
                        const series = runs.filter((x) => agentKey(x) === agentKey(r));
                        const p = series.at(-2);
                        const rd = readiness(r, latestGateBy.get(agentKey(r)));
                        return (
                          <tr key={r.id} className="row-link">
                            <td className="pl-6">
                              <Link href={`/labs/tests/${r.id}`} className="font-medium">
                                {agentDisplay(r.agent.name)}
                              </Link>
                              <div className="text-[11.5px] text-ink-3">
                                <span className="mono">{agentRaw(r.agent.name, r.agent.version)}</span> · {suiteName(r.suite.id).name}
                              </div>
                            </td>
                            <td className="text-[12.5px] text-ink-2">{modelDisplay(r.agent.subject.model, r.agent.subject.source)}</td>
                            <td className="text-right">
                              <Rate score={r.axes.safety.score} n={r.axes.safety.sampleSize} />
                            </td>
                            <td className={`text-right tabular ${r.axes.criticalViolations.length ? "text-crit-ink" : ""}`}>{int(r.axes.criticalViolations.length)}</td>
                            <td className="text-right">
                              <Delta value={p ? r.axes.safety.score - p.axes.safety.score : null} />
                            </td>
                            <td>
                              <Sparkline values={series.slice(-12).map((x) => x.axes.safety.score)} labels={series.slice(-12).map((x) => when(x.createdAt))} />
                            </td>
                            <td className="pr-6">
                              <StateBadge state={rd.state} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
            <div className="grid gap-4 xl:col-span-5">
              <Card title="Model Arena" aside={<Link href="/labs/arena">open →</Link>} emphasis={latestCompare ? "model" : undefined}>
                {latestCompare ? (
                  <>
                    <p className="mb-2 text-[13px] text-ink-2">Latest configuration comparison.</p>
                    <ul className="grid gap-1">
                      {latestCompare.arms.map((a) => (
                        <li key={a.label} className={`grid grid-cols-[1fr_auto_auto] items-center gap-4 rounded-[var(--radius-sm)] px-2.5 py-1.5 ${latestCompare.recommendation.label === a.label ? "bg-model-soft" : ""}`}>
                          <span className="truncate text-[13px]">{a.label}</span>
                          <Rate score={a.axes.safety.score} n={a.axes.safety.n} />
                          <span className={`text-[12px] tabular ${a.criticalEpisodes ? "text-crit-ink" : "text-ink-3"}`}>{int(a.criticalEpisodes)} critical episodes</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[12px] text-ink-3">
                      Engine&apos;s pick: {latestCompare.recommendation.label ?? "none"} · evidence: {evidence(Math.max(...latestCompare.arms.map((a) => a.episodes))) === "eligible" ? "eligible for recommendation" : evidence(Math.max(...latestCompare.arms.map((a) => a.episodes))) === "provisional" ? "provisional" : "insufficient data"}.
                    </p>
                  </>
                ) : (
                  <EmptyState title="No comparison yet." body="Put two configurations on identical scenarios." cta="Open Model Arena" ctaHref="/labs/arena" />
                )}
              </Card>
              <Card title="Shadow Mode" aside={<Link href="/production">open →</Link>}>
                {shadow && shadow.evaluated > 0 ? (
                  <div className="grid grid-cols-3 gap-3 text-[13px]">
                    <div>
                      <div className="text-ink-3">observed</div>
                      <div className="text-[22px] font-semibold tabular">{int(shadow.evaluated)}</div>
                    </div>
                    <div>
                      <div className="text-ink-3">would hold or escalate</div>
                      <div className="text-[22px] font-semibold tabular text-warn-ink">{ofN(shadow.wouldHaveHeld.value + shadow.wouldHaveEscalated.value, shadow.evaluated)}</div>
                    </div>
                    <div>
                      <div className="text-ink-3">would have stopped</div>
                      <div className="text-[22px] font-semibold tabular">{money(shadow.exposureWeWouldHaveStopped.amount, shadow.exposureWeWouldHaveStopped.currency ?? "USD")}</div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[14px] font-medium">Observe real agent decisions without blocking anything.</p>
                      <p className="mt-1 text-[12.5px] text-ink-3">No transaction is blocked while Shadow Mode is enabled.</p>
                    </div>
                    <LinkButton href="/production" tone="accent">
                      Connect
                    </LinkButton>
                  </div>
                )}
              </Card>
            </div>
          </div>

          <p className="mt-5 text-[11.5px] text-ink-3">
            {READINESS_RULE} Scenario pass rate {pct(pass.passed, pass.of)} ({ofN(pass.passed, pass.of)}, every trial correct). Last tested {ago(latest.createdAt)}.
          </p>
        </>
      )}
    </>
  );
}

/**
 * The path a payment took, from the records. A node turns red only where a
 * grader anchored a critical finding or the accounts disagree; the simulated
 * rail is "not reached" when no payment settled in the sandbox. Wording never
 * implies real money moved.
 */
function buildGraph(agent: { name: string; version: string }, scenario: Scenario | null, trace: EpisodeTrace, violations: Violation[], critical: boolean): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const pay = trace.calls.filter((x) => x.tool === "create_payment").at(-1);
  const lookup = trace.calls.find((x) => x.tool === "lookup_vendor");
  const invoiceId = scenario?.task.match(/INV-[\w-]+/)?.[0] ?? String(pay?.args.invoiceId ?? "");
  const approved = scenario?.authorization.approvedInvoices.find((i) => i.invoiceId === invoiceId);
  const vendorName = scenario?.authorization.approvedVendors[0]?.name ?? String(pay?.args.payeeName ?? lookup?.args.name ?? "vendor");
  const onFile = scenario?.authorization.approvedVendors.find((v) => v.name.toLowerCase() === vendorName.toLowerCase())?.accountLast4 ?? String(lookup?.result.accountLast4 ?? "");
  const paidTo = String(pay?.args.payeeAccountLast4 ?? "");
  const settled = pay?.result.state === "settled";
  const codes = new Set(violations.map((v) => v.code));
  const beneficiaryRisk = codes.has("paid_wrong_account") || codes.has("changed_bank_details_unverified") || codes.has("ignored_stale_bank_change") || codes.has("acted_on_document_instruction") || Boolean(paidTo && onFile && paidTo !== onFile);
  const docSaysOtherAccount = Boolean(
    scenario?.documents.some((d) => {
      const t = `${d.text} ${d.hiddenText ?? ""}`;
      const m = t.match(/account ending (\d{4})/i);
      return m && onFile && m[1] !== onFile;
    }),
  );
  const authRisk = codes.has("exceeded_limit") || codes.has("exceeded_daily_limit") || codes.has("amount_exceeds_approval") || codes.has("paid_unapproved_invoice");
  const escalated = trace.calls.some((x) => x.tool === "request_human_approval");
  const amount = pay ? `${String(pay.args.currency ?? "USD")} ${Number(pay.args.amount ?? 0).toLocaleString()}` : "";

  const nodes: GraphNode[] = [
    { id: "agent", label: "Financial agent", sub: agentDisplay(agent.name), tone: "accent", x: 8, y: 50, badge: agentRaw(agent.name, agent.version) },
    { id: "invoice", label: "Invoice", sub: invoiceId || "no invoice named", x: 29, y: 24, tone: docSaysOtherAccount ? "warn" : undefined, badge: docSaysOtherAccount ? "NEW ACCOUNT IN DOCUMENT" : undefined },
    { id: "policy", label: "Policy", sub: scenario ? `${scenario.authorization.policyVersion} · limit ${money(scenario.authorization.limitPerPayment, scenario.authorization.currency)}` : "policy in force", x: 29, y: 76, tone: authRisk ? "crit" : undefined, badge: authRisk ? "EXCEEDED" : undefined },
    { id: "vendor", label: "Vendor", sub: vendorName, x: 50, y: 24 },
    { id: "approval", label: "Approval", sub: approved ? `${approved.invoiceId} by ${approved.approvedBy}` : escalated ? "asked a person" : "none on file", x: 50, y: 76, tone: !approved && !escalated && settled ? "crit" : escalated ? "good" : undefined, badge: !approved && !escalated && settled ? "NO APPROVAL ON FILE" : escalated ? "ESCALATED" : undefined },
    { id: "bank", label: "Beneficiary", sub: paidTo ? `account ****${paidTo}` : onFile ? `on file ****${onFile}` : "not resolved", x: 71, y: 50, tone: beneficiaryRisk ? "crit" : undefined, badge: beneficiaryRisk ? (paidTo && onFile && paidTo !== onFile ? "DOES NOT MATCH RECORD" : "BANK DETAILS CHANGED · RISKY") : undefined },
    {
      id: "rail",
      label: "Simulated execution",
      sub: pay ? `${String(pay.result.rail ?? "ach").toUpperCase()} · ${amount}` : "no payment attempted",
      x: 92,
      y: 50,
      tone: settled ? (critical ? "crit" : "good") : escalated ? "warn" : "neutral",
      badge: settled ? (critical ? "WOULD HAVE EXECUTED · WRONGFUL" : "WOULD HAVE EXECUTED") : escalated ? "HELD FOR A PERSON" : "NOT REACHED",
    },
  ];
  const edges: GraphEdge[] = [
    { from: "agent", to: "invoice" },
    { from: "agent", to: "policy" },
    { from: "invoice", to: "vendor" },
    { from: "policy", to: "approval" },
    { from: "vendor", to: "bank", tone: beneficiaryRisk ? "crit" : undefined },
    { from: "approval", to: "bank", tone: authRisk ? "crit" : undefined },
    { from: "bank", to: "rail", tone: critical ? "crit" : settled ? "good" : undefined, broken: !settled },
  ];
  return { nodes, edges };
}
