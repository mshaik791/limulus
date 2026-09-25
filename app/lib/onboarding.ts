import type { AgentRecord, ConnectionState, Job, LabRunSummary, VersionRecord } from "./api";

// The one next action for a customer, from the registry, the job log and the
// runs. Derived, never stored; every state here maps to a screen that exists.

export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  not_checked: "Not checked",
  checking: "Checking",
  connected: "Connected",
  auth_failed: "Authentication failed",
  unreachable: "Unreachable",
  incompatible: "Incompatible response",
  disabled: "Disabled",
};

export const CONNECTION_TONE: Record<ConnectionState, "pass" | "fail" | "warn" | "unknown"> = {
  not_checked: "unknown",
  checking: "unknown",
  connected: "pass",
  auth_failed: "fail",
  unreachable: "fail",
  incompatible: "fail",
  disabled: "unknown",
};

export const JOB_LABEL: Record<Job["state"], string> = { queued: "Queued", running: "Running", completed: "Completed", failed: "Failed", interrupted: "Interrupted" };

export const isActive = (j: Job) => j.state === "queued" || j.state === "running";

export type NextStep = { key: "connect" | "check" | "progress" | "failed" | "first_test" | "new_version"; title: string; body: string; href: string; cta: string };

/** The overview's next step for customer agents, or null when the existing evidence-driven overview should lead. */
export function nextStep(input: { agents: AgentRecord[]; versions: VersionRecord[]; jobs: Job[]; runs: LabRunSummary[] }): NextStep | null {
  const agents = input.agents.filter((a) => a.enabled);
  if (agents.length === 0) return { key: "connect", title: "Connect your agent", body: "Register the endpoint the Lab should test. Demos stay available, but they are scripted reference agents, not your model.", href: "/labs/agents/new", cta: "Connect agent" };

  const active = [...input.jobs].reverse().find(isActive);
  if (active) return { key: "progress", title: `Test in progress: ${active.subject.name} ${active.subject.version}`, body: `${active.progress.completed} of ${active.progress.total} trials complete.`, href: `/labs/jobs/${active.id}`, cta: "View progress" };

  const latestJob = [...input.jobs].reverse().find((j) => j.request.agentId);
  if (latestJob && latestJob.state === "failed") return { key: "failed", title: `The last test could not run: ${latestJob.subject.name} ${latestJob.subject.version}`, body: latestJob.error?.message ?? "The engine could not run the suite.", href: `/labs/jobs/${latestJob.id}`, cta: "Review run error" };

  const unchecked = [...agents].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).find((a) => a.connection.state !== "connected");
  if (unchecked) {
    const s = unchecked.connection.state;
    return { key: "check", title: s === "not_checked" ? `Check the connection to ${unchecked.name}` : `${unchecked.name}: ${CONNECTION_LABEL[s].toLowerCase()}`, body: s === "not_checked" ? "One dry-run turn confirms the endpoint answers in the documented shape. Nothing is executed." : (unchecked.connection.lastCheck?.detail ?? "Fix the connection, then check it again."), href: `/labs/agents/${unchecked.id}`, cta: "Check connection" };
  }

  for (const a of agents) {
    const hasRun = input.runs.some((r) => r.agent.registry?.agentId === a.id);
    if (!hasRun) {
      const v = input.versions.filter((x) => x.agentId === a.id).at(-1);
      return { key: "first_test", title: `Run the first test on ${a.name}`, body: "The starter suite runs every scenario in the open pool against your endpoint in a simulated world.", href: v ? `/labs/tests/new?agentId=${encodeURIComponent(a.id)}&versionId=${encodeURIComponent(v.id)}` : `/labs/agents/${a.id}`, cta: "Run first test" };
    }
  }

  for (const a of agents) {
    const versions = input.versions.filter((x) => x.agentId === a.id);
    const latest = versions.at(-1);
    if (latest && !input.runs.some((r) => r.agent.registry?.versionId === latest.id)) {
      return { key: "new_version", title: `${a.name} ${latest.label} has not been tested`, body: "A new version has no evidence of its own; earlier results describe the earlier configuration.", href: `/labs/tests/new?agentId=${encodeURIComponent(a.id)}&versionId=${encodeURIComponent(latest.id)}`, cta: "Test new version" };
    }
  }
  return null;
}
