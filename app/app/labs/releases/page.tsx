import Link from "next/link";
import { gates, labRun, labRuns, profile } from "@/lib/api";
import { safe } from "@/lib/safe";
import { CONFIG } from "@/lib/config";
import { absoluteQualification, counts, familyAxes, plainReadiness, readiness, regressionGate } from "@/lib/derive";
import { day, int, when } from "@/lib/format";
import { agentDisplay, agentRaw, suiteName } from "@/lib/names";
import { Card, Delta, EmptyState, LinkButton, Offline, PageHeader, Pill, StateBadge } from "@/components/ui";

export const metadata = { title: "Releases" };

// Two questions with two answers, then one decision. The regression gate asks
// whether the candidate is worse than the baseline; the absolute qualification
// asks whether the candidate clears the configured bar on its own. Final
// release is READY only when both pass, so a candidate at safety 50 is not
// ready because the baseline was also 50.

export default async function Releases() {
  const [list, runs] = await Promise.all([safe(gates()), safe(labRuns())]);
  if (!list || !runs) return <Offline />;
  const rows = [...list].reverse();
  const g = rows[0];
  const run = g ? (runs.find((r) => r.id === g.runId) ?? null) : null;
  const full = run ? await safe(labRun(run.id)) : null;
  const prof = run ? await safe(profile(run.agent.name, run.agent.version)) : null;
  const axes = familyAxes(prof?.nodes ?? []);
  const grades = full?.grades.filter((x) => !x.unusable) ?? null;
  const absolute = run ? absoluteQualification(run, grades, axes) : null;
  const regression = regressionGate(g);
  const final = run ? readiness(run, g, grades, axes) : null;

  return (
    <>
      <PageHeader title="Releases" subtitle="Can this version ship? Ready only when it clears the bar on its own and is no worse than what shipped." />
      {!g ? (
        <EmptyState title="No gate has run." body="The gate runs in CI or from the CLI against a committed baseline, and seals a record every time." code="node src/bench/ci-gate.ts --scenarios scenarios --agent careful" />
      ) : (
        <>
          <section className="mb-8 rounded-[var(--radius)] border border-line bg-surface px-8 py-7">
            <div className="eyebrow">Release decision</div>
            <div className="mt-3">
              <StateBadge state={final?.state ?? "NONE"} label={final?.state === "READY" ? "READY TO SHIP" : final?.state === "BLOCKED" ? "DEPLOYMENT BLOCKED" : "REVIEW REQUIRED"} size="lg" />
            </div>
            <div className="mt-4 text-[22px] font-semibold leading-tight tracking-[-0.01em]">
              {agentDisplay(g.agent.name)} v{g.agent.version}
            </div>
            <div className="mt-1 text-[13px] text-ink-3">
              candidate · {suiteName(g.suite.id).name} · gate run {when(g.createdAt)}
            </div>
            <dl className="mt-7 grid grid-cols-2 gap-6 md:grid-cols-4">
              <div>
                <dt className="text-[12px] text-ink-3">Regression gate</dt>
                <dd className="mt-1.5">
                  <StateBadge state={regression?.verdict === "pass" ? "PASS" : regression?.verdict === "overridden" ? "OVERRIDDEN" : "FAIL"} />
                </dd>
                <dd className="mt-1.5 text-[11.5px] text-ink-3">no worse than the baseline</dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-3">Absolute qualification</dt>
                <dd className="mt-1.5">{absolute ? <StateBadge state={absolute.pass ? "PASS" : "FAIL"} /> : <span className="text-[12px] text-ink-3">run not found</span>}</dd>
                <dd className="mt-1.5 text-[11.5px] text-ink-3">clears the bar on its own</dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-3">Safety</dt>
                <dd className="mt-1 text-[28px] font-semibold leading-none tabular text-ink">{g.axes.safety?.now ?? "–"}</dd>
                <dd className="mt-1.5 text-[11.5px] text-ink-3">baseline {g.axes.safety?.baseline ?? "–"} · required ≥ {CONFIG.minSafety}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-3">New critical failures</dt>
                <dd className="mt-1 flex items-baseline gap-2">
                  <span className="text-[28px] font-semibold leading-none tabular text-ink">{int(g.newCriticals.length)}</span>
                  {g.newCriticals.length ? <Pill tone="crit">new critical</Pill> : null}
                </dd>
                <dd className="mt-1.5 text-[11.5px] text-ink-3">against the baseline</dd>
              </div>
            </dl>
            <p className="mt-6 text-[15px] leading-relaxed">{final ? plainReadiness(final, grades ? counts(grades) : null, g) : "The run this gate scored is no longer in the run list."}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <LinkButton href={`/labs/tests/${g.runId}?tab=failures`} tone={final?.state === "BLOCKED" ? "crit" : "neutral"}>
                Review Failures
              </LinkButton>
              <LinkButton href={`/labs/releases/${g.id}`}>{g.verdict === "fail" ? "Override Gate" : "Open the gate record"}</LinkButton>
            </div>
            {g.verdict === "fail" && <p className="mt-3 text-[11.5px] text-ink-3">An override is an expiring record with an author and a reason. It never covers a new critical failure, and it never satisfies the absolute qualification.</p>}
          </section>

          <h2 className="eyebrow mb-3">How it was decided</h2>
          <div className="mb-5 grid gap-4 xl:grid-cols-12">
            <div className="grid gap-4 xl:col-span-12">
              <Card title="Baseline against candidate" aside={`${suiteName(g.suite.id).name} · ${when(g.createdAt)}`}>
                <div className="grid gap-6 md:grid-cols-[1fr_auto_1fr]">
                  <div>
                    <div className="eyebrow">Baseline</div>
                    <div className="mt-1 text-[15px]">
                      {agentDisplay(g.agent.name)} <span className="text-ink-3">· written {day(g.baseline.updatedAt)}</span>
                    </div>
                    <div className="mt-2 text-[44px] font-semibold leading-none tabular tracking-[-0.02em]">{g.axes.safety?.baseline ?? "–"}</div>
                    <div className="text-[12px] text-ink-3">safety at {g.baseline.trials} trials</div>
                  </div>
                  <div className="self-center text-center">
                    <div className="text-[28px] text-ink-3">→</div>
                    <div className="text-[13px]">
                      <Delta value={g.axes.safety?.baseline !== null && g.axes.safety?.now !== null ? g.axes.safety.now - g.axes.safety.baseline : null} />
                    </div>
                  </div>
                  <div>
                    <div className="eyebrow">Candidate</div>
                    <div className="mt-1 text-[15px]">
                      {agentDisplay(g.agent.name)} <span className="mono text-ink-3">{agentRaw(g.agent.name, g.agent.version)}</span>
                    </div>
                    <div className="mt-2 text-[44px] font-semibold leading-none tabular tracking-[-0.02em] text-ink">{g.axes.safety?.now ?? "–"}</div>
                    <div className="text-[12px] text-ink-3">safety at {g.suite.trials} trials · required ≥ {CONFIG.minSafety}</div>
                  </div>
                </div>
                <div className="mt-6 grid gap-x-8 gap-y-2 border-t border-line pt-4 md:grid-cols-2">
                  {Object.entries(g.axes).map(([axis, v]) => (
                    <div key={axis} className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="capitalize text-ink-2">{axis}</span>
                      <span className="tabular">
                        {v.baseline ?? "–"} → {v.now ?? "–"} <Delta value={v.baseline !== null && v.now !== null ? v.now - v.baseline : null} />
                      </span>
                    </div>
                  ))}
                </div>
              </Card>

              <div className="grid gap-4 md:grid-cols-2">
                <Card title="Regression gate" emphasis={regression?.pass ? "good" : "crit"}>
                  <StateBadge state={regression?.verdict === "pass" ? "PASS" : regression?.verdict === "overridden" ? "OVERRIDDEN" : "FAIL"} size="lg" />
                  <p className="mt-2 text-[13px] text-ink-2">{regression?.pass ? "No degradation from the baseline." : "Worse than the baseline."}</p>
                  <ul className="mt-3 grid gap-1.5">
                    {regression?.criteria.map((x) => (
                      <li key={x.label} className="grid grid-cols-[max-content_1fr] items-start gap-2 text-[12.5px]">
                        <Pill tone={x.ok ? "good" : "crit"}>{x.ok ? "ok" : "fail"}</Pill>
                        <span>
                          {x.label} <span className="text-ink-3">· {x.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
                <Card title="Absolute qualification" emphasis={absolute?.pass ? "good" : "crit"}>
                  {absolute ? (
                    <>
                      <StateBadge state={absolute.pass ? "PASS" : "FAIL"} size="lg" />
                      <p className="mt-2 text-[13px] text-ink-2">{absolute.pass ? "Clears the configured bar on its own." : absolute.criteria.filter((x) => !x.ok).map((x) => `${x.label}: ${x.detail}.`).join(" ")}</p>
                      <ul className="mt-3 grid gap-1.5">
                        {absolute.criteria.map((x) => (
                          <li key={x.label} className="grid grid-cols-[max-content_1fr] items-start gap-2 text-[12.5px]">
                            <Pill tone={x.ok ? "good" : "crit"}>{x.ok ? "ok" : "fail"}</Pill>
                            <span>
                              {x.label} <span className="text-ink-3">· {x.detail}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-3 text-[11px] text-ink-3">Criteria are {CONFIG.source}.</p>
                    </>
                  ) : (
                    <p className="text-[13px] text-ink-3">The run this gate scored is no longer in the run list.</p>
                  )}
                </Card>
              </div>
            </div>

          </div>

          <Card title="Release history" aside={`${int(rows.length)} gate run(s) · regression verdicts only; the absolute bar is evaluated above for the latest`} padded={false}>
            <ol>
              {rows.map((r) => (
                <li key={r.id} className="flex items-center gap-4 border-b border-line px-6 py-3 last:border-0 hover:bg-surface-2">
                  <StateBadge state={r.verdict === "pass" ? "PASS" : r.verdict === "fail" ? "FAIL" : "OVERRIDDEN"} label={`GATE ${r.verdict.toUpperCase()}`} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/labs/releases/${r.id}`} className="text-[13px] font-medium">
                      {agentDisplay(r.agent.name)} <span className="mono font-normal text-ink-3">{agentRaw(r.agent.name, r.agent.version)}</span>
                    </Link>
                    <div className="truncate text-[12px] text-ink-3" title={r.suite.id}>
                      {when(r.createdAt)} · {suiteName(r.suite.id).name} · {int(r.suite.scenarioCount)} × {r.suite.trials}
                      {r.override ? ` · overridden by ${r.override.actor}` : ""}
                    </div>
                  </div>
                  <div className="hidden text-[12px] tabular text-ink-2 md:block">
                    safety {r.axes.safety?.baseline ?? "–"} → {r.axes.safety?.now ?? "–"}
                  </div>
                  <div className={`w-[130px] text-right text-[12px] tabular ${r.newCriticals.length ? "text-crit-ink" : "text-ink-3"}`}>{int(r.newCriticals.length)} new critical</div>
                </li>
              ))}
            </ol>
          </Card>
        </>
      )}
    </>
  );
}
