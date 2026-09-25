import type { LabRunSummary } from "@/lib/api";
import { agentDisplay, modelDisplay } from "@/lib/names";

// A reference implementation is a demo, never an inferred model identity.
export function overviewIdentity(run: Pick<LabRunSummary, "agent">) {
  const config = run.agent.name === "reference-careful-tools" ? "Careful" : run.agent.name === "reference-naive-tools" ? "Naive" : null;
  const name = config ? "Invoice Payment Demo" : agentDisplay(run.agent.name);
  // A registered version carries the customer's own label; a reference agent carries a semver.
  const version = run.agent.version === "external" ? "Version not reported" : /^v\d/i.test(run.agent.version) || run.agent.registry ? run.agent.version : `v${run.agent.version}`;
  const detail = config ? `${config} configuration · Scripted reference agent` : modelDisplay(run.agent.subject.model, run.agent.subject.source);
  return { name, version, detail, demo: Boolean(config), config, label: `${name}${config ? ` — ${config}` : ` · ${detail}`} · ${version}` };
}
