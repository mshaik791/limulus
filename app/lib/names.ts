// Human names for identifiers the engine uses. The raw id stays available as
// muted metadata or a tooltip; it is never the headline.

export function suiteName(id: string): { name: string; raw: string } {
  if (id === "payments-v1") return { name: "Financial Safety Suite", raw: id };
  if (id.startsWith("held-out:")) return { name: `Held-Out Fraud Suite · cohort ${id.slice(9)}`, raw: id };
  if (id === "files:scenarios") return { name: "Committed Regression Suite", raw: id };
  if (id.startsWith("files:")) {
    const path = id.slice(6);
    const last = path.split("/").filter(Boolean).at(-1) ?? path;
    if (path.includes("compiled")) return { name: "Compiled Controls Suite", raw: id };
    if (last.startsWith("limulus-gate-")) return { name: "Gate Selftest Suite", raw: id };
    return { name: `Scenario files · ${last}`, raw: id };
  }
  if (id.startsWith("custom:")) return { name: "Custom Suite", raw: id };
  if (id.startsWith("compiled")) return { name: "Compiled Controls Suite", raw: id };
  if (id.includes("selftest")) return { name: "Selftest Suite", raw: id };
  return { name: id, raw: id };
}

/** "AP Agent — Careful", with the implementation id kept for the muted line beneath. */
export function agentDisplay(name: string | undefined): string {
  if (!name) return "unknown agent";
  if (name === "reference-careful-tools") return "AP Agent — Careful";
  if (name === "reference-naive-tools") return "AP Agent — Naive";
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(name)) return "External Agent";
  if (/^[\w.-]+:\d+$/.test(name)) return `External Agent · ${name.split(":")[0]}`;
  return name;
}

/** A version label as recorded: customer labels are shown as written; a bare semver gets a v. */
export const versionLabel = (version?: string) => (!version || version === "external" ? "" : /^v/i.test(version) || !/^\d/.test(version) ? version : `v${version}`);
export const agentRaw = (name: string, version?: string) => `${name}${versionLabel(version) ? ` ${versionLabel(version)}` : ""}`;

/** "AP Agent — Careful v0.3.2", or the model behind an external endpoint; never a host and port as the headline. */
export function agentTitle(r: { agent: { name: string; version: string; subject?: { model?: string } } }): string {
  const name = agentDisplay(r.agent.name);
  if (r.agent.version === "external") return r.agent.subject?.model ? `${name} · ${modelDisplay(r.agent.subject.model)}` : `${name} · ${r.agent.name}`;
  return `${name} v${r.agent.version}`;
}

/** The version cell: the model for an external endpoint, the version otherwise. */
export const agentVersionLabel = (r: { agent: { name: string; version: string; subject?: { model?: string } } }) => (r.agent.version === "external" ? (r.agent.subject?.model ? modelDisplay(r.agent.subject.model) : r.agent.name) : `v${r.agent.version}`);

/** A readable model name from what an endpoint reported; never invented when nothing was reported. */
export function modelDisplay(model?: string, source?: string): string {
  if (!model) return "model not reported";
  // Ids arrive as the endpoint reported them: a bare alias from the Claude
  // bridge ("opus"), a gateway id ("openai/gpt-4o-mini") or a dated snapshot.
  // The family is made readable and the rest of the id is kept word for word,
  // because two versions of one family are two different subjects.
  const raw = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
  if (raw === "claude-code-default") return `Claude (CLI default)${source === "self-reported" ? " (self-reported)" : ""}`;
  const tokens = raw.toLowerCase().split(/[-_]/);
  const families: [string, string][] = [["opus", "Claude Opus"], ["sonnet", "Claude Sonnet"], ["haiku", "Claude Haiku"], ["claude", "Claude"], ["gpt", "GPT"], ["gemini", "Gemini"], ["grok", "Grok"], ["llama", "Llama"], ["mistral", "Mistral"], ["mixtral", "Mixtral"], ["deepseek", "DeepSeek"], ["qwen", "Qwen"]];
  let pretty = raw;
  for (const [token, name] of families) {
    const i = tokens.indexOf(token);
    if (i === -1) continue;
    const tail = tokens.slice(i + 1).filter((t) => t !== "claude" && t !== "chat" && t !== "latest");
    pretty = [name, ...tail].join(" ");
    break;
  }
  return `${pretty}${source === "self-reported" ? " (self-reported)" : ""}`;
}
