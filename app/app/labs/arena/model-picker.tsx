"use client";

import { useMemo, useState } from "react";
import type { ModelEntry } from "@/lib/models";
import { ProviderMark } from "@/components/provider-mark";

// Pick models from what the model agent's providers say they serve. A search
// box, then checkboxes grouped by vendor; the chosen ids are the form's
// "model" values. Nothing here is a model list of its own.

export function ModelPicker({ models, vendors }: { models: ModelEntry[]; vendors: Record<string, string> }) {
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? models.filter((m) => m.id.toLowerCase().includes(needle)) : models;
    const byVendor = new Map<string, ModelEntry[]>();
    for (const m of list) byVendor.set(m.provider, [...(byVendor.get(m.provider) ?? []), m]);
    return [...byVendor.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  }, [models, q]);
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`search ${models.length} models`} aria-label="search models" className="w-full" />
        <span className="shrink-0 text-[12px] tabular text-ink-3">{chosen.length} picked</span>
      </div>
      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map((id) => (
            <button key={id} type="button" onClick={() => toggle(id)} className="mono rounded-full border border-model/50 bg-model-soft px-2 py-[2px] text-[11px] text-model-ink" title="remove">
              {id} ×
            </button>
          ))}
        </div>
      )}
      {chosen.map((id) => (
        <input key={id} type="hidden" name="model" value={id} />
      ))}
      <div className="max-h-[260px] overflow-y-auto rounded-[var(--radius-sm)] border border-line">
        {shown.length === 0 && <p className="p-3 text-[12.5px] text-ink-3">No model matches.</p>}
        {shown.map(([vendor, list]) => (
          <div key={vendor}>
            <div className="sticky top-0 flex items-center gap-2 bg-surface-2 px-3 py-1 text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
              <ProviderMark model={list[0]?.id} size={12} className="text-ink-2" />
              {vendors[vendor] ?? vendor} · {list.length}
              {list[0]?.through ? ` · via ${list[0].through}` : list[0]?.via === "claude-cli" ? " · no key needed" : ""}
            </div>
            {list.slice(0, 40).map((m) => (
              <label key={m.id} className="flex cursor-pointer items-center gap-2 px-3 py-1 text-[12.5px] hover:bg-surface-2">
                <input type="checkbox" checked={chosen.includes(m.id)} onChange={() => toggle(m.id)} />
                <span className="mono truncate">{m.id.slice(m.id.indexOf("/") + 1)}</span>
              </label>
            ))}
            {list.length > 40 && <p className="px-3 py-1 text-[11.5px] text-ink-3">{list.length - 40} more; search to narrow.</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

const ORDER = ["claude-cli", "anthropic", "openai", "google", "xai", "meta", "mistral", "deepseek"];
const rank = (v: string) => (ORDER.includes(v) ? ORDER.indexOf(v) : ORDER.length);
