import Link from "next/link";
import { candidates, compares, gates, labRuns, records, shadowRecords } from "@/lib/api";
import { activity } from "@/lib/activity";
import { safe } from "@/lib/safe";
import { agentKey, readiness } from "@/lib/derive";
import { ago, int, ms, when } from "@/lib/format";
import { agentDisplay, agentTitle, agentVersionLabel, suiteName } from "@/lib/names";
import { ActivityFeed } from "@/components/blocks";
import { Card, EmptyState, EnvBar, Offline, PageHeader, Pill, Rate, StateBadge } from "@/components/ui";

export const metadata = { title: "Tests" };

// Every Lab run, filterable. Suites and agents get their human names; the raw
// identifiers stay in the tooltip and on the run page.

export default async function TestRuns(props: PageProps<"/labs/tests">) {
  const search = await props.searchParams;
  const [runs, gt, cmp, shadowRows, cands, chain] = await Promise.all([safe(labRuns()), safe(gates()), safe(compares()), safe(shadowRecords()), safe(candidates()), safe(records())]);
  if (!runs) return <Offline />;
  const feed = activity({ runs, gates: gt ?? [], compares: cmp ?? [], shadow: shadowRows ?? [], candidates: cands ?? [], decisions: chain ?? [] }, 12);
  const f = { agent: str(search.agent), suite: str(search.suite), gate: str(search.gate), q: str(search.q).toLowerCase() };
  const gateByRun = new Map((gt ?? []).map((g) => [g.runId, g]));

  const rows = [...runs]
    .reverse()
    .filter((r) => !f.agent || r.agent.name === f.agent)
    .filter((r) => !f.suite || suiteName(r.suite.id).name === f.suite)
    .filter((r) => !f.gate || r.controls.mode === f.gate)
    .filter((r) => !f.q || `${r.id} ${r.agent.name} ${r.agent.version} ${r.suite.id}`.toLowerCase().includes(f.q));

  // The headline is the latest run in view: its agent, result and status.
  const last = rows[0];
  const lastGate = last ? (gt ?? []).filter((g) => `${g.agent.name}@${g.agent.version}` === agentKey(last)).at(-1) : undefined;
  const lastReady = last ? readiness(last, lastGate) : null;
  const agents = [...new Set(runs.map((r) => r.agent.name))];
  const suites = [...new Set(runs.map((r) => suiteName(r.suite.id).name))];

  return (
    <>
      <PageHeader title="Tests" subtitle="How did the agent perform? Every run is a signed record; open one for its grades and traces." />
      <EnvBar />

      {last && lastReady && (
        <div className="mb-6 flex flex-wrap items-end gap-x-10 gap-y-4">
          <div>
            <div className="text-[12px] text-ink-3">Latest {f.agent || f.suite || f.gate || f.q ? "in this view" : "test"}</div>
            <div className="mt-1 text-[20px] font-semibold leading-tight">
              <Link href={`/labs/tests/${last.id}`}>{agentTitle(last)}</Link> <span className="text-[14px] font-normal text-ink-3">{suiteName(last.suite.id).name} · {ago(last.createdAt)}</span>
            </div>
          </div>
          <div>
            <div className="text-[12px] text-ink-3">Safety</div>
            <div className="mt-1 text-[24px] font-semibold leading-none tabular">
              <Rate score={last.axes.safety.score} n={last.axes.safety.sampleSize} />
            </div>
          </div>
          <div>
            <div className="text-[12px] text-ink-3">Critical findings</div>
            <div className="mt-1 text-[24px] font-semibold leading-none tabular">{int(last.axes.criticalViolations.length)}</div>
          </div>
          <div>
            <div className="text-[12px] text-ink-3">Tests run</div>
            <div className="mt-1 text-[24px] font-semibold leading-none tabular">{int(last.suite.episodes)}</div>
          </div>
          <div>
            <div className="text-[12px] text-ink-3">Status</div>
            <div className="mt-1.5">
              <StateBadge state={lastReady.state} label={lastReady.state === "REVIEW" ? "REVIEW REQUIRED" : lastReady.state === "BLOCKED" ? "BLOCKED" : lastReady.state === "READY" ? "READY" : "NOT TESTED"} size="lg" />
            </div>
          </div>
        </div>
      )}

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
                  <th className="pl-6">test</th>
                  <th>agent</th>
                  <th>suite</th>
                  <th className="text-right">safety</th>
                  <th className="text-right">tests run</th>
                  <th className="text-right">critical findings</th>
                  <th>gate</th>
                  <th>status</th>
                  <th className="pr-6 text-right">took</th>
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
                        <div className="text-[11px] text-ink-3">{ago(r.createdAt)}</div>
                      </td>
                      <td>
                        {agentDisplay(r.agent.name)}
                        <div className="text-[11px] text-ink-3" title={r.id}>{agentVersionLabel(r)}</div>
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
                      <td className="text-right tabular">{int(crit)}</td>
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

      <div className="mt-6">
        <Card title="Activity" aside={`${int(feed.length)} most recent sealed records`}>
          <ActivityFeed items={feed} empty="Nothing sealed yet." />
        </Card>
      </div>
    </>
  );
}

const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
