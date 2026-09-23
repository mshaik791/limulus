# North-star dashboard (from the 2026-09-23 mockup)

One dark "mission control" overview, dense and legible. Every element below is a
target for the Labs/Core app. Where the mockup collides with a standing rule, the
rule wins and the collision is noted.

## Shell
- Left rail: Overview, Agents, Simulations, Deployments, Production, Incidents
  (badge), Policies, Reports; Settings and the user at the bottom.
- Top bar: global search (agents, transactions, tests, incidents; cmd-K), time
  range ("Last 7 days"), notifications, primary CTA "Run Simulation".
- Hero: "Financial Agent Mission Control", status pill "All systems operational",
  clock.

## KPI row (five tiles, each with a sparkline and a delta)
Production readiness /100 · Agents monitored (n in production) · Transactions
evaluated · Blocked / prevented (with a dollar figure) · Safety score.
Rules: "Safety score" cannot ship under that name (banned word); the dollar figure
must read "Simulated wrongful amount" wherever the source is the Lab; every rate
carries n.

## Agent execution map (signature panel)
Live graph: Agent → Invoice → Vendor → Bank / Policy → Approval → Payment rail.
Normal flow subtle, risky flow red, a BLOCKED edge stops visibly before the rail.
Legend: normal / risky / blocked. Backed by the decision chain and outcome records.

## Scenario replay
Card headed by the scenario name and verdict badge. Agent, model, time. Numbered
step timeline with pass/fail glyphs: invoice parsed, PO matched, bank details
changed, verification failed, payment held. Actions: view full trace, agent
reasoning, re-run, explore scenario. Backed by episodes (tool-call traces).

## Risk radar
Seven axes: authorization, beneficiary integrity, prompt-injection resistance,
policy compliance, tool-call correctness, escalation behaviour, and one more.
Overlay: your agents vs industry benchmark. Never replaces the failure list.

## Model arena
Table: model, provider mark, score bar, pass rate. CTA "Run model comparison".
Backed by the Compare endpoint; every score shows n.

## Live activity
Feed: held transaction, suite passed (scenarios, pass rate), deployment,
policy updated, simulation completed, incident resolved. Timestamps relative.

## Proof before money moves
Evidence packet card: transaction, signed intent hash, policy version,
timestamp, execution decision badge, "tamper-evident record" line, verified pill.
Backed by receipts and the chain.

## Recommended actions
Three rows with a one-line reason and a button each (add policy, run tests, review).

## Visual language
Near-black navy ground, restrained electric blue for active flow, green only for
verified, amber only for review, red only for blocked/critical. Monospace for
money, hashes, ids, timestamps. Subtle horseshoe-arc mark; no literal crabs.
