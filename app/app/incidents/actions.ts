"use server";

import { revalidatePath } from "next/cache";
import { decideCandidate } from "@/lib/api";

export async function decideAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "") === "approve" ? "approve" : "reject";
  const reason = String(formData.get("reason") ?? "");
  await decideCandidate(id, decision, reason);
  revalidatePath("/incidents");
}
