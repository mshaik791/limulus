# Lab Dashboard — YC Demo Day Progress Log

North star: `docs/dashboard-yc-brief.md`. Branch: `dashboard/yc-demo-day`.
Each iteration appends a dated entry: what changed, screenshots taken, verification result,
and the next highest-impact item. Newest last.

## Backlog (highest-impact first — reorder as you learn)
- [~] **Logo/brand**: DONE in code (both shells via `<LimulusMark>` CSS-mask component);
      visual verification pending next iteration (build + screenshot).
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

### Iter 1 — 2026-09-25 · Logo shipped to both shells (build-verified)
- Added `app/components/logo.tsx` → `<LimulusMark>`: paints `app/public/limulus-mark.png`
  (monochrome, transparent bg — confirmed RGBA/hasAlpha) via CSS `mask` + `currentColor`, so the
  real mark renders crisp in any theme colour and scales without raster fuzz.
- Replaced placeholder `Mark()` SVG in `components/sidebar.tsx` (classic shell) with
  `<LimulusMark size={28}>` tinted `--ink`; removed the dead placeholder.
- Replaced placeholder brand SVG in `components/command-bar.tsx` (labs-modern shell) with
  `<LimulusMark size={26}>`.
- Env gap fixed: `app/node_modules` was empty → ran `npm install` (exit 0).
- **Verified:** `npm run build` green — compiled + TypeScript pass, all 26 routes generated.
- **Still pending (next iter):** live DevTools screenshot of both shells to confirm the mask
  renders the mark near-white on the dark sidebar (de-risk the alpha cutout visually).
- Minor: build warns `package-lock.json` is outside the git root / suggests `turbopack.root` —
  non-blocking; consider setting it in `next.config.ts`.
- Next highest-impact: stand up the DevTools screenshot harness (boot `next dev`, capture every
  Labs route) → then design-system audit + Overview hierarchy.
