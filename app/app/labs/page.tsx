import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { candidates, gates, labRun, labRuns, profile, referenceAgents, shadowSummary, type EpisodeGrade, type GateRecord, type LabRunSummary } from "@/lib/api";
import { safe } from "@/lib/safe";
import { CONFIG } from "@/lib/config";
import { FAMILIES, agentKey, counts, coverageConfidence, failingByFamily, familyAxes, plainReadiness, readiness, type Readiness } from "@/lib/derive";
import { ago, int, money, ofN } from "@/lib/format";
import { agentDisplay, agentTitle, agentVersionLabel, modelDisplay, suiteName } from "@/lib/names";
import { Card, EmptyState, EnvBar, LinkButton, Note, Offline, PageHeader, Pill, StateBadge } from "@/components/ui";
import { AgentSelect } from "./agent-select";
import { RunTest } from "./run-test";

export const metadata = { title: "Labs" };

// One question: can this agent deploy? Then why not, and what to do next.
// Everything technical lives one level deeper: the run page for grades and
// the radar, Scenario Replay for the execution map and the trace, Releases
// for the two gates in full. Nothing shown here is a new measurement; every
// number is read from a sealed record and carries its n.

const STATUS_LABEL: Record<Readiness["state"], string> = { READY: "READY TO DEPLOY", REVIEW: "REVIEW REQUIRED", BLOCKED: "NOT READY TO DEPLOY", NONE: "NOT TESTED" };

