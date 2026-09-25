import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { agent as loadAgent, jobs } from "@/lib/api";
import { safe } from "@/lib/safe";
import { CONNECTION_LABEL, CONNECTION_TONE, JOB_LABEL, isActive } from "@/lib/onboarding";
import { ago, int, when } from "@/lib/format";
import { Note, Offline } from "@/components/ui";
import { LabsNav, ProtocolExample, StatePill } from "../../labs-ui";
import { checkAgentAction, createVersionAction, toggleAgentAction, updateConnectionAction } from "../actions";

export const metadata = { title: "Agent" };

// One connected agent: its connection state with the last check's detail,
// its versions, and its evidence. Connectivity, evidence and readiness are
// three different things and are never merged into one badge.

export default async function AgentPage(props: PageProps<"/labs/agents/[agentId]">) {
  const { agentId } = await props.params;
  const search = await props.searchParams;
  const [data, jobList] = await Promise.all([safe(loadAgent(agentId)), safe(jobs())]);
  if (!data) return <Offline />;
  const { agent, versions, runs } = data;
  const error = typeof search.error === "string" ? search.error : null;
  const mine = (jobList ?? []).filter((j) => j.request.agentId === agent.id).reverse();
  const active = mine.find(isActive);
  const latestVersion = versions.at(-1);
  const c = agent.connection;
  const host = (() => {
    try {
      return new URL(c.endpoint).host;
    } catch {
      return c.endpoint;
    }
  })();

  return <>
    <LabsNav current="/labs/agents" />
    <div className="labs-page-head">
      <div>
        <p className="labs-eyebrow"><Link href="/labs/agents">Agents</Link></p>
        <h1>{agent.name}</h1>
        <p>{agent.workflow ? `${agent.workflow} · ` : ""}connected {when(agent.createdAt)}{agent.enabled ? "" : " · disabled"}</p>
      </div>
      {agent.enabled && latestVersion && !active && (
        <Link href={`/labs/tests/new?agentId=${encodeURIComponent(agent.id)}&versionId=${encodeURIComponent(latestVersion.id)}`} className="labs-primary-button">Run a test<ArrowUpRight size={18} aria-hidden="true" /></Link>
      )}
      {active && <Link href={`/labs/jobs/${active.id}`} className="labs-primary-button">View progress<ArrowUpRight size={18} aria-hidden="true" /></Link>}
    </div>
    {error && <Note tone="crit">{error}</Note>}
    {c.state === "connected" && !runs.length && !mine.length && latestVersion && (
      <section className="labs-next is-verified" aria-label="Next step">
        <div><strong>Connection verified.</strong><p>{c.lastCheck?.detail}. The endpoint is reachable, authenticated and speaks the protocol. Nothing has been tested yet.</p></div>
        {!active && <Link href={`/labs/tests/new?agentId=${encodeURIComponent(agent.id)}&versionId=${encodeURIComponent(latestVersion.id)}`} className="labs-primary-button">Run first test<ArrowUpRight size={18} aria-hidden="true" /></Link>}
      </section>
    )}
    {(c.state === "auth_failed" || c.state === "unreachable" || c.state === "incompatible") && (
      <section className="labs-next is-failed" aria-label="Connection problem">
        <div>
          <strong>{CONNECTION_LABEL[c.state]}.</strong>
          <p>{c.lastCheck?.detail}</p>
          <p>{c.state === "auth_failed" ? "Fix: the endpoint rejected the credential. Check the token or key, and whether it expects the Authorization or X-API-Key header, under Change endpoint or credential below." : c.state === "unreachable" ? `Fix: the engine could not reach ${host}. Confirm the URL and that the endpoint is running and reachable from the engine's network; a URL on your laptop is only reachable by a local engine.` : "Fix: the endpoint answered but not in the protocol's shape. It must reply to a POSTed turn with one JSON step; see the request/response example below. Redirects are not followed."}</p>
        </div>
        <form action={checkAgentAction}><input type="hidden" name="agentId" value={agent.id} /><button type="submit" className="labs-primary-button">Check again</button></form>
      </section>
    )}

    <div className="labs-two-col">
      <section className="labs-panel labs-block" aria-labelledby="connection-heading">
        <div className="labs-section-heading"><h2 id="connection-heading">Connection</h2><StatePill tone={CONNECTION_TONE[c.state]}>{CONNECTION_LABEL[c.state]}</StatePill></div>
        <dl className="labs-kv">
          <dt>Endpoint</dt><dd><code>{c.endpoint}</code></dd>
          <dt>Protocol</dt><dd>{c.protocol}</dd>
          <dt>Credential</dt><dd>{c.auth ? `${c.auth.header} · ${c.auth.scheme} · stored under ${c.auth.secretId}` : "none configured"}</dd>
          <dt>Last check</dt>
          <dd>{c.lastCheck ? <>{c.lastCheck.detail} <span className="labs-muted">· {c.lastCheck.latencyMs} ms · {ago(c.lastCheck.at)}{c.lastCheck.reported?.model ? ` · endpoint reported model ${c.lastCheck.reported.model}` : ""}</span></> : "not yet run"}</dd>
        </dl>
        <div className="labs-actions">
          <form action={checkAgentAction}><input type="hidden" name="agentId" value={agent.id} /><button type="submit" className="labs-primary-button" disabled={!agent.enabled}>Check connection</button></form>
          <form action={toggleAgentAction}><input type="hidden" name="agentId" value={agent.id} /><input type="hidden" name="enabled" value={agent.enabled ? "false" : "true"} /><button type="submit" className="labs-text-link labs-button-link">{agent.enabled ? "Disable agent" : "Enable agent"}</button></form>
        </div>
        <p className="labs-muted">A check sends one labelled dry-run turn to {host} and validates the reply. Connected means reachable, authenticated and speaking the protocol; it says nothing about test results or readiness.</p>
        <details className="labs-protocol">
          <summary>Change endpoint or credential</summary>
          <form action={updateConnectionAction} className="labs-form labs-form-inline">
            <input type="hidden" name="agentId" value={agent.id} />
            <label><span>Endpoint URL</span><input name="endpoint" type="url" defaultValue={c.endpoint} /></label>
            <div className="labs-field-row">
              <label><span>Auth header</span><select name="authHeader" defaultValue={c.auth?.header ?? "authorization"}><option value="authorization">Authorization</option><option value="x-api-key">X-API-Key</option></select></label>
              <label><span>Scheme</span><select name="authScheme" defaultValue={c.auth?.scheme ?? "bearer"}><option value="bearer">Bearer token</option><option value="raw">Raw value</option></select></label>
            </div>
            <label><span>New credential</span><input name="authValue" type="password" autoComplete="off" placeholder="leave blank to keep the current one" /></label>
            <label className="labs-checkbox"><input type="checkbox" name="clearAuth" value="true" /><span>Remove the credential</span></label>
            <div className="labs-actions"><button type="submit" className="labs-primary-button">Save and check</button></div>
          </form>
        </details>
        <ProtocolExample />
      </section>

      <section className="labs-panel labs-block" aria-labelledby="versions-heading">
        <div className="labs-section-heading"><h2 id="versions-heading">Versions</h2><span className="labs-muted">{int(versions.length)}</span></div>
        <ul className="labs-version-list">
          {[...versions].reverse().map((v) => {
            const vRuns = runs.filter((r) => r.agent.registry?.versionId === v.id);
            const latest = vRuns.at(-1);
            return (
              <li key={v.id}>
                <div><strong>{v.label}</strong>{v === latestVersion && <span className="labs-chip">latest</span>}<div className="labs-muted">{v.declared?.model ? `declared model ${v.declared.model}${v.declared.modelVersion ? ` ${v.declared.modelVersion}` : ""}` : "no model declared"}{v.declared?.temperature !== undefined ? ` · temperature ${v.declared.temperature}` : ""}{v.declared?.note ? ` · ${v.declared.note}` : ""} · recorded {ago(v.createdAt)}</div></div>
                <div className="labs-version-actions">
                  {latest ? <Link href={`/labs/tests/${latest.id}`}>{int(vRuns.length)} test{vRuns.length === 1 ? "" : "s"} · latest safety {latest.axes.safety.score} on {int(latest.axes.safety.sampleSize)}</Link> : <span className="labs-muted">no test yet</span>}
                  {agent.enabled && !active && <Link className="labs-text-link" href={`/labs/tests/new?agentId=${encodeURIComponent(agent.id)}&versionId=${encodeURIComponent(v.id)}`}>Test this version<ArrowUpRight size={15} aria-hidden="true" /></Link>}
                </div>
              </li>
            );
          })}
        </ul>
        <details className="labs-protocol">
          <summary>Record a new version</summary>
          <form action={createVersionAction} className="labs-form labs-form-inline">
            <input type="hidden" name="agentId" value={agent.id} />
            <label><span>Version label</span><input name="label" required maxLength={60} placeholder="v1.1" /></label>
            <div className="labs-field-row">
              <label><span>Model <em>declared</em></span><input name="model" maxLength={120} /></label>
              <label><span>Model version</span><input name="modelVersion" maxLength={120} /></label>
              <label><span>Temperature</span><input name="temperature" type="number" step="0.1" min={0} max={2} /></label>
            </div>
            <label><span>Note</span><input name="note" maxLength={500} placeholder="what changed" /></label>
            <div className="labs-actions"><button type="submit" className="labs-primary-button">Record version</button></div>
          </form>
          <p className="labs-muted">A version label is your statement about the configuration behind the endpoint; the Lab cannot verify that the remote configuration is frozen. Earlier evidence stays with its version.</p>
        </details>
      </section>
    </div>

    <section className="labs-panel labs-history" aria-labelledby="evidence-heading">
      <div className="labs-section-heading"><h2 id="evidence-heading">Tests</h2><Link className="labs-text-link" href="/labs/tests">All tests<ArrowUpRight size={15} aria-hidden="true" /></Link></div>
      {mine.length === 0 && runs.length === 0 ? <p className="labs-muted labs-lead">No test has run for this agent.</p> : (
        <div className="labs-table-scroll">
          <table>
            <thead><tr><th>Started</th><th>Version</th><th>Suite</th><th>State</th><th>Result</th></tr></thead>
            <tbody>
              {mine.map((j) => {
                const run = j.runId ? runs.find((r) => r.id === j.runId) : undefined;
                const v = versions.find((x) => x.id === j.request.versionId);
                return (
                  <tr key={j.id}>
                    <td><Link href={`/labs/jobs/${j.id}`}>{when(j.createdAt)}</Link></td>
                    <td>{v?.label ?? j.subject.version}</td>
                    <td>{j.suite.scenarioCount} scenarios × {j.suite.trials}</td>
                    <td><StatePill tone={j.state === "completed" ? "pass" : j.state === "failed" ? "fail" : j.state === "interrupted" ? "warn" : "unknown"}>{JOB_LABEL[j.state]}</StatePill></td>
                    <td>{run ? <Link href={`/labs/tests/${run.id}`}>Safety {run.axes.safety.score} on {int(run.axes.safety.sampleSize)} · {int(run.axes.criticalViolations.length)} critical findings</Link> : j.state === "running" || j.state === "queued" ? `${j.progress.completed} of ${j.progress.total}` : <span className="labs-muted">{j.error?.message ?? "—"}</span>}</td>
                  </tr>
                );
              })}
              {runs.filter((r) => !mine.some((j) => j.runId === r.id)).reverse().map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/labs/tests/${r.id}`}>{when(r.createdAt)}</Link></td>
                  <td>{versions.find((x) => x.id === r.agent.registry?.versionId)?.label ?? r.agent.version}</td>
                  <td>{r.suite.scenarioCount} scenarios × {r.suite.trials}</td>
                  <td><StatePill tone="pass">Completed</StatePill></td>
                  <td><Link href={`/labs/tests/${r.id}`}>Safety {r.axes.safety.score} on {int(r.axes.safety.sampleSize)}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  </>;
}
