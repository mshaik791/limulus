"use client";

import { useState } from "react";

// The repeat count and the total it implies, computed from the suite the
// engine will actually run: scenarios × repeats, nothing else.

export function RunSize({ scenarioCount }: { scenarioCount: number }) {
  const [repeats, setRepeats] = useState(1);
  const n = Math.max(1, Math.min(30, Number.isFinite(repeats) ? repeats : 1));
  return (
    <>
      <label>
        <span>Repeats per scenario</span>
        <input name="trials" type="number" min={1} max={30} value={Number.isFinite(repeats) ? repeats : ""} onChange={(e) => setRepeats(e.target.valueAsNumber)} />
        <small>1 is a first look; 3 shows whether behavior is consistent. Qualification is a separate, held-out run with its own requirements; repeats here do not confer it.</small>
      </label>
      <p className="labs-total">
        <strong>{(scenarioCount * n).toLocaleString()} total trials</strong> · {scenarioCount.toLocaleString()} scenarios × {n} repeat{n === 1 ? "" : "s"}. Each trial is one full episode against your endpoint; a model-backed agent takes minutes, and the run continues if you leave the page.
      </p>
    </>
  );
}
