"use server";

import { redirect } from "next/navigation";
import { ApiError, checkAgent, createAgent, createVersion, updateAgent } from "@/lib/api";

// Registration and connection checks. The credential goes straight from the
// form to the engine's secret store over the server; it is never rendered,
// logged or placed in a URL. Errors come back as a sanitized message.

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const fail = (e: unknown) => (e instanceof ApiError ? e.message : "The engine could not be reached.");

export async function createAgentAction(formData: FormData): Promise<void> {
  const value = str(formData, "authValue");
  const body = {
    name: str(formData, "name"),
    workflow: str(formData, "workflow"),
    endpoint: str(formData, "endpoint"),
    ...(value ? { auth: { header: (str(formData, "authHeader") === "x-api-key" ? "x-api-key" : "authorization") as "authorization" | "x-api-key", scheme: (str(formData, "authScheme") === "raw" ? "raw" : "bearer") as "bearer" | "raw", value } } : {}),
    version: {
      label: str(formData, "versionLabel"),
      ...(str(formData, "model") ? { model: str(formData, "model") } : {}),
      ...(str(formData, "modelVersion") ? { modelVersion: str(formData, "modelVersion") } : {}),
      ...(str(formData, "temperature") !== "" && Number.isFinite(Number(str(formData, "temperature"))) ? { temperature: Number(str(formData, "temperature")) } : {}),
      ...(str(formData, "note") ? { note: str(formData, "note") } : {}),
    },
  };
  let id: string;
  try {
    const { agent } = await createAgent(body);
    id = agent.id;
  } catch (e) {
    redirect(`/labs/agents/new?error=${encodeURIComponent(fail(e))}`);
  }
  // The first check runs at once, so the agent page opens with a real state.
  try {
    await checkAgent(id);
  } catch {
    /* the page shows "not checked" and offers the check again */
  }
  redirect(`/labs/agents/${id}`);
}

export async function checkAgentAction(formData: FormData): Promise<void> {
  const id = str(formData, "agentId");
  try {
    await checkAgent(id);
  } catch (e) {
    redirect(`/labs/agents/${id}?error=${encodeURIComponent(fail(e))}`);
  }
  redirect(`/labs/agents/${id}`);
}

export async function toggleAgentAction(formData: FormData): Promise<void> {
  const id = str(formData, "agentId");
  try {
    await updateAgent(id, { enabled: str(formData, "enabled") === "true" });
  } catch (e) {
    redirect(`/labs/agents/${id}?error=${encodeURIComponent(fail(e))}`);
  }
  redirect(`/labs/agents/${id}`);
}

export async function updateConnectionAction(formData: FormData): Promise<void> {
  const id = str(formData, "agentId");
  const value = str(formData, "authValue");
  const patch: Parameters<typeof updateAgent>[1] = {};
  if (str(formData, "endpoint")) patch.endpoint = str(formData, "endpoint");
  if (str(formData, "clearAuth") === "true") patch.auth = null;
  else if (value) patch.auth = { header: (str(formData, "authHeader") === "x-api-key" ? "x-api-key" : "authorization") as "authorization" | "x-api-key", scheme: (str(formData, "authScheme") === "raw" ? "raw" : "bearer") as "bearer" | "raw", value };
  try {
    await updateAgent(id, patch);
    await checkAgent(id);
  } catch (e) {
    redirect(`/labs/agents/${id}?error=${encodeURIComponent(fail(e))}`);
  }
  redirect(`/labs/agents/${id}`);
}

export async function createVersionAction(formData: FormData): Promise<void> {
  const id = str(formData, "agentId");
  try {
    await createVersion(id, {
      label: str(formData, "label"),
      ...(str(formData, "model") ? { model: str(formData, "model") } : {}),
      ...(str(formData, "modelVersion") ? { modelVersion: str(formData, "modelVersion") } : {}),
      ...(str(formData, "temperature") !== "" && Number.isFinite(Number(str(formData, "temperature"))) ? { temperature: Number(str(formData, "temperature")) } : {}),
      ...(str(formData, "note") ? { note: str(formData, "note") } : {}),
    });
  } catch (e) {
    redirect(`/labs/agents/${id}?error=${encodeURIComponent(fail(e))}`);
  }
  redirect(`/labs/agents/${id}`);
}