export default async function LabsOverview(props: PageProps<"/labs">) {
  const search = await props.searchParams;
  const [runs, gt, agents, cands, shadow] = await Promise.all([safe(labRuns()), safe(gates()), safe(referenceAgents()), safe(candidates()), safe(shadowSummary())]);
  if (!runs) return <Offline />;
  const error = typeof search.error === "string" ? search.error : null;

  // The agent under evaluation: chosen, or the one tested most recently.
  const latestByAgent = new Map<string, LabRunSummary>();
  for (const r of runs) latestByAgent.set(agentKey(r), r);
  const choices = [...latestByAgent.values()].reverse();
  const wanted = typeof search.agent === "string" ? search.agent : "";
  const isSelftest = (r: LabRunSummary) => /selftest|^custom:/.test(r.suite.id) || r.agent.name === "t";
  const latest = choices.find((r) => agentKey(r) === wanted) ?? choices.find((r) => !isSelftest(r)) ?? choices[0];

  if (!latest) {
    return (
      <>
        <PageHeader title="Labs" subtitle="Test a financial agent before it touches money." actions={<RunTest agents={agents ?? []} />} />
        <EnvBar />
        {error && <Note tone="crit">The engine refused the run: {error}</Note>}
        <EmptyState title="No agent tested yet." body="Connect an agent and run the suite. Every test is graded from what the agent did in a simulated world where no money moves." cta="Run a test" ctaHref="/labs" code="node src/lab-cli.ts run careful 3" />
      </>
    );
  }

  const gateByAgent = new Map<string, GateRecord>();
  for (const g of gt ?? []) gateByAgent.set(`${g.agent.name}@${g.agent.version}`, g);
  const [full, prof] = await Promise.all([safe(labRun(latest.id)), safe(profile(latest.agent.name, latest.agent.version))]);
  if (!full) return <Offline />;
  const grades = full.grades.filter((g) => !g.unusable);
  const c = counts(grades);
  const axes = familyAxes(prof?.nodes ?? []);
  const coverage = coverageConfidence(axes);
  const gate = gateByAgent.get(agentKey(latest));
  const ready = readiness(latest, gate, full ? grades : null, axes);
  const blocked = ready.state === "BLOCKED";
  const thin = c.episodes < CONFIG.minEpisodes || coverage.measured === 0;

  // The most important failure in the latest run: critical first, then the
  // largest simulated exposure.
  const worst = [...grades].filter((g) => g.criticalCount > 0).sort((a, b) => (b.paidAmount ?? 0) - (a.paidAmount ?? 0))[0] ?? [...grades].filter((g) => g.effective !== g.expected)[0];
  const worstTitle = worst ? await titleOf(worst) : null;

  // Failures by risk area, across every run of this agent version.
  const inRun = failingByFamily(grades);
  const areas = FAMILIES.map((f) => {
    const mine = (prof?.nodes ?? []).filter((n) => n.node.startsWith(`${f.key}.`));
    const latestRun = inRun.get(f.key) ?? { episodes: 0, critical: 0, exposure: 0 };
    return { ...f, trials: mine.reduce((s, n) => s + n.trials, 0), failures: mine.reduce((s, n) => s + n.failures, 0), latestRun, axis: axes.find((a) => a.key === f.key)! };
  });
  const failing = areas.filter((a) => a.failures > 0 || a.latestRun.episodes > 0).sort((a, b) => b.latestRun.critical - a.latestRun.critical || b.failures - a.failures || b.latestRun.episodes - a.latestRun.episodes);

  const run = `/labs/tests/${latest.id}`;
  const next = nextSteps({ ready, gate, worst, run, failing, axes, pending: (cands ?? []).filter((x) => x.status === "pending").length, shadow: shadow ? shadow.reviewed.of - (shadow.reviewed.falsePositives + shadow.reviewed.confirmed + shadow.reviewed.unsure) : 0 });

  // Recent tests of this agent, any version; coverage is per version.
  const recent = runs.filter((r) => r.agent.name === latest.agent.name).reverse().slice(0, 8);
  const versions = [...new Set(recent.map((r) => r.agent.version))];
  const [versionEvidence, recentRecords] = await Promise.all([
    Promise.all(versions.map(async (v) => {
      const record = v === latest.agent.version ? prof : await safe(profile(latest.agent.name, v));
      const versionAxes = record ? familyAxes(record.nodes) : null;
      return [v, versionAxes] as const;
    })),
    Promise.all(recent.map(async (r) => [r.id, r.id === latest.id ? full : await safe(labRun(r.id))] as const)),
  ]);
  const axesByVersion = new Map(versionEvidence);
  const recordsById = new Map(recentRecords);

  const gateWord = !ready.regression ? { state: "NONE" as const, label: "NOT RUN" } : ready.regression.verdict === "overridden" ? { state: "OVERRIDDEN" as const, label: "OVERRIDDEN" } : ready.regression.pass ? { state: "PASS" as const, label: "PASS" } : { state: "BLOCKED" as const, label: "BLOCKED" };

  return (
    <>
      <PageHeader title="Labs" subtitle="Test a financial agent before it touches money." actions={<RunTest agents={agents ?? []} />} />
      <EnvBar />
      {error && <Note tone="crit">The engine refused the run: {error}</Note>}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <AgentSelect value={agentKey(latest)} options={choices.map((r) => ({ key: agentKey(r), label: agentTitle(r) }))} />
        <span className="text-[13px] text-ink-3">Last tested {ago(latest.createdAt)}</span>
      </div>

      {/* ---- row 1: the decision ------------------------------------------- */}
      <div className="mb-8 grid gap-6 xl:grid-cols-12">
        <section className={`rounded-[var(--radius)] border bg-surface px-8 py-7 shadow-[var(--shadow)] xl:col-span-8 ${blocked ? "border-crit/40 [box-shadow:var(--glow-crit)]" : ready.state === "READY" ? "border-good/40 [box-shadow:var(--glow-good)]" : "border-line"}`}>
          <div className="eyebrow">Deployment status</div>
          <div className="mt-3">
            <StateBadge state={ready.state} label={STATUS_LABEL[ready.state]} size="lg" />
          </div>
          <div className="mt-4 text-[22px] font-semibold leading-tight tracking-[-0.01em]">{agentTitle(latest)}</div>
          <div className="mt-1 text-[13px] text-ink-3">
            {modelDisplay(latest.agent.subject.model, latest.agent.subject.source)} · {suiteName(latest.suite.id).name}
          </div>

          <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
            <Stat label="Safety" value={c.episodes ? String(latest.axes.safety.score) : "–"} sub={c.episodes ? `on ${int(latest.axes.safety.sampleSize)} tests` : "no usable tests"} tone={thin ? "warn" : latest.axes.safety.score >= CONFIG.minSafety ? "good" : "crit"} />
            <Stat label="Test coverage" value={`${coverage.pct}%`} sub={`${ofN(coverage.measured, coverage.of)} risk areas tested enough`} tone={coverage.measured === 0 ? "warn" : coverage.pct < 50 ? "warn" : "good"} />
            <Stat label="Critical failures" value={String(c.criticalEpisodes)} sub={`of ${int(c.episodes)} tests in the latest run`} tone={c.criticalEpisodes ? "crit" : "good"} />
            <Stat label="Release gate" value={<StateBadge state={gateWord.state} label={gateWord.label} />} sub={ready.regression ? "against the sealed baseline" : "not run for this version"} tone="neutral" />
          </dl>

          {thin && (
            <p className="mt-6 flex items-start gap-2 text-[13px] text-warn-ink">
              <span aria-hidden>!</span>
              <span>
                Insufficient evidence. {c.episodes ? `Only ${int(c.episodes)} tests in this run; ` : ""}
                {coverage.measured} of {coverage.of} risk areas have enough tests to count. A high score on thin evidence is not a deployable score.
              </span>
            </p>
          )}

          <p className={`text-[15px] leading-relaxed text-ink ${thin ? "mt-3" : "mt-6"}`}>{plainReadiness(ready, c, gate)}</p>

          <div className="mt-6 flex flex-wrap gap-2">
            {blocked || worst ? (
              <LinkButton href={`${run}?tab=failures`} tone={blocked ? "crit" : "neutral"}>
                Review Failures
              </LinkButton>
            ) : (
              <LinkButton href={run} tone="accent">
                Open the latest test
              </LinkButton>
            )}
            <RunTest agents={agents ?? []} show={["run"]} runLabel="Run Again" quiet />
          </div>
        </section>

        <section className="xl:col-span-4">
          <h2 className="eyebrow mb-3">What to do next</h2>
          <ol className="grid gap-3">
            {next.map((s) => (
              <li key={s.href + s.title}>
                <Link href={s.href} className="group flex items-start gap-2.5 rounded-[var(--radius-sm)] px-2 py-2 -mx-2 transition-colors hover:bg-surface-2">
                  <ArrowRight size={15} strokeWidth={1.75} className={`mt-[3px] shrink-0 ${s.tone === "crit" ? "text-crit-ink" : s.tone === "warn" ? "text-warn-ink" : "text-accent-ink"}`} />
                  <span className="min-w-0">
                    <span className="block text-[14px] text-ink">{s.title}</span>
                    {s.reason && <span className="block text-[12.5px] text-ink-3">{s.reason}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {/* ---- row 2: why, and how much evidence ---------------------------- */}
      <div className="mb-8 grid gap-6 xl:grid-cols-12">
        <section className="xl:col-span-8">
          <h2 className="eyebrow mb-3">{blocked ? "Why it's blocked" : worst ? "What went wrong in the latest test" : "Latest test"}</h2>
          {worst && (
            <Card emphasis={worst.criticalCount > 0 ? "crit" : undefined} className="mb-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-ink-3">Most important failure</span>
                <Pill tone={worst.criticalCount > 0 ? "crit" : "warn"}>{worst.criticalCount > 0 ? "critical" : "finding"}</Pill>
              </div>
              <div className="mt-2 text-[18px] font-semibold leading-snug">{worstTitle ?? headline(worst)}</div>
              {!worstTitle && <div className="mono mt-0.5 text-[11px] text-ink-3">{worst.scenarioId}</div>}
              <p className="mt-1.5 text-[13.5px] text-ink-2">{describe(worst)}</p>
              <div className="mt-4 flex flex-wrap items-center gap-4">
                {worst.paidAmount ? (
                  <span className="text-[20px] font-semibold tabular">
                    {money(worst.paidAmount)} <span className="text-[12px] font-normal text-ink-3">simulated exposure</span>
                  </span>
                ) : (
                  <span className="text-[13px] text-ink-3">no payment attempted</span>
                )}
                <LinkButton href={`${run}/scenarios/${worst.scenarioId}?trial=${worst.trial}`} tone={worst.criticalCount > 0 ? "crit" : "neutral"}>
                  Replay Scenario
                </LinkButton>
              </div>
            </Card>
          )}
          {failing.length > 0 ? (
            <Card padded={false}>
              <ol>
                {failing.slice(0, 3).map((a, i) => (
                  <li key={a.key}>
                    <Link href={`${run}?tab=failures`} className="flex items-center gap-4 border-b border-line px-6 py-4 last:border-0 hover:bg-surface-2">
                      <span className="w-5 text-[13px] tabular text-ink-3">{i + 1}.</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-medium">{a.label}</span>
                        <span className="block text-[12.5px] text-ink-3">
                          {a.latestRun.episodes ? `${int(a.latestRun.episodes)} failing test${a.latestRun.episodes === 1 ? "" : "s"} in the latest run${a.latestRun.critical ? `, ${int(a.latestRun.critical)} critical` : ""}` : ""}
                          {a.latestRun.episodes && a.trials ? " · " : ""}
                          {a.trials ? `${ofN(a.failures, a.trials)} across this version` : ""}
                        </span>
                      </span>
                      <Pill tone={a.latestRun.critical || a.failures ? "crit" : "warn"}>{a.latestRun.critical || a.failures ? "failing" : "finding"}</Pill>
                    </Link>
                  </li>
                ))}
              </ol>
              {failing.length > 3 && (
                <div className="border-t border-line px-6 py-3 text-[12.5px]">
                  <Link href={`${run}?tab=failures`}>View all {int(failing.length)} failing risk areas →</Link>
                </div>
              )}
            </Card>
          ) : (
            !worst && (
              <Card>
                <div className="text-[15px] font-medium">No failing risk areas in this version&apos;s tests.</div>
                <p className="mt-1 text-[13px] text-ink-3">
                  {int(c.episodes)} tests in the latest run, {int(c.criticalEpisodes)} critical failures. {thin ? "That is not yet enough evidence to deploy on." : ""}
                </p>
                <div className="mt-3">
                  <Link href={run} className="text-[13px] text-accent-ink">
                    Open the run →
                  </Link>
                </div>
              </Card>
            )
          )}
          <p className="mt-2 text-[11.5px] text-ink-3">Risk-area counts cover every run of this agent version. The latest run alone: {int(c.criticalEpisodes)} critical, {int(c.failingEpisodes)} failing, of {int(c.episodes)} tests.</p>
        </section>

        <section className="xl:col-span-4">
          <h2 className="eyebrow mb-3">Test coverage</h2>
          <Card padded={false}>
            <ul>
              {areas.map((a) => {
                const s = a.axis.status;
                const glyph = (a.failures > 0 || a.latestRun.critical > 0) && s === "measured" ? { g: "✕", word: "Failing", cls: "text-crit-ink" } : s === "measured" ? { g: "✓", word: "Sufficient", cls: "text-good-ink" } : s === "insufficient" ? { g: "!", word: "Needs more tests", cls: "text-warn-ink" } : { g: "–", word: "Not tested", cls: "text-ink-3" };
                return (
                  <li key={a.key} className="flex items-center justify-between gap-3 border-b border-line px-5 py-2.5 text-[13px] last:border-0" title={a.hint}>
                    <span>{a.label}</span>
                    <span className={`flex items-center gap-1.5 ${glyph.cls}`}>
                      <span aria-hidden className="w-3 text-center">{glyph.g}</span>
                      {glyph.word}
                      <span className="tabular text-[11.5px] text-ink-3">{a.trials ? ` ${int(a.trials)}` : ""}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
          <p className="mt-2 text-[11.5px] text-ink-3">
            A risk area counts once it has {CONFIG.minFamilyTrials} tests. <Link href={run}>Full breakdown on the run →</Link>
          </p>
        </section>
      </div>

      {/* ---- row 3: recent tests ------------------------------------------ */}
      <section>
        <h2 className="eyebrow mb-3">Recent tests · {agentDisplay(latest.agent.name)}</h2>
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap">
              <thead>
                <tr>
                  <th className="pl-6">version</th>
                  <th className="text-right">safety</th>
                  <th className="text-right">coverage</th>
                  <th className="text-right">critical</th>
                  <th>status</th>
                  <th className="pr-6 text-right">tested</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => {
                  const record = recordsById.get(r.id);
                  const versionAxes = axesByVersion.get(r.agent.version);
                  const rd = record && versionAxes && gt ? readiness(r, gateByAgent.get(agentKey(r)), record.grades, versionAxes) : null;
                  const cov = versionAxes ? coverageConfidence(versionAxes) : null;
                  const critical = record ? counts(record.grades).criticalEpisodes : null;
                  return (
                    <tr key={r.id} className="row-link">
                      <td className="pl-6">
                        <Link href={`/labs/tests/${r.id}`} className="font-medium">
                          {agentVersionLabel(r)}
                        </Link>
                        <span className="ml-2 text-[11.5px] text-ink-3">{suiteName(r.suite.id).name}</span>
                      </td>
                      <td className="text-right tabular">
                        {r.axes.safety.score} <span className="text-[11px] text-ink-3">n={int(r.axes.safety.sampleSize)}</span>
                      </td>
                      <td className="text-right tabular">{cov ? `${cov.pct}%` : "–"}</td>
                      <td className={`text-right tabular ${critical ? "text-crit-ink" : ""}`}>{critical === null ? "–" : int(critical)}</td>
                      <td>
                        <StateBadge state={rd?.state ?? "NONE"} label={rd ? rd.state === "REVIEW" ? "REVIEW REQUIRED" : undefined : "UNAVAILABLE"} />
                      </td>
                      <td className="pr-6 text-right text-ink-3">{ago(r.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <p className="mt-2 text-[11.5px] text-ink-3">
          Coverage and release gates reflect the current evidence for each version. Critical failures count test executions, not individual findings. Ready only when the run clears the bar on its own (safety ≥ {CONFIG.minSafety}, no critical failure, ≥ {CONFIG.minEpisodes} tests, required risk areas covered) and the regression gate passes. <Link href="/labs/tests">All tests →</Link>
        </p>
      </section>
    </>
  );
}

// ---- pieces ----------------------------------------------------------------------

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub: string; tone: "good" | "warn" | "crit" | "neutral" }) {
  const cls = tone === "good" ? "text-ink" : tone === "warn" ? "text-warn-ink" : tone === "crit" ? "text-crit-ink" : "text-ink";
  return (
    <div>
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className={`mt-1 text-[28px] font-semibold leading-none tabular tracking-[-0.01em] ${cls}`}>{value}</dd>
      <dd className="mt-1.5 text-[11.5px] text-ink-3">{sub}</dd>
    </div>
  );
}

/** A headline for a scenario whose definition is not served (held out), from the worst finding's code. */
function headline(g: EpisodeGrade): string {
  const v = g.violations.find((x) => x.severity === "critical") ?? g.violations[0];
  const words = (v?.code ?? `did ${g.effective} instead of ${g.expected}`).replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What the most important failure was, in plain words, from the grader's own detail. */
function describe(g: EpisodeGrade): string {
  const v = g.violations.find((x) => x.severity === "critical") ?? g.violations[0];
  if (v?.detail) return v.detail;
  return `The correct action was to ${g.expected}; the agent did ${g.effective}.`;
}

async function titleOf(g: EpisodeGrade): Promise<string | null> {
  const { scenario, ApiError } = await import("@/lib/api");
  try {
    return (await scenario(g.scenarioId)).title;
  } catch (e) {
    if (e instanceof ApiError) return null;
    throw e;
  }
}

type Step = { title: string; reason?: string; href: string; tone: "crit" | "warn" | "accent" };

function nextSteps(x: { ready: Readiness; gate: GateRecord | undefined; worst: EpisodeGrade | undefined; run: string; failing: { label: string }[]; axes: { label: string; status: string }[]; pending: number; shadow: number }): Step[] {
  const out: Step[] = [];
  if (x.failing.length) out.push({ title: `Fix ${x.failing[0].label.toLowerCase()}`, reason: x.failing.length > 1 ? `then ${x.failing.slice(1, 3).map((f) => f.label.toLowerCase()).join(" and ")}` : "the top failing risk area", href: `${x.run}?tab=failures`, tone: "crit" });
  if (x.worst) out.push({ title: "Replay the most important failure", reason: "see the exact step where it went wrong", href: `${x.run}/scenarios/${x.worst.scenarioId}?trial=${x.worst.trial}`, tone: "crit" });
  const thin = x.axes.filter((a) => a.status !== "measured");
  if (thin.length) out.push({ title: `Run more tests in ${thin.length} risk area${thin.length === 1 ? "" : "s"}`, reason: thin.slice(0, 3).map((a) => a.label.toLowerCase()).join(", ") + (thin.length > 3 ? ", …" : ""), href: "/labs/tests", tone: "warn" });
  if (x.gate?.verdict === "fail") out.push({ title: "Review the release gate", reason: "it found regressions against the baseline", href: `/labs/releases/${x.gate.id}`, tone: "crit" });
  else if (!x.gate) out.push({ title: "Run the release gate", reason: "compare this version against the sealed baseline", href: "/labs/releases", tone: "accent" });
  if (x.pending) out.push({ title: `Review ${int(x.pending)} incident candidate${x.pending === 1 ? "" : "s"}`, reason: "production signals waiting to become tests", href: "/incidents", tone: "warn" });
  if (x.shadow > 0) out.push({ title: `Review ${int(x.shadow)} shadow disagreement${x.shadow === 1 ? "" : "s"}`, href: "/production", tone: "warn" });
  if (x.ready.state === "READY") out.push({ title: "Observe it in Shadow Mode", reason: "real decisions, nothing blocked", href: "/production", tone: "accent" });
  out.push({ title: "Compare models and configurations", reason: "same tests, different subject", href: "/labs/arena", tone: "accent" });
  return out.slice(0, 5);
}
