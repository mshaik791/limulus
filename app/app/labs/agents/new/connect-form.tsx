"use client";

import { useState } from "react";
import { createAgentAction } from "../actions";

// The smallest form that yields a first successful connection: name,
// endpoint, how to authenticate, a version label. Everything else is folded
// away and still recorded with its provenance when given. The credential
// field exists only once an authentication method is chosen, and it goes to
// the server action as a password field, never anywhere else.

export function ConnectForm() {
  const [auth, setAuth] = useState<"none" | "bearer" | "apikey">("none");
  return (
    <form action={createAgentAction} className="labs-panel labs-form">
      <label><span>Agent name</span><input name="name" required maxLength={120} placeholder="Invoice Payment Agent" autoComplete="off" /></label>
      <label><span>Endpoint URL</span><input name="endpoint" type="url" required inputMode="url" placeholder="https://agent.example.com/limulus" autoComplete="off" /><small>A test-only endpoint that speaks the Limulus agent protocol. Receives one POST per step.</small></label>

      <label><span>Authentication</span>
        <select name="authType" value={auth} onChange={(e) => setAuth(e.target.value as typeof auth)}>
          <option value="none">None</option>
          <option value="bearer">Bearer token</option>
          <option value="apikey">API key</option>
        </select>
      </label>
      {auth !== "none" && (
        <div className="labs-auth-block">
          <label><span>{auth === "bearer" ? "Token" : "API key"}</span><input name="authValue" type="password" autoComplete="off" required placeholder={auth === "bearer" ? "sent as Authorization: Bearer …" : "sent as X-API-Key: …"} /><small>Stored in the engine&apos;s secret store under a reference. Never shown again, never in a test record or an export.</small></label>
          <details className="labs-advanced">
            <summary>Advanced: header</summary>
            <label><span>Send it in</span>
              <select name="authHeader" defaultValue={auth === "bearer" ? "authorization" : "x-api-key"}>
                <option value="authorization">Authorization header{auth === "bearer" ? " (Bearer …)" : " (raw value)"}</option>
                <option value="x-api-key">X-API-Key header</option>
              </select>
            </label>
          </details>
        </div>
      )}

      <label><span>Agent version</span><input name="versionLabel" required maxLength={60} placeholder="v1.0" autoComplete="off" /><small>Your label for this configuration. Every test binds to a version; when the agent changes, record a new one.</small></label>

      <details className="labs-advanced">
        <summary>Optional configuration details</summary>
        <label><span>Workflow <em>optional</em></span><input name="workflow" maxLength={120} placeholder="Accounts payable: vendor invoices" /></label>
        <div className="labs-field-row">
          <label><span>Model <em>declared</em></span><input name="model" maxLength={120} placeholder="e.g. openai/gpt-4.1" /></label>
          <label><span>Model version</span><input name="modelVersion" maxLength={120} /></label>
          <label><span>Temperature</span><input name="temperature" type="number" step="0.1" min={0} max={2} /></label>
        </div>
        <label><span>Notes</span><input name="note" maxLength={500} placeholder="prompt revision, tool set, anything that identifies this configuration" /></label>
        <p className="labs-muted">Recorded as your statement, with that provenance. The model an endpoint reports on each step is recorded separately as self-reported.</p>
      </details>

      <div className="labs-actions">
        <button type="submit" className="labs-primary-button">Connect and check</button>
        <span className="labs-muted labs-helper">Saves your agent and sends one compatibility-check request. A full test starts separately.</span>
      </div>
    </form>
  );
}
