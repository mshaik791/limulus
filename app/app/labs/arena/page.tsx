import Link from "next/link";
import { compare, compares, referenceAgents } from "@/lib/api";
import { safe } from "@/lib/safe";
import { int, ms, ofN, pct, when } from "@/lib/format";
import { suiteName } from "@/lib/names";
import { ArmSwatch } from "@/components/charts";
import { Button, Card, EmptyState, EnvBar, Note, Offline, PageHeader, Pill, Rate, StateBadge } from "@/components/ui";
import { startCompare } from "./actions";

export const metadata = { title: "Model Arena" };

// Compare configurations under identical conditions. The hero is the latest
// comparison as cards, one per arm, with the recommended one marked and the
// rule beside it. Cost is not on the chart because the engine does not
// measure spend; duration per episode is, and is shown.

export default async function Arena(props: PageProps<"/labs/arena">) {
  const search = await props.searchParams;
  const [list, agents] = await Promise.all([safe(compares()), safe(referenceAgents())]);
  if (!list) return <Offline />;
  const rows = [...list].reverse();
  // The list omits per-scenario verdicts; the hero needs them for pass rates.
  const latest = rows[0] ? await safe(compare(rows[0].id)) : null;
  const error = typeof search.error === "string" ? search.error : null;

  return (
    <>
      <PageHeader title="Model Arena" subtitle="Compare financial-agent configurations under identical conditions." />
      <EnvBar />
      {error && <Note tone="crit">{error === "two-arms" ? "A comparison needs at least two arms." : `The engine refused the comparison: ${error}`}</Note>}

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="grid content-start gap-4 xl:col-span-8">
          {latest ? (
            <Card title="Which configuration should you deploy?" aside={`${suiteName(latest.suite.id).name} · ${int(latest.suite.scenarioCount)} scenarios × ${latest.suite.trials} trials · ${when(latest.createdAt)}`} emphasis="model">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {latest.arms.map((a, i) => {
                  const scen = Object.values(a.scenarios ?? {});
                  const passed = scen.filter((s) => s.verdict === "pass").length;
                  const rec = latest.recommendation.label === a.label;
                  return (
                    <div key={a.label} className={`rounded-[var(--radius)] border p-4 ${rec ? "border-model/60 bg-model-soft [box-shadow:var(--glow-model)]" : "border-line bg-surface-2"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="break-words text-[14px] font-semibold leading-snug">
                            <ArmSwatch index={i} /> <span className="ml-1">{a.label}</span>
                          </div>
                          <div className="break-words text-[11.5px] text-ink-3">{a.agent.subject.model ?? `${a.agent.name} v${a.agent.version}`}</div>
                        </div>
                        {rec && (
                          <span className="shrink-0">
                            <StateBadge state="READY" label="RECOMMENDED" />
                          </span>
                        )}
                      </div>
                      <div className="mt-4 grid gap-2.5 text-[12.5px]">
                        <Row label="Safety" value={<Rate score={a.axes.safety.score} n={a.axes.safety.n} />} pct={a.axes.safety.n ? a.axes.safety.score : null} tone="accent" />
                        <Row label="Pass rate" value={<span className="tabular">{pct(passed, scen.length)} · {ofN(passed, scen.length)}</span>} pct={scen.length ? (passed / scen.length) * 100 : null} tone="good" />
                        <Row label="Critical" value={<span className={`tabular ${a.criticalViolations ? "text-crit-ink" : ""}`}>{int(a.criticalViolations)} in {int(a.episodes)}</span>} pct={a.episodes ? Math.min(100, (a.criticalViolations / a.episodes) * 100) : null} tone="crit" />
                        <div className="flex justify-between text-ink-3">
                          <span>gate</span>
                          <Pill tone={a.controls.mode === "enforced" ? "good" : a.controls.mode === "advisory" ? "warn" : "neutral"}>{a.controls.mode}</Pill>
                        </div>
                        <div className="flex justify-between text-ink-3">
                          <span>per episode</span>
                          <span className="tabular text-ink-2">{a.episodes ? ms(a.durationMs / a.episodes) : "–"}</span>
                        </div>
                        <div className="flex justify-between text-ink-3">
                          <span>est. cost</span>
                          <span>not measured</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 border-t border-line pt-3 text-[13px]">
                <span className="text-ink-3">Recommended </span>
                {latest.recommendation.label ? <span className="text-model-ink">{latest.recommendation.label}</span> : <span className="text-warn-ink">none</span>}
                <span className="text-ink-2"> · {latest.recommendation.reason}</span>
                <p className="mt-1 text-[11.5px] text-ink-3">rule: {latest.recommendation.rule}</p>
              </div>
              <div className="mt-3">
                <Link href={`/labs/arena/${latest.id}`} className="text-[13px] text-accent-ink">
                  Open the full comparison →
                </Link>
              </div>
            </Card>
          ) : (
            <EmptyState title="No comparison yet." body="Put two configurations on identical scenarios and get one signed record that says which held up and why." />
          )}

          {rows.length > 1 && (
            <Card title="Previous comparisons" aside={`${int(rows.length - 1)}`}>
              <div className="grid gap-2 md:grid-cols-2">
                {rows.slice(1, 9).map((c) => (
                  <Link key={c.id} href={`/labs/arena/${c.id}`} className="rounded-[var(--radius-sm)] border border-line bg-surface-2 px-3 py-2.5 transition-colors hover:border-line-hover">
                    <div className="flex items-baseline justify-between gap-2 text-[13px]">
                      <span>{when(c.createdAt)}</span>
                      <span className="text-[11.5px] text-ink-3">{suiteName(c.suite.id).name}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {c.arms.map((a) => (
                        <Pill key={a.label} tone={a.criticalViolations ? "crit" : "good"}>
                          {a.label} · {int(a.criticalViolations)}
                        </Pill>
                      ))}
                    </div>
                    <div className="mt-1 text-[12px] text-ink-3">recommended {c.recommendation.label ?? "none"}</div>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="xl:col-span-4">
          <Card title="Run Comparison" className="h-full">
            <form action={startCompare} className="grid gap-3 text-[13px]">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr] gap-2">
                  <select name={`agent${i}`} defaultValue={i === 1 ? "careful" : i === 2 ? "naive" : ""} aria-label={`arm ${i} agent`} className="w-full min-w-0">
                    <option value="">{i > 2 ? "no arm" : "agent"}</option>
                    {(agents ?? []).map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <select name={`controls${i}`} defaultValue={i === 2 ? "enforced" : "off"} aria-label={`arm ${i} gate`} className="w-full min-w-0">
                    <option value="off">gate off</option>
                    <option value="advisory">gate advisory</option>
                    <option value="enforced">gate enforced</option>
                  </select>
                </div>
              ))}
              <label className="grid grid-cols-[1fr_80px] items-center gap-2">
                <span className="text-ink-3">scenario suite</span>
                <span className="text-right text-ink-2">open pool</span>
              </label>
              <label className="grid grid-cols-[1fr_80px] items-center gap-2">
                <span className="text-ink-3">trials per scenario</span>
                <input type="number" name="trials" min={1} max={30} defaultValue={3} />
              </label>
              <Button tone="accent">Run Comparison</Button>
              <p className="text-[11.5px] text-ink-3">Every arm runs the identical scenarios in the sandbox and one record is sealed. To compare your own endpoints, prompt versions or models, use the CLI with a URL per arm:</p>
              <pre className="mono overflow-x-auto rounded-[var(--radius-sm)] bg-sunken p-2.5 text-[11px] text-ink-2">node src/lab-cli.ts compare http://a/agent:off http://b/agent:off</pre>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, value, pct: p, tone }: { label: string; value: React.ReactNode; pct: number | null; tone: "accent" | "good" | "crit" }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-ink-3">{label}</span>
        <span>{value}</span>
      </div>
      <div className="mt-1 h-[4px] overflow-hidden rounded-full bg-surface-3">{p !== null && <div className="h-full rounded-full" style={{ width: `${Math.max(1, p)}%`, background: `var(--${tone})` }} />}</div>
    </div>
  );
}
