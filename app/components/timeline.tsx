"use client";

import { useEffect, useState } from "react";
import type { ToolCall, Violation } from "@/lib/api";
import type { TrajectoryStep } from "@/lib/derive";
import { ms } from "@/lib/format";

// Replay timelines. Every agent action is inspectable; the failing node is the
// one the graders anchored a finding to, not one a designer picked.

const glyph = { ok: "✓", warn: "!", fail: "✕", info: "·" } as const;
const tone = { ok: "text-good-ink", warn: "text-warn-ink", fail: "text-crit-ink", info: "text-ink-3" } as const;
const dot = { ok: "bg-good", warn: "bg-warn", fail: "bg-crit", info: "bg-ink-3" } as const;

/** The compact form used on cards: label and glyph per step. */
export function Trajectory({ steps, decision }: { steps: TrajectoryStep[]; decision?: { label: string; state: "ok" | "fail" | "warn" } }) {
  return (
    <ol className="grid gap-1.5">
      {steps.map((s, i) => (
        <li key={i} className="grid grid-cols-[18px_1fr_auto] items-baseline gap-2 text-[13px]">
          <span aria-hidden className={`font-semibold ${tone[s.status]}`}>{glyph[s.status]}</span>
          <span className={s.status === "fail" ? "text-ink" : "text-ink-2"}>{s.label}</span>
          {s.detail && <span className="text-[11.5px] text-ink-3">{s.detail}</span>}
        </li>
      ))}
      {decision && (
        <li className="mt-2 flex items-center gap-2 border-t border-line pt-2 text-[12px]">
          <span className="text-ink-3">Decision</span>
          <span className={`font-semibold tracking-[0.06em] ${decision.state === "fail" ? "text-crit-ink" : decision.state === "warn" ? "text-warn-ink" : "text-good-ink"}`}>{decision.label}</span>
        </li>
      )}
    </ol>
  );
}

/**
 * The full form on the replay screen: scrub through the calls with the arrow
 * keys or the slider, and see each call's arguments, result and any finding
 * the graders anchored to it.
 */
export function Scrubber({ calls, findingsBySeq, steps }: { calls: ToolCall[]; findingsBySeq: Record<number, Violation[]>; steps: TrajectoryStep[] }) {
  const firstFail = steps.findIndex((s) => s.status === "fail");
  const [idx, setIdx] = useState(firstFail >= 0 ? firstFail : calls.length - 1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setIdx((i) => Math.min(calls.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [calls.length]);

  if (calls.length === 0) return <p className="text-[13px] text-ink-3">The agent made no tool calls.</p>;
  const call = calls[idx];
  const step = steps[idx];
  const findings = findingsBySeq[call.seq] ?? [];

  return (
    <div className="grid gap-5">
      <ol className="relative grid grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-1">
        <div aria-hidden className="absolute left-3 right-3 top-[9px] h-px bg-line" />
        {steps.map((s, i) => (
          <li key={i} className="relative">
            <button type="button" onClick={() => setIdx(i)} className="group flex w-full flex-col items-center gap-1.5 text-center" aria-current={i === idx}>
              <span className={`z-10 h-[18px] w-[18px] rounded-full border-2 ${i === idx ? "border-ink" : "border-surface"} ${dot[s.status]} ${i <= idx ? "" : "opacity-40"}`} />
              <span className={`text-[11px] leading-tight ${i === idx ? "text-ink" : "text-ink-3"}`}>
                {i + 1}. {s.label}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="flex items-center gap-3">
        <input type="range" min={0} max={calls.length - 1} value={idx} onChange={(e) => setIdx(Number(e.target.value))} className="w-full accent-[var(--accent)]" aria-label="step" />
        <span className="w-[72px] text-right text-[11px] tabular text-ink-3">
          {idx + 1} / {calls.length}
        </span>
      </div>

      <div className={`rounded-[var(--radius)] border p-4 ${findings.some((f) => f.severity === "critical") ? "border-crit/40 bg-crit-soft/40" : findings.length ? "border-warn/40 bg-warn-soft/30" : "border-line bg-surface-2"}`}>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="text-[11px] tabular text-ink-3">
            {call.seq}. +{ms(call.elapsedMs)}
          </span>
          <span className="mono text-[14px] font-semibold">{call.tool}</span>
          <span className={`text-[12px] ${tone[step.status]}`}>
            {glyph[step.status]} {step.label}
            {step.detail ? ` · ${step.detail}` : ""}
          </span>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Json label="arguments" value={call.args} />
          <Json label="result" value={call.result} />
        </div>
        {findings.length > 0 && (
          <ul className="mt-3 grid gap-2 border-t border-line pt-3">
            {findings.map((f, i) => (
              <li key={i} className="text-[12.5px]">
                <span className={`mr-2 font-semibold uppercase tracking-[0.06em] ${f.severity === "critical" ? "text-crit-ink" : "text-warn-ink"}`}>{f.severity}</span>
                <span className="mono mr-2">{f.code}</span>
                <span className="text-ink-2">{f.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[11px] text-ink-3">← → to step. The highlighted step is the first one the graders anchored a critical finding to.</p>
    </div>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  const text = JSON.stringify(value, null, 1)?.replace(/\n\s*/g, " ") ?? "";
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10.5px] uppercase tracking-[0.06em] text-ink-3">{label}</div>
      <pre className="whitespace-pre-wrap break-all rounded-[var(--radius-sm)] bg-sunken px-2.5 py-2 text-[11.5px] leading-snug text-ink-2">{text.length > 900 ? `${text.slice(0, 900)}…` : text}</pre>
    </div>
  );
}
