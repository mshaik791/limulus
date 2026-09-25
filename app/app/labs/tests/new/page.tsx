import Link from "next/link";
import { randomUUID } from "node:crypto";
import { agents, referenceAgents, suites } from "@/lib/api";
import { safe } from "@/lib/safe";
import { CONNECTION_LABEL, CONNECTION_TONE } from "@/lib/onboarding";
import { int } from "@/lib/format";
import { Note, Offline } from "@/components/ui";
import { LabsNav, StatePill } from "../../labs-ui";
import { submitJobAction } from "./actions";

export const metadata = { title: "New test" };

// Run setup. Only what a first run needs: the version under test, the one
// starter suite, the gate mode, and a repeat count. Every count on the page
// comes from the pool the engine will actually run.

export default async function NewTest(props: PageProps<"/labs/tests/new">) {
  const search = await props.searchParams;
  const q = (k: string) => (typeof search[k] === "string" ? (search[k] as string) : "");
  const [reg, suiteList, demos] = await Promise.all([safe(agents()), safe(suites()), safe(referenceAgents())]);
  if (!reg || !suiteList) return <Offline />;
  const suite = suiteList[0];
  const error = q("error") || null;

  const agentId = q("agentId");
  const demo = q("demo");
  const agent = reg.agents.find((a) => a.id === agentId);
  const versions = agent ? reg.versions.filter((v) => v.agentId === agent.id) : [];
  const versionId = versions.some((v) => v.id === q("versionId")) ? q("versionId") : (versions.at(-1)?.id ?? "");
  const version = versions.find((v) => v.id === versionId);
  const enabledAgents = reg.agents.filter((a) => a.enabled);

  return <>
    <LabsNav current="/labs/tests" />
    <div className="labs-page-head">
      <div>
        <h1>New test</h1>
        <p>One version, the starter suite, a repeat count. The result is a sealed run you can replay scenario by scenario.</p>
      </div>
    </div>
    {error && <Note tone="crit">{error}</Note>}

    <div className="labs-two-col">
      <form action={submitJobAction} className="labs-panel labs-form">
        <input type="hidden" name="submissionKey" value={randomUUID()} />
        <h2>What to test</h2>
        {demo ? (
          <>
            <input type="hidden" name="demo" value={demo} />
            <p>Demo agent: <strong>Invoice Payment Demo — {demo === "careful" ? "Careful" : demo === "naive" ? "Naive" : demo}</strong> <span className="labs-chip">v{(demos ?? []).find((d) => d.key === demo)?.version ?? "?"}</span> <span className="labs-chip">Demo</span></p>
            <p className="labs-muted">A scripted reference agent that runs in-process. Its results say nothing about your model. <Link href="/labs/tests/new" className="labs-text-link">Test a connected agent instead</Link></p>
          </>
        ) : agent ? (
          <>
            <input type="hidden" name="agentId" value={agent.id} />
            <p><strong>{agent.name}</strong> <StatePill tone={CONNECTION_TONE[agent.connection.state]}>{CONNECTION_LABEL[agent.connection.state]}</StatePill></p>
            <label><span>Version</span>
              <select name="versionId" defaultValue={versionId}>
                {versions.map((v) => <option key={v.id} value={v.id}>{v.label}{v.declared?.model ? ` · ${v.declared.model}` : ""}</option>)}
              </select>
            </label>
            {version?.declared?.model && <p className="labs-muted">Declared model {version.declared.model}; the model the endpoint reports per step is recorded separately.</p>}
            {agent.connection.state !== "connected" && <p className="labs-warn">The connection is {CONNECTION_LABEL[agent.connection.state].toLowerCase()}. A run against an endpoint that does not answer produces unusable trials, not results. <Link href={`/labs/agents/${agent.id}`}>Check the connection first.</Link></p>}
          </>
        ) : (
          <>
            <label><span>Connected agent</span>
              <select name="agentId" defaultValue="" required>
                <option value="" disabled>Choose an agent</option>
                {enabledAgents.map((a) => <option key={a.id} value={a.id}>{a.name} · {CONNECTION_LABEL[a.connection.state]}</option>)}
              </select>
            </label>
            <p className="labs-muted">Pick an agent, then its version on the next screen, or open the agent page and choose &ldquo;Test this version&rdquo;. {enabledAgents.length === 0 && <Link href="/labs/agents/new" className="labs-text-link">Connect an agent first.</Link>}</p>
            {enabledAgents.length > 0 && <input type="hidden" name="versionId" value="" />}
          </>
        )}

        <h2>Suite</h2>
        <dl className="labs-kv">
          <dt>Name</dt><dd>{suite.name} <span className="labs-muted">({suite.suiteId})</span></dd>
          <dt>Scenarios</dt><dd>{int(suite.scenarioCount)} in the open pool: {suite.categories.join(", ")}</dd>
          <dt>Risk areas</dt><dd>{suite.families.join(", ")}</dd>
          <dt>Environment</dt><dd>Simulated world and rail. No money moves; every vendor, invoice and account is invented.</dd>
        </dl>
        <p className="labs-muted">{suite.description}</p>

        <h2>Run</h2>
        <div className="labs-field-row">
          <label><span>Gate</span>
            <select name="controls" defaultValue="off">
              <option value="off">Off: the agent alone</option>
              <option value="advisory">Advisory: the gate is offered, not enforced</option>
              <option value="enforced">Enforced: the rail holds every order until the gate allows it</option>
            </select>
          </label>
          <label><span>Repeats per scenario</span><input name="trials" type="number" min={1} max={30} defaultValue={1} /><small>1 is a first look; 3 shows consistency; 30 is the floor for a qualification.</small></label>
        </div>
        <p className="labs-total">Expected trials: <strong>{int(suite.scenarioCount)} × repeats</strong>. Each trial is one full episode against your endpoint, so a model-backed agent takes minutes; the run continues if you leave the page.</p>
        <p className="labs-muted">If your endpoint calls a paid model, its provider bills you per step. The Lab does not estimate that cost.</p>
        <div className="labs-actions">
          <button type="submit" className="labs-primary-button" disabled={!demo && !agent && enabledAgents.length === 0}>{agent && !version ? "Choose a version first" : "Start test"}</button>
        </div>
      </form>

      <aside className="labs-panel labs-aside">
        <h2>What happens next</h2>
        <ol className="labs-steps">
          <li>The job is queued and starts within seconds; progress shows real completed counts.</li>
          <li>Each scenario runs as one episode: the engine sends turns, your endpoint proposes actions, the simulated world executes them.</li>
          <li>Deterministic graders read what the agent did. A reply the engine cannot parse is an unusable trial and stays out of every rate.</li>
          <li>The finished run is sealed and signed, then opened for you: failures first, then every scenario, traces and evidence.</li>
        </ol>
        <p className="labs-muted">Cancelling mid-run seals nothing. A partial suite is not a completed suite.</p>
      </aside>
    </div>
  </>;
}
