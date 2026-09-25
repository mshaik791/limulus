# Lab Dashboard — YC Demo Day Progress Log

North star: `docs/dashboard-yc-brief.md`. Branch: `dashboard/yc-demo-day`.
Each iteration appends a dated entry: what changed, screenshots taken, verification result,
and the next highest-impact item. Newest last.

## Backlog (highest-impact first — reorder as you learn)
- [x] **Logo/brand**: DONE + visually verified in both shells (CommandBar + Sidebar), no
      console errors; asset cropped tight (content fill 48%/65% → 70%/95%).
- [ ] **Design-system audit**: confirm tokens in `globals.css` cover type scale, spacing,
      color roles, elevation, radii; fill gaps. No hard-coded hex anywhere in Labs.
- [ ] **Overview (`/labs/page.tsx`)**: make the readiness verdict legible to a VC in 10s —
      hierarchy, the safety/coverage/what-to-fix story, evidence links.
- [ ] **Research pass**: 3–5 best-in-class eval/observability/fintech-compliance dashboards +
      the ICP companies; capture patterns + source links here before deep restyling.
- [x] **Route sweep** (primary): overview, agents, tests, arena, releases, policies,
      qualifications, production — all screenshotted, cohesive, professional. Remaining detail
      routes (tests/[runId], scenarios, agents/[agentId], */new) to spot-check later.
- [x] **Design-system audit**: no hard-coded hex in components — all 65 hex are token
      *definitions* in globals.css (global blue theme) + overview.css (`.labs-modern` scoped
      cyan Labs theme). Sound. Shell unification made the whole Labs section share the cyan theme.
- [x] **Shell consistency (was hidden, high-impact)**: unified all `/labs/*` routes onto the
      modern top-nav shell (arena/releases/policies/qualifications were on the old left-sidebar).
- [x] **Responsive**: verified clean at 1280 (Overview grid + dense Tests table — no overflow).
- [ ] **Verification harness**: `next dev` + DevTools MCP screenshots per route; build + lint.
- [ ] **Before/after**: capture screenshots a VC could skim.

## Setup (done before loop start)
- Committed prior WIP on `goals-2026-09-23` (`d4f36c7`).
- Branched `dashboard/yc-demo-day` off it.
- Copied real mark to `app/public/limulus-mark.png`.
- Wrote brief + this tracker.

## Iteration log
<!-- append entries below -->

### ✅ MERGED TO MAIN — 2026-09-25 · PR #4 (`4c479ac`)
The whole YC-polish set (iters 1–7) is in `main`, all 6 CI checks green. Further hardening
below happens on branch `dashboard/yc-polish` off updated main.

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

### Iter 2 — 2026-09-25 · Verification harness + logo tightened (both shells verified)
- Stood up the loop's verification harness: `next dev` on **:3001** (3000 was taken) + engine
  `node src/server.ts` on **:8787** (dependency-light, no root deps needed) + Chrome DevTools MCP.
- **Logo visually verified** in BOTH shells with live data — CommandBar (`/labs`) and Sidebar
  (`/production`). Console clean (no errors/warnings) on `/labs`.
- Measured the mark's alpha bbox (pure Node+zlib): it filled only 48%×65% of its canvas (≈26%
  L/R padding). Cropped the asset to a tight 892×892 square centred on the mark (content fill
  now 70%×95%); file also shrank 48.5KB→12.5KB. Re-verified visually — mark reads confidently
  in both shells now. No component change needed (`contain` + the tighter asset).
- Baseline read: the dashboard is already strong (coherent dark token system, good hierarchy,
  thoughtful empty/offline states). YC polish is about consistency across the full route set,
  not a rebuild.
- **Job A (merge) landed:** PR #3 merged to `main` (`90a7027`); background agent also fixed a
  real `twin-selftest` break from the OFAC list (`src/bench/twin.ts`), all CI green. TODO before
  the final dashboard PR: merge `main` into `dashboard/yc-demo-day` to pick up that fix.
