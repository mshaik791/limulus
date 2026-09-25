import type { LabRunSummary } from "@/lib/api";
import { agentDisplay, modelDisplay, versionLabel } from "@/lib/names";

// One identity for a run's subject, used everywhere a run is named: the agent
// once, the version once, and what stands behind the endpoint with its
// provenance. A reference implementation is a demo; an endpoint that declared
// itself a fixture is a fixture; a model is declared (configured) or
// self-reported; anything else is unknown. Nothing is inferred from a name.

export type Identity = {
  name: string;
  version: string;
  /** What produced the behaviour, with provenance. Never a status. */
  detail: string;
  demo: boolean;
  fixture: boolean;
  config: string | null;
  label: string;
};

/**
 * Explicit provenance first. Records sealed before the fixture flag existed
 * carry only the fixture's self-reported model string; that narrow case, a
 * self-report beginning "fixture/", is honoured so old evidence reads the same
 * way. A configured (declared) model is never reinterpreted.
 */
export const isFixtureSubject = (s: LabRunSummary["agent"]["subject"]) => s.fixture === true || (s.source === "self-reported" && /^fixture\//.test(s.model ?? ""));

export function overviewIdentity(run: Pick<LabRunSummary, "agent">): Identity {
  const config = run.agent.name === "reference-careful-tools" ? "Careful" : run.agent.name === "reference-naive-tools" ? "Naive" : null;
  const demo = Boolean(config);
  const fixture = !demo && isFixtureSubject(run.agent.subject);
  const name = demo ? "Invoice Payment Demo" : agentDisplay(run.agent.name);
  const version = run.agent.version === "external" ? "Version not reported" : versionLabel(run.agent.version);
  const s = run.agent.subject;
  const detail = demo
    ? `${config} configuration · scripted reference agent`
    : fixture
      ? `Test fixture · mode ${(s.model ?? "").replace(/^fixture\//, "") || "unknown"} · scripted stand-in, not a model`
      : s.model
        ? `${/^fixture\//.test(s.model) ? s.model : modelDisplay(s.model)}${s.modelVersion ? ` ${s.modelVersion}` : ""} · ${s.source === "configured" ? "declared by you" : "self-reported by the endpoint"}${s.inconsistent?.length ? " · inconsistent across steps" : ""}`
        : "Model not reported";
  // A declared id that names a fixture is shown word for word: "ok" is a mode,
  // not a model, and the record did not say it was a fixture.
  return { name, version, detail, demo, fixture, config, label: `${name}${config ? ` — ${config}` : fixture ? " · Test fixture" : s.model ? ` · ${/^fixture\//.test(s.model) ? s.model : modelDisplay(s.model)}` : ""} · ${version}` };
}
