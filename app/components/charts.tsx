import type { Dimension } from "@/lib/api";
import { int } from "@/lib/format";

// The few marks this console draws. Thin bars with a rounded data end and a
// square base, hairline tracks, a 2px line for a sparkline. Text never wears a
// data colour; the colour sits in the mark beside it.

const AXES: { key: "safety" | "capability" | "recovery" | "reliability"; label: string; hint: string }[] = [
  { key: "safety", label: "Safety", hint: "no critical violation, severity weighted" },
  { key: "capability", label: "Capability", hint: "completed the legitimate work" },
  { key: "recovery", label: "Recovery", hint: "handled a rail that misbehaved" },
  { key: "reliability", label: "Reliability", hint: "same answer across trials" },
];

/** The four axes as bars, each with its n. A radar hides which axis has no data; bars cannot. */
export function AxesBars({ axes, compact = false }: { axes: { safety: Dimension; capability: Dimension; recovery: Dimension; reliability: Dimension | null }; compact?: boolean }) {
  return (
    <div className={`grid gap-${compact ? "1.5" : "2.5"}`}>
      {AXES.map(({ key, label, hint }) => {
        const d = axes[key];
        const score = d ? d.score : null;
        const n = d ? d.sampleSize : 0;
        return (
          <div key={key} className="grid grid-cols-[92px_1fr_max-content] items-center gap-3">
            <div className="text-[12px] text-ink-2" title={hint}>
              {label}
            </div>
            <div className="relative h-[10px] overflow-hidden rounded-r-[4px] bg-raised">
              {score !== null && n > 0 && (
                <div className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${Math.max(1, score)}%`, background: barColour(score) }} />
              )}
            </div>
            <div className="w-[96px] text-right text-[12px] tabular">
              {score === null || n === 0 ? (
                <span className="text-ink-3">not measured</span>
              ) : (
                <>
                  <span className="font-medium">{score}</span>
                  <span className="ml-1 text-ink-3">n={int(n)}</span>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One hue for magnitude. Status colour only where the number itself is a status: a safety score with criticals is red elsewhere, not here. */
const barColour = (score: number) => (score >= 90 ? "var(--accent)" : score >= 50 ? "color-mix(in oklab, var(--accent) 70%, var(--bg))" : "color-mix(in oklab, var(--accent) 45%, var(--bg))");

/** A 2px line over a short series. One series, so no legend; the title names it. */
export function Sparkline({ values, width = 120, height = 28, max = 100 }: { values: number[]; width?: number; height?: number; max?: number }) {
  if (values.length < 2) return <span className="text-[11px] text-ink-3">{values.length === 1 ? "one run" : "no runs"}</span>;
  const pad = 3;
  const step = (width - pad * 2) / (values.length - 1);
  const y = (v: number) => height - pad - (Math.max(0, Math.min(max, v)) / max) * (height - pad * 2);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${(pad + i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label={`${values.length} runs, latest ${last}`} role="img">
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pad + (values.length - 1) * step} cy={y(last)} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
    </svg>
  );
}

/** Grouped horizontal bars: one row per axis, one bar per arm, arm colours in fixed order. Legend lives with the table beside it. */
export function ArmBars({ arms }: { arms: { label: string; axes: { safety: { score: number; n: number }; capability: { score: number; n: number }; recovery: { score: number; n: number }; reliability: { score: number; n: number } | null } }[] }) {
  return (
    <div className="grid gap-3">
      {AXES.map(({ key, label }) => (
        <div key={key} className="grid grid-cols-[92px_1fr] items-start gap-3">
          <div className="pt-0.5 text-[12px] text-ink-2">{label}</div>
          <div className="grid gap-[2px]">
            {arms.map((a, i) => {
              const r = a.axes[key];
              return (
                <div key={a.label} className="grid grid-cols-[1fr_84px] items-center gap-2">
                  <div className="relative h-[8px] overflow-hidden rounded-r-[4px] bg-raised">
                    {r && r.n > 0 && <div className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${Math.max(1, r.score)}%`, background: `var(--arm-${(i % 4) + 1})` }} />}
                  </div>
                  <div className="text-[11px] tabular text-ink-3">{r && r.n > 0 ? `${r.score}  n=${r.n}` : "not measured"}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ArmSwatch({ index }: { index: number }) {
  return <span aria-hidden className="inline-block h-[10px] w-[10px] rounded-[2px] align-middle" style={{ background: `var(--arm-${(index % 4) + 1})` }} />;
}
