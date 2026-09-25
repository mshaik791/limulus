import { Note } from "@/components/ui";
import { LabsNav, ProtocolExample } from "../../labs-ui";
import { createAgentAction } from "../actions";

export const metadata = { title: "Connect an agent" };

// Guided connection setup. The credential field is a password input handled by
// a server action; it never appears in a URL, a record or a rendered page.

export default async function NewAgent(props: PageProps<"/labs/agents/new">) {
  const search = await props.searchParams;
  const error = typeof search.error === "string" ? search.error : null;
  return <>
    <LabsNav current="/labs/agents" />
    <div className="labs-page-head">
      <div>
        <h1>Connect an agent</h1>
        <p>Register the endpoint the Lab should test. The engine must be able to reach it: a URL on your laptop works only for a local engine, and hosted engines only call public endpoints.</p>
      </div>
    </div>
    {error && <Note tone="crit">{error}</Note>}

    <div className="labs-two-col">
      <form action={createAgentAction} className="labs-panel labs-form">
        <h2>Agent</h2>
        <label><span>Name</span><input name="name" required maxLength={120} placeholder="Invoice Payment Agent" /></label>
        <label><span>Workflow</span><input name="workflow" required maxLength={120} placeholder="Accounts payable: vendor invoices" /></label>

        <h2>Connection</h2>
        <label><span>Endpoint URL</span><input name="endpoint" type="url" required inputMode="url" placeholder="https://agent.example.com/limulus" /><small>Receives one POST per step. Protocol: limulus-turn-v1, JSON in, JSON out.</small></label>
        <div className="labs-field-row">
          <label><span>Auth header</span><select name="authHeader" defaultValue="authorization"><option value="authorization">Authorization</option><option value="x-api-key">X-API-Key</option></select></label>
          <label><span>Scheme</span><select name="authScheme" defaultValue="bearer"><option value="bearer">Bearer token</option><option value="raw">Raw value</option></select></label>
        </div>
        <label><span>Credential <em>optional</em></span><input name="authValue" type="password" autoComplete="off" placeholder="sent with every request; stored server-side under a reference" /><small>Kept in the engine&apos;s secret store. Never shown again, never in a test record or an export.</small></label>

        <h2>Version</h2>
        <label><span>Version label</span><input name="versionLabel" required maxLength={60} placeholder="v1.0" /><small>Your name for this configuration. Every test binds to a version; change the agent, record a new version.</small></label>
        <div className="labs-field-row">
          <label><span>Model <em>declared</em></span><input name="model" maxLength={120} placeholder="e.g. openai/gpt-4.1" /></label>
          <label><span>Model version</span><input name="modelVersion" maxLength={120} /></label>
          <label><span>Temperature</span><input name="temperature" type="number" step="0.1" min={0} max={2} /></label>
        </div>
        <label><span>Note <em>optional</em></span><input name="note" maxLength={500} placeholder="prompt revision, tool set, anything that identifies this configuration" /></label>
        <p className="labs-muted">Declared metadata is recorded as your statement. The model an endpoint reports on each step is recorded separately as self-reported; neither is verified by the Lab.</p>

        <div className="labs-actions"><button type="submit" className="labs-primary-button">Register and check connection</button></div>
      </form>

      <aside className="labs-panel labs-aside">
        <h2>What a test does</h2>
        <ul>
          <li><strong>Simulated only.</strong> Your endpoint receives synthetic invoices, vendors and documents. Every action it proposes runs against the engine&apos;s simulated world and bank rail. No production credential or rail is touched during a Labs run.</li>
          <li><strong>You bring no tools.</strong> The engine offers the tools and executes them. If your agent holds real payment tools of its own, point Limulus at a test-only configuration of it; a form field cannot make live tools safe.</li>
          <li><strong>What is recorded.</strong> Each turn sent, each step returned, the simulated outcome, and the grader&apos;s findings. The credential is not.</li>
          <li><strong>Charges.</strong> If your endpoint calls a paid model, its provider bills you for every step. The Lab does not estimate that cost.</li>
        </ul>
        <ProtocolExample />
        <p className="labs-muted">Try it without a model: <code>npm run fixture-agent</code> in the engine starts a scripted stand-in at <code>http://localhost:9200/agent</code>.</p>
      </aside>
    </div>
  </>;
}
