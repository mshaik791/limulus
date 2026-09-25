"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-[var(--radius)] border border-line border-l-2 border-l-crit bg-surface p-4 text-[13px]">
      <div className="text-ink">Something failed while reading the engine.</div>
      <pre className="mt-2 whitespace-pre-wrap text-[12px] text-ink-3">{error.message}</pre>
      <button onClick={reset} className="mt-3 rounded-[var(--radius-sm)] border border-line-2 bg-surface px-3 py-1.5 text-ink hover:border-line-hover">
        Try again
      </button>
    </div>
  );
}
