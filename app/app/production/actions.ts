"use server";

import { revalidatePath } from "next/cache";
import { reviewShadow } from "@/lib/api";

export async function reviewAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const verdict = String(formData.get("verdict") ?? "");
  const note = String(formData.get("note") ?? "");
  await reviewShadow(id, verdict, note);
  revalidatePath(`/production/${id}`);
  revalidatePath("/production");
}
