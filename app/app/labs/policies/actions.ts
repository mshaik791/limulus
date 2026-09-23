"use server";

import { compilePolicy } from "@/lib/api";

export type CompileState =
  | { status: "idle" }
  | { status: "error"; message: string; problems?: { field: string; detail: string }[] }
  | {
      status: "ok";
      policyId: string;
      asOf: string;
      summary: { controlId: string; type: string; name: string; scenarios: number; traps: number; controls: number }[];
      scenarios: { id: string; title: string; expected: string; severity: string; case: string; controlId: string }[];
    };

// Compiles pasted controls through the engine and returns the summary. The
// files themselves are written by the CLI into the customer's repository; this
// screen shows what would come out, and the command that writes it.

export async function compileAction(_prev: CompileState, formData: FormData): Promise<CompileState> {
  const raw = String(formData.get("controls") ?? "");
  let profile: unknown;
  try {
    profile = JSON.parse(raw);
  } catch (e) {
    return { status: "error", message: `Not valid JSON: ${(e as Error).message}` };
  }
  try {
    const result = await compilePolicy(profile);
    return {
      status: "ok",
      policyId: result.policyId,
      asOf: result.asOf,
      summary: result.summary,
      scenarios: result.scenarios.map((s) => ({ id: s.id, title: s.title, expected: s.expected, severity: s.severity, case: s.compiledFrom?.case ?? "", controlId: s.compiledFrom?.controlId ?? "" })),
    };
  } catch (e) {
    const err = e as Error & { status?: number };
    // The engine returns problems as a list; surface them as-is.
    try {
      const parsed = JSON.parse(err.message);
      return { status: "error", message: "The controls did not validate.", problems: parsed.problems };
    } catch {
      return { status: "error", message: err.message };
    }
  }
}
