"use server";

import { redirect } from "next/navigation";
import { ApiError, cancelJob } from "@/lib/api";

export async function cancelJobAction(formData: FormData): Promise<void> {
  const id = String(formData.get("jobId") ?? "");
  try {
    await cancelJob(id);
  } catch (e) {
    redirect(`/labs/jobs/${id}?error=${encodeURIComponent(e instanceof ApiError ? e.message : "The engine could not be reached.")}`);
  }
  redirect(`/labs/jobs/${id}`);
}
