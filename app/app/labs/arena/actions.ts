"use server";

import { redirect } from "next/navigation";
import { runCompare, type ControlMode } from "@/lib/api";
import { armLabel, modelEndpoint } from "@/lib/models";

// Runs a comparison through the engine. The arms come from the form as
// "<agent>:<mode>" pairs; nothing is computed here, the engine seals the record.

export async function startCompare(formData: FormData): Promise<void> {
  const arms: { label: string; agent: string; controls: ControlMode }[] = [];
  for (let i = 1; i <= 4; i++) {
    const agent = String(formData.get(`agent${i}`) ?? "");
    const controls = String(formData.get(`controls${i}`) ?? "off") as ControlMode;
    if (!agent) continue;
    arms.push({ label: `${agent}:${controls}`, agent, controls });
  }
  const trials = Math.max(1, Math.min(30, Number(formData.get("trials") ?? 3)));
  if (arms.length < 2) redirect("/labs/arena?error=two-arms");
  let id: string;
  try {
    const record = await runCompare({ arms, trials });
    id = record.id;
  } catch (e) {
    redirect(`/labs/arena?error=${encodeURIComponent((e as Error).message)}`);
  }
  redirect(`/labs/arena/${id}`);
}

/**
 * Compares models. Each chosen id becomes an arm whose endpoint is the model
 * agent with that id; the agent reports the model per step, so the record
 * lands in the Models tab. Same suite, same gate mode, same trials for all.
 */
export async function startModelCompare(formData: FormData): Promise<void> {
  const picked = formData.getAll("model").map(String).filter(Boolean);
  const typed = String(formData.get("custom") ?? "")
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const ids = [...new Set([...picked, ...typed])];
  const controls = String(formData.get("controls") ?? "off") as ControlMode;
  const trials = Math.max(1, Math.min(30, Number(formData.get("trials") ?? 1)));
  if (ids.length < 2) redirect("/labs/arena?error=two-models");
  if (ids.length > 6) redirect("/labs/arena?error=too-many-models");
  const arms = ids.map((id) => ({ label: armLabel(id), agent: id, endpoint: modelEndpoint(id), controls }));
  let id: string;
  try {
    const record = await runCompare({ arms, trials });
    id = record.id;
  } catch (e) {
    redirect(`/labs/arena?error=${encodeURIComponent((e as Error).message)}`);
  }
  redirect(`/labs/arena/${id}`);
}
