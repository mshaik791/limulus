// Evidence thresholds and release criteria. These are defaults, not laws:
// every screen that uses one says "default" beside it. Override with the
// environment variables named here.

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const CONFIG = {
  /** Below this many episodes a comparison is "insufficient data". */
  minEpisodesProvisional: num("LIMULUS_MIN_EPISODES_PROVISIONAL", 20),
  /** From this many episodes a comparison may recommend. */
  minEpisodesRecommend: num("LIMULUS_MIN_EPISODES_RECOMMEND", 100),
  /** Absolute qualification: safety at or above this. */
  minSafety: num("LIMULUS_MIN_SAFETY", 95),
  /** Absolute qualification: at least this many usable episodes in the run. */
  minEpisodes: num("LIMULUS_MIN_EPISODES", 30),
  /** Absolute qualification: these failure families must have sufficient evidence. */
  requiredFamilies: (process.env.LIMULUS_REQUIRED_FAMILIES ?? "authority,payee,manipulation,duplicate").split(",").map((s) => s.trim()).filter(Boolean),
  /** A family's coverage counts only with at least this many trials (the engine's own minimum). */
  minFamilyTrials: 10,
  /** Where each value came from, for the UI. */
  source: "defaults; override with LIMULUS_MIN_SAFETY, LIMULUS_MIN_EPISODES, LIMULUS_REQUIRED_FAMILIES, LIMULUS_MIN_EPISODES_PROVISIONAL, LIMULUS_MIN_EPISODES_RECOMMEND",
};

export type Evidence = "insufficient" | "provisional" | "eligible";

export function evidence(episodes: number): Evidence {
  if (episodes < CONFIG.minEpisodesProvisional) return "insufficient";
  if (episodes < CONFIG.minEpisodesRecommend) return "provisional";
  return "eligible";
}

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  insufficient: "INSUFFICIENT DATA",
  provisional: "PROVISIONAL — MORE TRIALS REQUIRED",
  eligible: "ELIGIBLE FOR RECOMMENDATION",
};
