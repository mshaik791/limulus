"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-[var(--radius)] border border-crit/40 bg-crit-soft p-4 text-[13px]">
      <div className="text-crit-ink">Something failed while reading the engine.</div>
      <pre className="mt-2 whitespace-pre-wrap text-[12px] text-ink-2">{error.message}</pre>
      <button onClick={reset} className="mt-3 rounded-[var(--radius-sm)] border border-line-strong px-3 py-1">
        Try again
      </button>
    </div>
  );
}
