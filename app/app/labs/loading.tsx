// Instant fallback while a Labs route's server components fetch from the engine. The shell and
// sub-tab nav (rendered by ShellFrame) stay put; only the content area shimmers — so navigation
// feels immediate. Matters most on the deployed demo, where the engine round-trip has real latency.
export default function Loading() {
  return (
    <div className="labs-skel" aria-busy="true" aria-live="polite" aria-label="Loading">
      <div className="labs-skel-bar" style={{ width: "160px", height: "38px" }} />
      <div className="labs-skel-bar" style={{ width: "min(560px, 70%)", height: "16px", marginTop: "16px" }} />
      <div className="labs-skel-grid">
        <div className="labs-skel-panel" />
        <div className="labs-skel-panel" />
      </div>
    </div>
  );
}
