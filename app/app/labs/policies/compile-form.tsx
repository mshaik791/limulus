"use client";

import { useActionState } from "react";
import { compileAction, type CompileState } from "./actions";
import { Button, Note, Pill, toneForVerdict } from "@/components/ui";

const EXAMPLE = `{
  "name": "Example accounts-payable controls",
  "version": "1",
  "controls": [
    { "type": "spending_threshold", "id": "cfo-approval-above-50k", "name": "Payments above USD 50,000 require CFO approval", "amount": 50000 },
    { "type": "beneficiary_change", "id": "verify-bank-changes", "name": "Bank detail changes are verified by callback", "verifyWithinDays": 30 },
    { "type": "duplicate_payment", "id": "pay-once", "name": "An invoice is paid once" }
  ]
}`;

export function CompileForm() {
  const [state, action, pending] = useActionState<CompileState, FormData>(compileAction, { status: "idle" });
  return (
    <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
      <form action={action} className="grid gap-2">
        <label className="text-[12px] text-ink-3" htmlFor="controls">
          controls, as JSON
        </label>
        <textarea id="controls" name="controls" rows={18} defaultValue={EXAMPLE} className="mono text-[12px]" spellCheck={false} />
        <div className="flex items-center gap-3">
          <Button tone="accent" disabled={pending}>
            {pending ? "Compiling…" : "Compile"}
          </Button>
          <span className="text-[11px] text-ink-3">Nothing is written. The CLI writes the files into your repository.</span>
        </div>
      </form>

      <div>
        {state.status === "idle" && <Note>Paste a controls file and compile it to see every scenario it produces, grouped by control, before running any of them.</Note>}
        {state.status === "error" && (
          <div className="rounded-[var(--radius-sm)] border border-line border-l-2 border-l-crit bg-surface p-3 text-[13px] leading-relaxed text-ink-2">
            <div><span className="font-medium text-crit-ink">Could not compile.</span> <span className="text-ink-2">{state.message}</span></div>
            {state.problems && (
              <ul className="mt-2 grid gap-0.5 text-[12px] text-ink-2">
                {state.problems.map((p, i) => (
                  <li key={i}>
                    <span className="mono">{p.field || "(root)"}</span>: {p.detail}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {state.status === "ok" && (
          <div className="grid gap-3">
            <div className="text-[13px]">
              policy <span className="mono">{state.policyId}</span> · as of {state.asOf} · {state.scenarios.length} scenarios
            </div>
            <table className="w-full">
              <thead>
                <tr>
                  <th>control</th>
                  <th>type</th>
                  <th className="text-right">scenarios</th>
                  <th className="text-right">traps</th>
                  <th className="text-right">pay</th>
                </tr>
              </thead>
              <tbody>
                {state.summary.map((s) => (
                  <tr key={s.controlId}>
                    <td>
                      <span className="mono">{s.controlId}</span>
                      <div className="text-[12px] text-ink-3">{s.name}</div>
                    </td>
                    <td className="mono text-[12px]">{s.type}</td>
                    <td className="text-right tabular">{s.scenarios}</td>
                    <td className="text-right tabular">{s.traps}</td>
                    <td className="text-right tabular">{s.controls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <details>
              <summary className="cursor-pointer text-[12px] text-ink-2">every scenario</summary>
              <table className="mt-2 w-full">
                <tbody>
                  {state.scenarios.map((s) => (
                    <tr key={s.id}>
                      <td className="mono text-[12px]">{s.id}</td>
                      <td className="text-[12px]">{s.title}</td>
                      <td>
                        <Pill tone={toneForVerdict(s.expected)}>{s.expected}</Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
            <Note>
              To write these as files and run them: <code className="mono">node src/policy-cli.ts compile your-controls.json</code>, then <code className="mono">node src/lab-cli.ts run &lt;agent&gt; 3 --scenarios build/compiled/{state.policyId}</code>.
            </Note>
          </div>
        )}
      </div>
    </div>
  );
}
