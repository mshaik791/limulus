import Link from "next/link";
import { AlertOctagon, FlaskConical, PlayCircle, ShieldCheck } from "lucide-react";
import { gates, labRuns } from "@/lib/api";
import { safe } from "@/lib/safe";
import { int, ms, when, withinDays } from "@/lib/format";
import { agentDisplay, suiteName } from "@/lib/names";
import { MetricCard } from "@/components/blocks";
import { Card, EmptyState, EnvBar, Offline, PageHeader, Pill, Rate, StateBadge } from "@/components/ui";

export const metadata = { title: "Test Runs" };

// Every Lab run, filterable. Suites and agents get their human names; the raw
// identifiers stay in the tooltip and on the run page.

export default async function TestRuns(props: PageProps<"/labs/tests">) {
  const search = await props.searchParams;
  const [runs, gt] = await Promise.all([safe(labRuns()), safe(gates())]);
  if (!runs) return <Offline />;
  const f = { agent: str(search.agent), suite: str(search.suite), gate: str(search.gate), q: str(search.q).toLowerCase() };
  const gateByRun = new Map((gt ?? []).map((g) => [g.runId, g]));

  const rows = [...runs]
    .reverse()
    .filter((r) => !f.agent || r.agent.name === f.agent)
    .filter((r) => !f.suite || suiteName(r.suite.id).name === f.suite)
    .filter((r) => !f.gate || r.controls.mode === f.gate)
    .filter((r) => !f.q || `${r.id} ${r.agent.name} ${r.agent.version} ${r.suite.id}`.toLowerCase().includes(f.q));

  const thisWeek = runs.filter((r) => withinDays(r.createdAt, 7));
  const episodes = thisWeek.reduce((n, r) => n + r.suite.episodes, 0);
  const safetyN = thisWeek.reduce((n, r) => n + r.axes.safety.sampleSize, 0);
  const safetyMean = safetyN ? Math.round(thisWeek.reduce((n, r) => n + r.axes.safety.score * r.axes.safety.sampleSize, 0) / safetyN) : null;
  const criticals = thisWeek.reduce((n, r) => n + r.axes.criticalViolations.length, 0);
  const agents = [...new Set(runs.map((r) => r.agent.name))];
  const suites = [...new Set(runs.map((r) => suiteName(r.suite.id).name))];

  return (
    <>
      <PageHeader title="Test Runs" subtitle="Every Lab run on record. Each row is a signed record; open one for its grades and traces." />
      <EnvBar />

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard icon={PlayCircle} label="Runs this week" value={int(thisWeek.length)} sub={`${int(runs.length)} on record`} />
        <MetricCard icon={FlaskConical} label="Scenarios executed this week" value={int(episodes)} sub="episodes graded" />
        <MetricCard icon={ShieldCheck} label="Average safety this week" value={<Rate score={safetyMean} n={safetyN} />} sub="weighted by episodes" />
        <MetricCard icon={AlertOctagon} label="Critical violations this week" value={int(criticals)} tone={criticals ? "crit" : "good"} sub="attempted, sandbox only" />
      </div>

      <form className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
        <select name="agent" defaultValue={f.agent} aria-label="agent">
          <option value="">all agents</option>
          {agents.map((a) => (
            <option key={a} value={a}>
              {agentDisplay(a)}
            </option>
          ))}
        </select>
        <select name="suite" defaultValue={f.suite} aria-label="suite">
          <option value="">all suites</option>
          {suites.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select name="gate" defaultValue={f.gate} aria-label="gate mode">
          <option value="">any gate mode</option>
          <option value="off">gate off</option>
          <option value="advisory">gate advisory</option>
          <option value="enforced">gate enforced</option>
        </select>
        <input name="q" defaultValue={f.q} placeholder="search id, agent, suite" className="w-[220px]" />
        <button className="rounded-[var(--radius-sm)] border border-line-2 bg-surface-2 px-3 py-1.5">Filter</button>
        {(f.agent || f.suite || f.gate || f.q) && (
          <Link href="/labs/tests" className="text-[12px] text-ink-3">
            clear
          </Link>
        )}
        <span className="ml-auto text-[12px] text-ink-3">{int(rows.length)} run(s)</span>
      </form>

      {rows.length === 0 ? (
        <EmptyState title={runs.length ? "No runs match those filters." : "No test runs yet."} body={runs.length ? undefined : "Connect an agent and run your first suite."} cta={runs.length ? undefined : "Run Simulation"} ctaHref="/labs" />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap">
              <thead>
                <tr>
                  <th className="pl-6">run</th>
                  <th>agent</th>
                  <th>suite</th>
                  <th className="text-right">safety</th>
                  <th className="text-right">episodes</th>
                  <th className="text-right">critical</th>
                  <th>gate</th>
                  <th>release</th>
                  <th className="pr-6 text-right">time</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const crit = r.axes.criticalViolations.length;
                  const g = gateByRun.get(r.id);
                  const suite = suiteName(r.suite.id);
                  return (
                    <tr key={r.id} className="row-link">
                      <td className="pl-6">
                        <Link href={`/labs/tests/${r.id}`} className="font-medium">
                          {when(r.createdAt)}
                        </Link>
                        <div className="mono text-[11px] text-ink-3">{r.id}</div>
                      </td>
                      <td>
                        {agentDisplay(r.agent.name)}
                        <div className="text-[11.5px] text-ink-3">v{r.agent.version}</div>
                      </td>
                      <td>
                        <span title={suite.raw}>{suite.name}</span>
                        <div className="text-[11.5px] text-ink-3">
                          {int(r.suite.scenarioCount)} × {r.suite.trials}
                          {r.pool === "held-out" ? " · held-out" : ""}
                        </div>
                      </td>
                      <td className="text-right">
                        <Rate score={r.axes.safety.score} n={r.axes.safety.sampleSize} />
                      </td>
                      <td className="text-right tabular text-ink-2">{int(r.suite.episodes)}</td>
                      <td className={`text-right tabular ${crit ? "text-crit-ink" : ""}`}>{int(crit)}</td>
                      <td>
                        <Pill tone={r.controls.mode === "enforced" ? "good" : r.controls.mode === "advisory" ? "warn" : "neutral"}>{r.controls.mode}</Pill>
                      </td>
                      <td>{g ? <StateBadge state={g.verdict === "pass" ? "READY" : g.verdict === "fail" ? "BLOCKED" : "OVERRIDDEN"} /> : <span className="text-[12px] text-ink-3">no gate</span>}</td>
                      <td className="pr-6 text-right tabular text-ink-3">{ms(r.durationMs)}</td>
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

const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
