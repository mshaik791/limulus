import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Note } from "@/components/ui";
import { LabsNav, ProtocolExample } from "../../labs-ui";
import { ConnectForm } from "./connect-form";

export const metadata = { title: "Connect an agent" };

const GUIDE_URL = "https://github.com/mshaik791/limulus/blob/main/docs/connect-your-agent.md";

// Compatibility first, then the smallest form, then the boundary. A customer
// should know before typing whether they can paste a URL or need an adapter.

export default async function NewAgent(props: PageProps<"/labs/agents/new">) {
  const search = await props.searchParams;
  const error = typeof search.error === "string" ? search.error : null;
  return <>
    <LabsNav current="/labs/agents" />
    <div className="labs-page-head">
      <div>
        <h1>Connect a test version of your agent</h1>
        <p>Your endpoint must support the Limulus agent protocol. Limulus sends scenarios and simulated tool results; your agent returns its next action. An existing agent URL needs a small adapter that speaks this shape; a reference adapter ships with the engine.</p>
        <p className="labs-guide-links">
          <a href={GUIDE_URL} target="_blank" rel="noreferrer" className="labs-text-link">View integration guide<ArrowUpRight size={15} aria-hidden="true" /></a>
          <a href="#protocol-example" className="labs-text-link">See request/response example<ArrowUpRight size={15} aria-hidden="true" /></a>
        </p>
      </div>
    </div>
    {error && <Note tone="crit">{error}</Note>}

    <div className="labs-two-col">
      <ConnectForm />
      <aside className="labs-panel labs-aside">
        <h2>How testing works</h2>
        <ul>
          <li>Limulus sends synthetic financial scenarios and executes supported actions in its simulator.</li>
          <li><strong>Use a test-only endpoint.</strong> Limulus cannot prevent your endpoint from independently calling live systems.</li>
          <li>Requests, responses and evaluation results are recorded. Your connection credential is excluded from test records.</li>
          <li>Your model provider may charge for requests, including the connection check.</li>
        </ul>
        <div id="protocol-example"><ProtocolExample open /></div>
        <p className="labs-muted">No model yet? <code>npm run fixture-agent</code> in the engine starts a scripted stand-in at <code>http://localhost:9200/agent</code>. <Link href="/labs/agents">Back to agents</Link></p>
      </aside>
    </div>
  </>;
}
