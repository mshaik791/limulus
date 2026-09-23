"use server";

import { redirect } from "next/navigation";
import { runCompare, type ControlMode } from "@/lib/api";

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
