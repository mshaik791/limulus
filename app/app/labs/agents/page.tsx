import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { agents, jobs, labRuns, referenceAgents, type AgentRecord } from "@/lib/api";
import { safe } from "@/lib/safe";
import { CONNECTION_LABEL, CONNECTION_TONE, JOB_LABEL, isActive } from "@/lib/onboarding";
import { ago, int } from "@/lib/format";
import { modelDisplay } from "@/lib/names";
import { Note, Offline } from "@/components/ui";
import { LabsNav, StatePill } from "../labs-ui";

export const metadata = { title: "Agents" };

// Three things obvious: which agent is connected, what its latest test
// established, and what to do next. Demos apart, smaller once a real agent
// exists.

// The check reply's own declaration; a model string never decides this.
const isFixture = (a: AgentRecord) => a.connection.lastCheck?.reported?.fixture === true;

export default async function Agents(props: PageProps<"/labs/agents">) {
  const search = await props.searchParams;
  const [reg, jobList, runs, demos] = await Promise.all([safe(agents()), safe(jobs()), safe(labRuns()), safe(referenceAgents())]);
  if (!reg || !runs) return <Offline />;
  const error = typeof search.error === "string" ? search.error : null;
  const active = (jobList ?? []).filter(isActive);
  const connected = [...reg.agents].reverse();

  return <>
    <LabsNav current="/labs/agents" />
    <div className="labs-page-head">
      <div>
        <h1>Agents</h1>
        <p>Connect your financial agent, test its behavior, and track results across versions.</p>
      </div>
      <Link href="/labs/agents/new" className="labs-primary-button">Connect agent<ArrowUpRight size={18} aria-hidden="true" /></Link>
    </div>
    {error && <Note tone="crit">{error}</Note>}

    <section className="labs-panel labs-list" aria-labelledby="connected-heading">
      <div className="labs-section-heading"><h2 id="connected-heading">Connected agents</h2>{connected.length > 0 && <span className="labs-muted">{int(connected.length)}</span>}</div>
      {connected.length === 0 ? (
        <div className="labs-empty-inline">
          <p>No agent is connected yet. It takes a name, an endpoint and a version label; the first connection check runs at once.</p>
          <Link href="/labs/agents/new" className="labs-text-link">Connect your first agent<ArrowUpRight size={15} aria-hidden="true" /></Link>
        </div>
      ) : (
        <ul className="labs-agent-rows">
          {connected.map((a) => {
            const versions = reg.versions.filter((v) => v.agentId === a.id);
            const latestVersion = versions.at(-1);
            const latestRun = [...runs].reverse().find((r) => r.agent.registry?.agentId === a.id);
            const job = active.find((j) => j.request.agentId === a.id);
            const model = latestVersion?.declared?.model ?? a.connection.lastCheck?.reported?.model;
            const fixture = isFixture(a);
            const runVersion = latestRun ? (versions.find((v) => v.id === latestRun.agent.registry?.versionId)?.label ?? latestRun.agent.version) : null;
            return (
              <li key={a.id}>
                <div className="labs-agent-row-head">
                  <Link href={`/labs/agents/${a.id}`} className="labs-agent-name">{a.name}</Link>
                  {fixture && <span className="labs-chip">Test fixture</span>}
                  {!a.enabled && <span className="labs-chip">Disabled</span>}
                </div>
                <div className="labs-muted">{a.workflow ? `${a.workflow} · ` : ""}{fixture ? "a scripted stand-in, not a model-powered agent" : model ? `${modelDisplay(model)} · ${latestVersion?.declared?.model ? "declared by you" : "self-reported by the endpoint"}` : "Model not reported"}</div>
                <div className="labs-agent-facts">
                  <span><b>Connection:</b> <StatePill tone={CONNECTION_TONE[a.connection.state]}>{CONNECTION_LABEL[a.connection.state]}</StatePill></span>
                  <span><b>Version:</b> {latestVersion?.label ?? "—"}{versions.length > 1 ? <span className="labs-muted"> · {int(versions.length)} versions</span> : null}</span>
                </div>
                {job ? (
                  <div className="labs-agent-result"><b>Test in progress:</b> {JOB_LABEL[job.state]} · {job.progress.completed} of {job.progress.total} trials</div>
                ) : latestRun ? (
                  <div className="labs-agent-result">
                    {latestRun.axes.safety.sampleSize ? (
                      <div><b>Safety:</b> {latestRun.axes.safety.score}/100 · {int(latestRun.axes.safety.sampleSize)} usable trials · <span className={latestRun.axes.criticalViolations.length ? "labs-failure-text" : ""} title="Individual check failures graded as critical. A trial can fail more than one check.">{int(latestRun.axes.criticalViolations.length)} critical check failures</span></div>
                    ) : (
                      <div><b>Latest test:</b> no usable trials</div>
                    )}
                    <div className="labs-muted">Last tested {ago(latestRun.createdAt)}{runVersion ? ` · ${runVersion}` : ""}</div>
                  </div>
                ) : (
                  <div className="labs-agent-result"><b>Latest test:</b> none yet</div>
                )}
                <div className="labs-agent-actions">
                  {a.enabled && latestVersion && !job && <Link className="labs-outline-button" href={`/labs/tests/new?agentId=${encodeURIComponent(a.id)}&versionId=${encodeURIComponent(latestVersion.id)}`}>{latestRun ? "Run test" : "Run first test"}</Link>}
                  {job ? <Link className="labs-text-link" href={`/labs/jobs/${job.id}`}>View progress<ArrowUpRight size={15} aria-hidden="true" /></Link> : latestRun ? <Link className="labs-text-link" href={`/labs/tests/${latestRun.id}`}>View results<ArrowUpRight size={15} aria-hidden="true" /></Link> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>

    {connected.length === 0 ? (
      <section className="labs-panel labs-list" aria-labelledby="demo-heading">
        <div className="labs-section-heading"><h2 id="demo-heading">Try a demo</h2></div>
        <p className="labs-muted labs-lead">Explore testing with two scripted example agents. No model or API key required.</p>
        <DemoList demos={demos ?? []} />
      </section>
    ) : (
      <details className="labs-panel labs-list labs-demo-details">
        <summary><h2>Try a demo</h2><span className="labs-muted">Two scripted example agents. No model or API key required.</span></summary>
        <DemoList demos={demos ?? []} />
      </details>
    )}
  </>;
}

function DemoList({ demos }: { demos: { key: string; name: string; version: string }[] }) {
  return (
    <ul className="labs-demo-list">
      {demos.map((d) => (
        <li key={d.key}>
          <span>Invoice Payment Demo — {d.key === "careful" ? "Careful" : d.key === "naive" ? "Naive" : d.name} <span className="labs-chip">v{d.version}</span> <span className="labs-chip">Demo</span></span>
          <Link className="labs-text-link" href={`/labs/tests/new?demo=${encodeURIComponent(d.key)}`}>Run a demo test<ArrowUpRight size={15} aria-hidden="true" /></Link>
        </li>
      ))}
    </ul>
  );
}
