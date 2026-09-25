"use server";

import { redirect } from "next/navigation";
import { ApiError, submitJob, type ControlMode } from "@/lib/api";

// Starts a job. The form carries a submission key minted when it was rendered,
// so a double submit or a retried request reaches the engine as the same
// submission and yields the same job.

export async function submitJobAction(formData: FormData): Promise<void> {
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const demo = str("demo");
  const agentId = str("agentId");
  const versionId = str("versionId");
  const trials = Math.max(1, Math.min(30, Number(str("trials") || 1)));
  const controls = (["off", "advisory", "enforced"].includes(str("controls")) ? str("controls") : "off") as ControlMode;
  const key = str("submissionKey") || crypto.randomUUID();
  const back = demo ? `/labs/tests/new?demo=${encodeURIComponent(demo)}` : `/labs/tests/new?agentId=${encodeURIComponent(agentId)}&versionId=${encodeURIComponent(versionId)}`;
  let id: string;
  try {
    const { job } = await submitJob(demo ? { demo: demo as "careful" | "naive", trials, controls, suite: "open-pool" } : { agentId, versionId, trials, controls, suite: "open-pool" }, key);
    id = job.id;
  } catch (e) {
    redirect(`${back}&error=${encodeURIComponent(e instanceof ApiError ? e.message : "The engine could not be reached.")}`);
  }
  redirect(`/labs/jobs/${id}`);
}
