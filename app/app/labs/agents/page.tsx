import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { agents, jobs, labRuns, referenceAgents } from "@/lib/api";
import { safe } from "@/lib/safe";
import { CONNECTION_LABEL, CONNECTION_TONE, JOB_LABEL, isActive } from "@/lib/onboarding";
import { ago, int } from "@/lib/format";
import { Note, Offline } from "@/components/ui";
import { LabsNav, StatePill } from "../labs-ui";

export const metadata = { title: "Agents" };

// What am I testing? Connected agents first, each with its connection state,
// its versions and its latest evidence; the scripted demos apart, labelled as
// what they are.

export default async function Agents(props: PageProps<"/labs/agents">) {
  const search = await props.searchParams;
  const [reg, jobList, runs, demos] = await Promise.all([safe(agents()), safe(jobs()), safe(labRuns()), safe(referenceAgents())]);
  if (!reg || !runs) return <Offline />;
  const error = typeof search.error === "string" ? search.error : null;
  const active = (jobList ?? []).filter(isActive);

  return <>
    <LabsNav current="/labs/agents" />
    <div className="labs-page-head">
      <div>
        <h1>Agents</h1>
        <p>Connected agents are endpoints the Lab tests; demos are scripted reference agents that exist so the flow can be tried without a model.</p>
      </div>
      <Link href="/labs/agents/new" className="labs-primary-button">Connect agent<ArrowUpRight size={18} aria-hidden="true" /></Link>
    </div>
    {error && <Note tone="crit">{error}</Note>}

    <section className="labs-panel labs-list" aria-labelledby="connected-heading">
      <div className="labs-section-heading"><h2 id="connected-heading">Connected agents</h2><span className="labs-muted">{int(reg.agents.length)}</span></div>
      {reg.agents.length === 0 ? (
        <div className="labs-empty-inline">
          <p>No agent is connected yet. Registering one takes a name, an endpoint and a version label; the first connection check runs at once.</p>
          <Link href="/labs/agents/new" className="labs-text-link">Connect your first agent<ArrowUpRight size={15} aria-hidden="true" /></Link>
        </div>
      ) : (
        <div className="labs-table-scroll">
          <table>
            <thead><tr><th>Agent</th><th>Connection</th><th>Latest version</th><th>Latest evidence</th><th>Updated</th></tr></thead>
            <tbody>
              {[...reg.agents].reverse().map((a) => {
                const versions = reg.versions.filter((v) => v.agentId === a.id);
                const latestVersion = versions.at(-1);
                const latestRun = [...runs].reverse().find((r) => r.agent.registry?.agentId === a.id);
                const job = active.find((j) => j.request.agentId === a.id);
                return (
                  <tr key={a.id}>
                    <td><Link href={`/labs/agents/${a.id}`}>{a.name}</Link><div className="labs-muted">{a.workflow}</div></td>
                    <td><StatePill tone={CONNECTION_TONE[a.connection.state]}>{CONNECTION_LABEL[a.connection.state]}</StatePill></td>
                    <td>{latestVersion ? latestVersion.label : "—"}<div className="labs-muted">{int(versions.length)} recorded</div></td>
                    <td>
                      {job ? <Link href={`/labs/jobs/${job.id}`}>{JOB_LABEL[job.state]} · {job.progress.completed} of {job.progress.total}</Link> : latestRun ? <Link href={`/labs/tests/${latestRun.id}`}>Safety {latestRun.axes.safety.score} on {int(latestRun.axes.safety.sampleSize)} · {ago(latestRun.createdAt)}</Link> : <span className="labs-muted">No test yet</span>}
                    </td>
                    <td>{ago(a.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>

    <section className="labs-panel labs-list" aria-labelledby="demo-heading">
      <div className="labs-section-heading"><h2 id="demo-heading">Demo agents</h2><span className="labs-muted">scripted, in-process</span></div>
      <p className="labs-muted labs-lead">Two reference implementations ship with the engine: a careful one and a naive one. They are deterministic scripts, not models, and every result they produce is labelled as a demo.</p>
      <ul className="labs-demo-list">
        {(demos ?? []).map((d) => (
          <li key={d.key}>
            <span>Invoice Payment Demo — {d.key === "careful" ? "Careful" : d.key === "naive" ? "Naive" : d.name} <span className="labs-chip">v{d.version}</span></span>
            <Link className="labs-text-link" href={`/labs/tests/new?demo=${encodeURIComponent(d.key)}`}>Run a demo test<ArrowUpRight size={15} aria-hidden="true" /></Link>
          </li>
        ))}
      </ul>
    </section>
  </>;
}
