import Link from "next/link";
import { compare, compares, referenceAgents, type CompareRecord } from "@/lib/api";
import { safe } from "@/lib/safe";
import { CONFIG, EVIDENCE_LABEL, evidence } from "@/lib/config";
import { int, ms, ofN, pct, when } from "@/lib/format";
import { agentDisplay, modelDisplay, suiteName } from "@/lib/names";
import { ArmSwatch } from "@/components/charts";
import { Button, Card, EmptyState, EnvBar, Note, Offline, PageHeader, Pill, Rate, StateBadge, Tabs } from "@/components/ui";
import { startCompare } from "./actions";

export const metadata = { title: "Model Arena" };

// Two questions, kept apart. MODELS: the same agent, prompts, tools, policy,
// gate and trial count, with only the model behind the endpoint changed. A
// comparison is a model comparison when its arms report at least two distinct
// models. CONFIGURATIONS: everything else, including the reference agents and
// the gate modes, which are not models and are never shown as models.
//
// A recommendation is only eligible with enough evidence. Thresholds are
// configurable defaults and say so on screen.

const isModelComparison = (c: CompareRecord) => new Set(c.arms.map((a) => a.agent.subject.model).filter(Boolean)).size >= 2;

export default async function Arena(props: PageProps<"/labs/arena">) {
  const search = await props.searchParams;
  const tab = search.tab === "configurations" ? "configurations" : "models";
  const [list, agents] = await Promise.all([safe(compares()), safe(referenceAgents())]);
  if (!list) return <Offline />;
  const all = [...list].reverse();
  const models = all.filter(isModelComparison);
  const configs = all.filter((c) => !isModelComparison(c));
  const rows = tab === "models" ? models : configs;
  const latest = rows[0] ? await safe(compare(rows[0].id)) : null;
  const error = typeof search.error === "string" ? search.error : null;

  return (
    <>
      <PageHeader title="Model Arena" subtitle="Which model or configuration performs best? Same tests, same policy, same tools; only the subject changes." />
      <EnvBar />
      {error && <Note tone="crit">{error === "two-arms" ? "A comparison needs at least two arms." : `The engine refused the comparison: ${error}`}</Note>}
      <Tabs
        base="/labs/arena"
        active={tab}
        tabs={[
          { key: "models", label: "Models", count: models.length },
          { key: "configurations", label: "Configurations", count: configs.length },
        ]}
      />

      <div className="mb-4">
        {latest ? (
          <Hero record={latest} mode={tab} />
        ) : tab === "models" ? (
          <EmptyState
            title="No model comparison yet."
            body="A model comparison holds the agent, prompts, tools, policy, gate and trial count constant and changes only the model behind the endpoint. Each endpoint reports its model per step, or the bridge is started with one, so the record carries the identity. Nothing here is hardcoded: models appear when runs report them."
            code={`npm run model-agent -- --models anthropic/claude-sonnet-4.5,openai/gpt-4.1,google/gemini-2.5-pro
node src/lab-cli.ts compare "Claude Sonnet=http://localhost:9100/agent?model=anthropic/claude-sonnet-4.5:off" "GPT-4.1=http://localhost:9100/agent?model=openai/gpt-4.1:off" "Gemini 2.5 Pro=http://localhost:9100/agent?model=google/gemini-2.5-pro:off" --trials 30`}
          />
        ) : (
          <EmptyState title="No configuration comparison yet." body="Put two configurations on identical scenarios and get one signed record that says which held up and why." />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="grid content-start gap-4 xl:col-span-8">
          {rows.length > 1 ? (
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
                        <Pill key={a.label} tone={a.criticalEpisodes ? "crit" : "good"}>
                          {a.label} · {int(a.criticalEpisodes)}
                        </Pill>
                      ))}
                    </div>
                    <div className="mt-1 text-[12px] text-ink-3">engine&apos;s pick {c.recommendation.label ?? "none"}</div>
                  </Link>
                ))}
              </div>
            </Card>
          ) : (
            <Card title="Previous comparisons">
              <p className="text-[13px] text-ink-3">Only one comparison on record in this tab.</p>
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
                        {agentDisplay(a.name)} v{a.version}
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
              <div className="grid grid-cols-[1fr_80px] items-center gap-2">
                <span className="text-ink-3">scenario suite</span>
                <span className="text-right text-ink-2">open pool</span>
              </div>
              <label className="grid grid-cols-[1fr_80px] items-center gap-2">
                <span className="text-ink-3">trials per scenario</span>
                <input type="number" name="trials" min={1} max={30} defaultValue={3} />
              </label>
              <Button tone="accent">Run Comparison</Button>
              <p className="text-[11.5px] text-ink-3">This form compares configurations of the reference agents. For models, prompt versions or your own endpoints, use the CLI with a URL per arm and a label; each arm lands in the Models tab when its endpoint reports a model.</p>
              <pre className="mono overflow-x-auto rounded-[var(--radius-sm)] bg-sunken p-2.5 text-[11px] text-ink-2">{`node src/lab-cli.ts compare "GPT-4.1=http://a/agent:off" "Gemini=http://b/agent:off"`}</pre>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}

