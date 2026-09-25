# Lab Dashboard — YC Demo Day Brief

**Mission.** Take the Limulus **Lab dashboard** (`app/app/labs/**`) from functional to
Y-Combinator-Demo-Day quality: the kind of console that reads as *credible, precise, and
inevitable* to (a) finance/AP-automation buyers deploying payment agents and (b) the VCs in
the room. Pristine. No rough edges. This is the artifact the raise is shown on.

This is an **autonomous overnight loop**. No human gate. Do not stop to ask questions. Do not
finish early — when you think you're done, do another pass raising the bar. Keep a running log
in `docs/dashboard-progress.md`.

## Who we're designing for (ICP — research them)
Accounts-payable / finance-automation agent builders. Their buyers won't deploy an agent that
moves money without independent, evidence-backed assurance. Real companies in this space (use
them to calibrate language, workflow, and what "credible" looks like — research each briefly):

- **Apron** — Bogdan Uzbekov. Prepare/approve/release flow ≈ a real held-order release step.
- **Hyperbots** — Rajeev Pathak. ACH, check, wire — which rails support an external approval hook.
- **Clerked** — Evan Meyer. Strong AP validations already.
- **Campfire** — John Glasgow. Owns ledger + approvals; separation-of-duties view.
- **Nanonets** — Sarthak Jain. Biggest thesis overlap.
- **Auditoria** — Rohit Gupta. Email-driven agents; adversarial failure set.
- **Truewind** — Tennison Chan. Qualification beyond payments (posting entries).
- **Woodrow** — Sidharth Kakkar. Closest competitor; highest info per call.
- **Lio** — Vladimir Keil. Procurement-side; recommend → act threshold.
- **Omnea** — Ashil Shah. Partnerships motion.

The dashboard should make a viewer from any of these companies think: *"this is the layer that
lets me deploy an AP agent I'd otherwise never trust."*

## Research directives (you may use the internet, DevTools, screenshots)
1. **Best-in-class SaaS/eval dashboards** — study layout, density, typography, evidence
   presentation (e.g. observability, model-eval, security-posture, and fintech-compliance
   consoles). Capture what makes them read as expensive and trustworthy.
2. **Lab/testing/benchmark dashboards** specifically — how they show pass/fail, n, confidence
   intervals, coverage, and regressions without looking like a science-fair poster.
3. **Our users** — the ICP above. Their vocabulary (release, approve, hold, separation of
   duties, rails) should feel native in our copy.
Record findings + source links in `docs/dashboard-progress.md` so claims stay traceable.

## Brand / logo (REQUIRED on the dashboard)
- Real mark shipped at `app/public/limulus-mark.png` (the split-oval "pennant"/kiwi mark).
- Today the brand mark is a **placeholder** `Mark()` SVG in `app/components/sidebar.tsx`
  (commented "Not a crab") and the wordmark "Limulus / Financial Agent Assurance".
- Replace the placeholder with the real mark, rendered crisply. Prefer recreating it as inline
  **SVG** (the shape is geometric: two split ovals + a downward pennant/arrow) so it scales and
  can take `currentColor` for light/dark; fall back to the PNG in `app/public/` if an SVG trace
  isn't faithful. It must appear in **both** shell modes: the sidebar layout AND the sidebar-less
  `labs-modern` layout (`app/components/shell-frame.tsx` + `command-bar.tsx`). Legible on light
  and dark surfaces.

## Design-system pointers
- Tokens live in `app/app/globals.css` (CSS variables: `--accent`, `--cyan`, `--ink*`,
  `--line*`, `--surface*`, `--good/warn/crit*`, radii). **Extend the token system; do not
  hard-code hex.** If you introduce new tokens, add them there.
- Labs-specific styles: `app/app/labs/overview.css`.
- Two shells in `app/components/shell-frame.tsx`: `labs-modern` (CommandBar, no sidebar) for
  `/labs` overview + investigations + onboarding; classic `Sidebar` for the rest.
- **This is a modified Next.js fork.** Per `app/AGENTS.md`, READ the relevant guide in
  `app/node_modules/next/dist/docs/` before writing any Next.js code — APIs differ from stock.

## Hard constraints (from GOALS.md — non-negotiable, they gate the raise)
- **Banned words anywhere in UI copy:** safe, certified, guaranteed, notarized, self-improving,
  trained on. Say "signed," "hash-chained," "tested," "passed at this configuration."
- Every rate/number carries its **n**. Simulated amounts are always **labelled simulated**.
- Score outcomes, never the agent's explanation. No LLM in the control path — don't imply one.
- No invented statistics, URLs, or logos. Provenance a human can check.
- Don't regress accessibility (aria labels, contrast, focus states already present — keep them).

## MCP usage protocol
- **Chrome DevTools MCP** — run the app (`next dev`), navigate each Labs route, screenshot at
  desktop widths, read console for errors, and use screenshots as the visual acceptance check
  every iteration. Lighthouse/perf passes welcome.
- **Figma MCP** — allowed but **credits are NOT unlimited**. Scope heavily before any call:
  batch one well-planned design pass (e.g. logo lockup + a single reference screen) rather than
  many exploratory calls. Load the required Figma skill before `use_figma`/`get_design_context`.
  Lean on code + DevTools screenshots for iteration; reserve Figma for high-leverage moments.
- **WebSearch/WebFetch** — research above; cite sources in the progress log.

## Per-iteration workflow
1. Read `docs/dashboard-progress.md`; pick the highest-impact unchecked item.
2. Research only if it unblocks the current item (don't burn the loop on open-ended research).
3. Implement in code (tokens, components, copy).
4. **Verify**: `npm run build` + typecheck + lint green; run the app and screenshot the changed
   route(s) via DevTools MCP; confirm no console errors and the logo renders in both shells.
5. Commit to branch `dashboard/yc-demo-day` with a specific message. Update the progress log.
6. Schedule the next iteration. Repeat until Definition of Done, then keep hardening.

## Definition of Done (then keep polishing)
- [ ] Real Limulus mark on the dashboard, both shells, light+dark, crisp.
- [ ] Every Labs route (`/labs`, `agents`, `tests`, `arena`, `releases`, `policies`,
      `qualifications`, and detail/`new` routes) is visually cohesive, dense-but-calm, and
      free of placeholder/lorem/rough spacing.
- [ ] Overview reads as a credible assurance verdict: readiness, safety w/ n, coverage,
      what-to-fix, evidence — legible to a non-technical VC in 10 seconds.
- [ ] Empty, loading, offline, and error states are all designed (not default).
- [ ] Typography scale, spacing rhythm, and color roles are systematic (tokens only).
- [ ] `npm run build` + typecheck + lint pass; no console errors in any route.
- [ ] Responsive down to a laptop (1280) and up to a large display; no overflow/clipping.
- [ ] A short `docs/dashboard-progress.md` narrative + before/after screenshots a VC could skim.
- [ ] Merge to `main` when fully green (no human gate); otherwise leave a clean PR + summary.
