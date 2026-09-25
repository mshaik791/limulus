# Lab Dashboard — YC Demo Day Progress Log

North star: `docs/dashboard-yc-brief.md`. Branch: `dashboard/yc-demo-day`.
Each iteration appends a dated entry: what changed, screenshots taken, verification result,
and the next highest-impact item. Newest last.

## Backlog (highest-impact first — reorder as you learn)
- [ ] **Logo/brand**: replace placeholder `Mark()` in `sidebar.tsx` with the real Limulus mark
      (inline SVG preferred; PNG at `app/public/limulus-mark.png` as fallback). Both shells.
- [ ] **Design-system audit**: confirm tokens in `globals.css` cover type scale, spacing,
      color roles, elevation, radii; fill gaps. No hard-coded hex anywhere in Labs.
- [ ] **Overview (`/labs/page.tsx`)**: make the readiness verdict legible to a VC in 10s —
      hierarchy, the safety/coverage/what-to-fix story, evidence links.
- [ ] **Research pass**: 3–5 best-in-class eval/observability/fintech-compliance dashboards +
      the ICP companies; capture patterns + source links here before deep restyling.
- [ ] **Route sweep**: agents, tests (+detail/scenarios), arena, releases, policies,
      qualifications, `*/new` — cohesive, no rough spacing, designed empty/loading/error states.
- [ ] **Responsive**: 1280 → large display, no overflow/clipping.
- [ ] **Verification harness**: `next dev` + DevTools MCP screenshots per route; build + lint.
- [ ] **Before/after**: capture screenshots a VC could skim.

## Setup (done before loop start)
- Committed prior WIP on `goals-2026-09-23` (`d4f36c7`).
- Branched `dashboard/yc-demo-day` off it.
- Copied real mark to `app/public/limulus-mark.png`.
- Wrote brief + this tracker.

## Iteration log
<!-- append entries below -->