function Hero({ record, mode }: { record: CompareRecord; mode: "models" | "configurations" }) {
  const maxEpisodes = Math.max(...record.arms.map((a) => a.episodes));
  const ev = evidence(maxEpisodes);
  const pick = record.arms.find((a) => a.label === record.recommendation.label);
  return (
    <Card title={mode === "models" ? "Which model should you deploy?" : "Which configuration should you deploy?"} aside={`${suiteName(record.suite.id).name} · ${int(record.suite.scenarioCount)} scenarios × ${record.suite.trials} trials · ${when(record.createdAt)}`} emphasis="model">
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
        {record.arms.map((a, i) => {
          const scen = Object.values(a.scenarios ?? {});
          const passed = scen.filter((s) => s.verdict === "pass").length;
          const rec = pick?.label === a.label && ev === "eligible";
          const title = mode === "models" ? (a.agent.subject.model ? a.label : "Unknown model") : a.label;
          const armEv = evidence(a.episodes);
          const sub = mode === "models" ? (a.agent.subject.model ? `${modelDisplay(a.agent.subject.model)} · ${a.agent.subject.source === "configured" ? "configured" : "self-reported by the endpoint"}` : "the endpoint reported no model") : a.agent.subject.model ? modelDisplay(a.agent.subject.model, a.agent.subject.source) : `${agentDisplay(a.agent.name)} v${a.agent.version}`;
          return (
            <div key={a.label} className={`min-w-[240px] rounded-[var(--radius)] border p-4 ${rec ? "border-model/60 bg-model-soft [box-shadow:var(--glow-model)]" : "border-line bg-surface-2"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="break-words text-[15px] font-semibold leading-snug">
                    <ArmSwatch index={i} /> <span className="ml-1">{title}</span>
                  </div>
                  <div className="break-words text-[11.5px] text-ink-3">{sub}</div>
                </div>
                {rec && (
                  <span className="shrink-0">
                    <StateBadge state="READY" label="RECOMMENDED" />
                  </span>
                )}
              </div>
              <div className="mt-4 grid gap-2.5 text-[12.5px]">
                <Row label="Safety score" value={<Rate score={a.axes.safety.score} n={a.axes.safety.n} />} pct={a.axes.safety.n ? a.axes.safety.score : null} tone="accent" />
                <Row label="Pass rate" value={<span className="tabular">{scen.length ? `${pct(passed, scen.length)} · ${ofN(passed, scen.length)} scenarios` : "–"}</span>} pct={scen.length ? (passed / scen.length) * 100 : null} tone="good" />
                <Row label="Critical failures" value={<span className={`tabular ${a.criticalEpisodes ? "text-crit-ink" : ""}`}>{int(a.criticalEpisodes)} of {int(a.episodes)} episodes</span>} pct={a.episodes ? Math.min(100, (a.criticalEpisodes / a.episodes) * 100) : null} tone="crit" />
                <div className="flex justify-between text-ink-3">
                  <span>critical check failures</span>
                  <span className="tabular text-ink-2">{int(a.criticalViolations)}</span>
                </div>
                <div className="flex justify-between text-ink-3">
                  <span>latency per episode</span>
                  <span className="tabular text-ink-2">{a.episodes ? ms(a.durationMs / a.episodes) : "not measured"}</span>
                </div>
                <div className="flex justify-between text-ink-3">
                  <span>estimated cost</span>
                  <span>not measured</span>
                </div>
                <div className="flex justify-between text-ink-3">
                  <span>gate</span>
                  <Pill tone={a.controls.mode === "enforced" ? "good" : a.controls.mode === "advisory" ? "warn" : "neutral"}>{a.controls.mode}</Pill>
                </div>
                <div className="flex justify-between text-ink-3">
                  <span>tests run</span>
                  <span className="tabular text-ink-2">{int(a.episodes)}</span>
                </div>
                <div className="flex justify-between text-ink-3">
                  <span>evidence</span>
                  <span className={armEv === "eligible" ? "text-good-ink" : armEv === "provisional" ? "text-warn-ink" : "text-warn-ink"}>{armEv === "eligible" ? "sufficient" : armEv === "provisional" ? "provisional" : "insufficient"}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 border-t border-line pt-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <StateBadge state={ev === "eligible" ? "READY" : ev === "provisional" ? "REVIEW" : "NONE"} label={EVIDENCE_LABEL[ev]} />
          <span className="text-[12px] text-ink-3">
            {int(maxEpisodes)} episodes in the largest arm · thresholds {CONFIG.minEpisodesProvisional} / {CONFIG.minEpisodesRecommend} (defaults)
          </span>
        </div>
        <p className="mt-2 text-ink-2">
          <span className="text-ink-3">Engine&apos;s pick by its rule: </span>
          {record.recommendation.label ? <span className="text-model-ink">{record.recommendation.label}</span> : <span className="text-warn-ink">none</span>} · {record.recommendation.reason}
        </p>
        <p className="mt-1 text-[11.5px] text-ink-3">rule: {record.recommendation.rule}</p>
        {ev !== "eligible" && <p className="mt-1 text-[11.5px] text-warn-ink">Not shown as recommended: the evidence is {ev === "provisional" ? "provisional" : "insufficient"} at this sample size.</p>}
      </div>
      <div className="mt-3">
        <Link href={`/labs/arena/${record.id}`} className="text-[13px] text-accent-ink">
          Open the full comparison →
        </Link>
      </div>
    </Card>
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