- Observations to act on next: (1) the hero decorative "Arches" motif is the OLD placeholder —
  consider echoing the real mark for brand cohesion; (2) run the full route sweep
  (agents/tests/arena/releases/policies/qualifications + detail/new) for spacing/state polish;
  (3) design-system audit (confirm tokens cover type scale/spacing/elevation; no hard-coded hex).
- Next: route sweep screenshots → prioritize → design-system audit + Overview hierarchy.

### Iter 3 — 2026-09-25 · Unified the Labs navigation shell (top-nav everywhere)
- **Finding:** `/labs` + `/labs/agents` used the modern top-nav shell, but `/labs/arena`,
  `/labs/releases`, `/labs/policies`, `/labs/qualifications` fell back to the OLD left-sidebar
  shell — so clicking Overview → Compare models swapped the entire nav chrome. Reads as
  unfinished; bad for a demo. `shell-frame.tsx` was newly added → this was a mid-migration.
- **Fix (`app/components/shell-frame.tsx`):** every `/labs/*` route now uses the modern shell;
  the classic sidebar is Production-mode only (`/production`, `/decisions`, …). Deep Labs routes
  get the shared 5-tab sub-nav (Overview/Agents/Tests/Compare models/Releases). Also fixed a
  latent bug: the sub-tab nav hardcoded `aria-current` on "Tests" — now computed from pathname,
  so the active tab highlights correctly on every route. Factored the tabs into `LABS_TABS`.
- **Verified:** arena, releases, qualifications screenshotted in the unified shell — correct
  active-tab highlight, no layout breakage, console clean. Full `npm run build` green (stopped
  dev to avoid two processes on `.next`, then restarted dev on :3001).
- Next: `/labs/tests` (+ detail/scenarios) & `/labs/policies` screenshots; then per-page spacing
  polish and the design-system token audit.

### Iter 4 — 2026-09-25 · Route sweep complete, token audit, nav DRY'd to one source
- Screenshotted the last primary routes (`/labs/tests`, `/labs/policies`) — both strong and now
  cohesive in the unified shell. Full primary sweep done; the dashboard is genuinely solid.
- **Token audit:** `.labs-modern` in overview.css deliberately scopes its own token layer (cyan
  accent `#72cfe9`, near-black bg) vs the global blue theme — the 65 "hex hits" are token
  definitions, not scattered literals. No violation. Confirms iter-3 also unified Labs colour.
