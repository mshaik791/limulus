import type { LabRunSummary } from "@/lib/api";
import { agentDisplay, modelDisplay } from "@/lib/names";

// A reference implementation is a demo, never an inferred model identity.
export function overviewIdentity(run: Pick<LabRunSummary, "agent">) {
  const config = run.agent.name === "reference-careful-tools" ? "Careful" : run.agent.name === "reference-naive-tools" ? "Naive" : null;
  const name = config ? "Invoice Payment Demo" : agentDisplay(run.agent.name);
  const version = run.agent.version === "external" ? "Version not reported" : `v${run.agent.version}`;
  const detail = config ? `${config} configuration · Scripted reference agent` : modelDisplay(run.agent.subject.model, run.agent.subject.source);
  return { name, version, detail, demo: Boolean(config), config, label: `${name}${config ? ` — ${config}` : ` · ${detail}`} · ${version}` };
}
