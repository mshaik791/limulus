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
export function agentDisplay(name: string): string {
  if (name === "reference-careful-tools") return "AP Agent — Careful";
  if (name === "reference-naive-tools") return "AP Agent — Naive";
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(name)) return "External Agent";
  if (/^[\w.-]+:\d+$/.test(name)) return `External Agent · ${name.split(":")[0]}`;
  return name;
}

export const agentRaw = (name: string, version?: string) => `${name}${version ? ` v${version}` : ""}`;

/** A readable model name from what an endpoint reported; never invented when nothing was reported. */
export function modelDisplay(model?: string, source?: string): string {
  if (!model) return "model not reported";
  const m = model.toLowerCase();
  let pretty = model;
  if (m.includes("claude")) pretty = m.includes("opus") ? "Claude Opus" : m.includes("sonnet") ? "Claude Sonnet" : m.includes("haiku") ? "Claude Haiku" : "Claude";
  else if (m.startsWith("gpt") || m.includes("openai")) pretty = "GPT";
  else if (m.includes("gemini")) pretty = "Gemini";
  return `${pretty}${source === "self-reported" ? " (self-reported)" : ""}`;
}