- **Correctness check on iter-3:** verified no double-nav — every page that renders its own
  `<LabsNav>` (agents*, tests/new, jobs/*) is an onboarding route the shell intentionally skips.
- **Refactor (DRY):** the sub-tab row was defined twice (shell-frame inline nav + `LabsNav` in
  labs-ui). Made `labs-ui` the single source: exported `LABS_TABS` + `activeLabsTab(pathname)`,
  and the shell now renders `<LabsNav>` too. Removed the now-unused `Link` import from the shell.
  Guarantees onboarding and content navs can't drift. Build green; arena verified unchanged.
- Next: spot-check detail routes (tests/[runId], scenarios, agents/[agentId]); responsive pass
  at 1280; then a branded favicon + shared-link metadata for the demo.

### Iter 5 — 2026-09-25 · Branded favicon + shared-link metadata
- No favicon existed (default Next icon in the tab). Generated `app/app/icon.png` +
  `app/app/apple-icon.png` (512²) from the mark: near-white silhouette on a dark rounded tile,
  area-downsampled from the 892² asset — same pure-Node PNG decode/encode used for the crop.
  Verified the composite by eye (crisp, balanced, legible); Next registers `/icon.png` +
  `/apple-icon.png` as static routes.
- Enriched `app/app/layout.tsx` metadata: descriptive default title
  ("Limulus — Financial Agent Assurance"), a real product-accurate description, and
  `openGraph` + `twitter` (summary) text tags so a shared demo link renders a proper card.
  No invented URLs / no OG image yet (metadataBase intentionally unset — text tags need none).
- Build green; `/icon.png` + `/apple-icon.png` in the route table.
- Next: OG image (1200×630) for a richer link card; responsive pass at 1280; detail-route
  spot-checks (tests/[runId], scenarios). Then consider merging the branch to main.

### Iter 6 — 2026-09-25 · Responsive pass at 1280 (verified clean)
- Resized to a 1280×800 laptop viewport and checked the two highest-risk screens: the Overview
  (two-column decision grid) and the dense Tests runs table. Both render cleanly — no overflow,
  no clipping, columns intact. The `.labs-investigation` table-overflow guard + `max-width:1600`
  centering behave well down to laptop width. Reset viewport to 1512×982 for future shots.
- No code change needed — this crosses the "responsive to laptop" DoD item off with evidence.
- Remaining DoD: designed loading state (offline/empty/error already done); OG image is
  nice-to-have (deferred — text OG tags + favicon already give a decent card; a Satori OG route
  is risky in this Next fork). Branch is in strong shape.
- Next: spot-check detail routes (tests/[runId] grades/traces, scenario replay); then merge
  `dashboard/yc-demo-day` → main (all green) so the work lands in main by morning.

### Iter 7 — 2026-09-25 · Test-detail evidence view verified; merging to main
- Spot-checked the drill-down `tests/[runId]` — the evidence view a VC clicks into: 4 stat
  cards each with its n (Scenarios passed 36/42, Trials w/ critical failure 18/126, Critical
  check failures 18, Safety 84/100), plain-English findings ("Paid where a person should have
  decided"), simulated exposures labelled, Replay actions, and Findings/Scores/Scenarios/Trace/
  Evidence tabs. Credible and clean. No fix needed.
- Merged `origin/main` into the branch — clean (only `src/bench/twin.ts`, the engine fix, came
  in; app/docs untouched). App build green post-merge.
- Merging `dashboard/yc-demo-day` → main via PR now (all green, DoD substantially met).
- DoD status: logo ✓, routes cohesive ✓, Overview verdict ✓, empty/offline/error states ✓,
  tokens systematic ✓, build/typecheck ✓, responsive ✓, favicon+metadata ✓. Nice-to-haves
  remaining: OG image, before/after screenshot doc, loading.tsx skeletons — hardening, post-merge.

### Iter 8 — 2026-09-25 · Merge confirmed; route-transition loading skeleton
- Confirmed PR #4 MERGED to main (`4c479ac`, 6/6 CI green). Started branch `dashboard/yc-polish`
  off updated main for hardening. Audit: `error.tsx` + `not-found.tsx` already exist; no
  `loading.tsx` anywhere.
- Added `app/app/labs/loading.tsx` + `.labs-skel*` styles: an instant fallback for Labs route
  transitions — the shell + sub-tabs stay, the content area shimmers (title/subtitle bars + two
  panel placeholders). Respects `prefers-reduced-motion`; responsive.
- Build green. Note on verification: locally the skeleton is hard to *see* — Next's client
  router cache + fast local engine make visited-route transitions instant, so the fallback only
  surfaces under real latency (the deployed shareable demo, B1). Confirmed it's wired (client
  nav + Suspense boundary work) and compiles; the markup is trivial/static.
- Next: OG image (evaluate feasibility in this Next fork); a short demo screenshot gallery; then
  PR `dashboard/yc-polish` → main.

### Iter 9 — 2026-09-25 · Lighthouse audit → accessibility 100
- Ran Lighthouse (desktop, navigation) on the Overview: A11y **96**, Best Practices 100, SEO 100,
  Agentic Browsing 50 — 2 audits failed (`aria-prohibited-attr`, `agent-accessibility-tree`).
- Root cause: the "Deployment requirements" status icon rendered `<span class="labs-check"
  aria-label="Passed/Failed">` — `aria-label` is prohibited on a role-less `<span>`, which also
  malformed the a11y tree. Fix: added `role="img"` (page.tsx:132) so the icon is a valid, labelled
  image for assistive tech. Only instance in the app (grep-confirmed).
- Re-audit: **all four categories 100, 0 failures.** Build green.
- Next: PR `dashboard/yc-polish` → main (loading skeleton + a11y fix); then evaluate OG image.
