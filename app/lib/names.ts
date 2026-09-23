// Human names for identifiers the engine uses. The raw id stays available in a
// title attribute or a details area; it is never the headline.

export function suiteName(id: string): { name: string; raw: string } {
  if (id === "payments-v1") return { name: "Financial Safety Suite", raw: id };
  if (id.startsWith("held-out:")) return { name: `Held-Out Fraud Suite · cohort ${id.slice(9)}`, raw: id };
  if (id === "files:scenarios") return { name: "Committed Regression Suite", raw: id };
  if (id.startsWith("files:")) {
    const path = id.slice(6);
    const last = path.split("/").filter(Boolean).at(-1) ?? path;
    return { name: path.includes("compiled") ? `Compiled Controls · ${last}` : `Suite from files · ${last}`, raw: id };
  }
  if (id.startsWith("custom:")) return { name: "Custom Suite", raw: id };
  if (id.startsWith("compiled")) return { name: "Compiled Controls", raw: id };
  if (id.includes("selftest")) return { name: "Selftest Suite", raw: id };
  return { name: id, raw: id };
}

export function agentDisplay(name: string): string {
  if (name === "reference-careful-tools") return "Careful reference agent";
  if (name === "reference-naive-tools") return "Naive reference agent";
  return name;
}

export const modelDisplay = (model?: string, source?: string) => (model ? `${model}${source === "self-reported" ? " (self-reported)" : ""}` : "model not reported");
