"use server";

import { redirect } from "next/navigation";
import { runLab } from "@/lib/api";

// Run Test. The engine runs the suite in-process and seals the record; this
// only carries the form to it and lands on the result.

export async function runTestAction(formData: FormData): Promise<void> {
  const agent = String(formData.get("agent") ?? "careful");
  const endpoint = String(formData.get("endpoint") ?? "").trim();
  const trials = Math.max(1, Math.min(30, Number(formData.get("trials") ?? 3)));
  let id: string;
  try {
    const { run } = await runLab(endpoint ? { endpoint, trials } : { agent, trials });
    id = run.id;
  } catch (e) {
    redirect(`/labs?error=${encodeURIComponent((e as Error).message)}`);
  }
  redirect(`/labs/tests/${id}`);
}
