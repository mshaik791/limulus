# Limulus UI Simplification Brief for Claude

## Goal

The current Limulus UI is technically strong but too complicated to understand at a glance.

Do **not** redesign the backend architecture. Do **not** remove functionality. Do **not** break routes or APIs.

The goal of this pass is to make Limulus dramatically easier to understand by reducing visual clutter, simplifying terminology, and using progressive disclosure.

The engine can remain complex.

The product should not **feel** complex.

---

# Core Product Principle

Every page should answer **one primary question**.

A user should understand the answer within about **5 seconds**.

## Page questions

### Labs Overview
**Can I deploy this agent?**

### Tests
**How did my agent perform?**

### Model Arena
**Which model or configuration performs best?**

### Releases
**Can this version ship?**

### Policies
**What rules should my agent obey?**

### Assurance Checks
**What controls are protecting transactions?**

### Shadow Mode
**What would Limulus have blocked?**

### Production
**What is Limulus allowing or stopping right now?**

### Incidents
**What went wrong?**

### Evidence
**Can I prove what happened?**

If a page tries to answer multiple of these at the same time, simplify it.

---

# PRIMARY CHANGE: Simplify `/labs`

The current Labs Overview is visually too dense.

It currently tries to show too many concepts at once:

- production readiness
- agents tested
- episodes evaluated
- critical failures
- safety score
- coverage confidence
- execution map
- live activity
- scenario replay
- risk radar
- recommended actions
- agents
- model arena preview
- shadow mode

That is too much for the main overview.

The `/labs` page should focus almost entirely on:

1. **Can this agent deploy?**
2. **Why not?**
3. **What should I do next?**

Everything else should move one level deeper.

---

# New `/labs` Information Architecture

Use this structure:

```text
Labs

[Agent selector]
AP Agent — Careful v0.3.2
Last tested 3 minutes ago

------------------------------------------------

DEPLOYMENT STATUS

NOT READY TO DEPLOY

84 / 100

9 critical failures
3 risk areas need more testing
Regression gate: BLOCKED

[ Review Failures ]   [ Run Again ]

------------------------------------------------

WHY IT'S BLOCKED

1. Beneficiary changes
   Failed 4 of 21 tests

2. Duplicate payments
   Failed 3 of 18 tests

3. Human escalation
   Failed 2 of 12 tests

[ View All Failures ]

------------------------------------------------

WHAT TO DO NEXT

→ Fix beneficiary verification
→ Run more account-integrity tests
→ Re-run release gate

------------------------------------------------

RECENT TESTS

AP Agent v0.3.2   84   BLOCKED   3m ago
AP Agent v0.3.1   96   READY     Yesterday
AP Agent v0.3.0   93   REVIEW    Sep 21
```

This should be the primary Labs experience.

---

# Remove These From the Main `/labs` Overview

Move these off the main overview:

- full Agent Execution Map
- full Live Activity feed
- full Scenario Replay
- Risk Radar
- Model Arena preview
- detailed Agents table
- Shadow Mode onboarding card
- raw implementation metadata
- run-level technical diagnostics

These are still useful.

They should live in deeper pages.

Do **not** delete them.

Re-home them.

---

# Progressive Disclosure

Use three levels of complexity.

## Level 1 — Overview

For product owners, founders, risk operators, engineering leads.

Answer:

> Can I deploy this agent?

Show:

- deployment status
- safety result
- test coverage
- critical failures
- top reasons
- recommended next actions
- recent test history

Avoid:

- raw IDs
- hashes
- tool traces
- long tables
- implementation language

---

## Level 2 — Engineering Investigation

For engineers debugging a failure.

Answer:

> Why did it fail?

Show:

- Scenario Replay
- execution timeline
- Agent Execution Map
- authorization
- declared intent
- payment order
- tool calls
- policy checks
- evidence
- failure trace

This is where the detailed technical UI belongs.

---

## Level 3 — Assurance / Advanced

For compliance, infra, advanced users.

Answer:

> How did Limulus calculate this?

Show:

- deterministic check definitions
- confidence intervals
- trial counts
- qualification bindings
- policy compiler output
- hashes
- signatures
- raw metadata
- model provenance
- suite fingerprints

Do not surface this complexity on the primary overview.

---

# Terminology Simplification

Some current wording is technically correct but too difficult for the primary UI.

Use simpler user-facing language.

## Replace `Episodes evaluated`

With:

**Tests run**

Optional detail:

> 21 scenarios × 3 trials = 63 episodes

"Episode" may still exist in technical details.

## Replace `Episodes with critical failure`

With:

**Critical failures**

Tooltip:

> Test executions containing at least one critical check failure.

## Replace `Coverage confidence`

With:

**Test coverage**

Display:

```text
Test Coverage
42%

3 of 8 risk areas sufficiently tested
```

Do not make users interpret "coverage confidence" on the main screen.

## Replace `Production readiness`

Prefer:

**Deployment Status**

Values:

- READY
- REVIEW REQUIRED
- BLOCKED

Optional secondary text:

> Current qualification: Shadow only

The readiness rung can remain in detail views.

## Do not show `Safety 100` beside `Coverage 0%` as two equally final metrics

Instead display something like:

```text
Test Result

100 / 100 on tested scenarios

⚠ Insufficient test coverage

Only 2 test episodes evaluated.
0 of 8 risk areas have sufficient evidence.
```

Or:

```text
Safety
100

Evidence
INSUFFICIENT
```

Never let a 100 score visually imply deployability when the evidence is too weak.

---

# Overview Hero

The page needs one dominant visual decision.

Current metrics are too evenly weighted.

Create one large hero card.

Example:

```text
DEPLOYMENT STATUS

BLOCKED

AP Agent — Careful v0.3.2

Safety             84
Test coverage      76%
Critical failures   9
Release gate       BLOCKED

The agent is not ready to deploy because
beneficiary verification and duplicate-payment handling regressed.

[ Review Failures ]   [ Run Again ]
```

This card should visually dominate the screen.

---

# Important Rule: If Agent Is Blocked, Show the Failure

The current screen can show:

> BLOCKED

while the largest visualization shows:

> Clean approved invoice
> no failure
> no payment attempt

That is confusing.

If the deployment status is blocked:

The main supporting content must show the **most important blocking failure**.

Example:

```text
Most Important Failure

Bank details changed inside an email thread

CRITICAL

Agent attempted payment without independent verification.

$18,250 simulated exposure

[ Replay Scenario ]
```

Only show a clean execution graph as the hero when the agent is actually passing.

---

# Recommended New `/labs` Layout

Use a 12-column desktop grid.

## Row 1

### Left: 8 columns
Large Deployment Status hero.

### Right: 4 columns
Recommended Actions.

## Row 2

### Left: 8 columns
Top Blocking Failures.

Show maximum 3.

Example:

```text
1. Beneficiary Integrity
   4 failures / 21 tests
   Critical

2. Duplicate Protection
   3 failures / 18 tests
   Critical

3. Escalation Behavior
   2 failures / 12 tests
   High
```

Each one clickable.

### Right: 4 columns
Test Coverage

Simple list, not a full radar.

Example:

```text
Authorization          ✓ Sufficient
Beneficiary            ✕ Weak
Duplicate protection   ✓ Sufficient
Escalation              ! Needs more tests
Tool correctness        ✓ Sufficient
```

The radar can live deeper.

## Row 3

Recent Tests

Simple table:

```text
Version       Safety   Coverage   Status    Tested
v0.3.2        84       76%        BLOCKED   3m ago
v0.3.1        96       92%        READY     1d ago
v0.3.0        93       87%        REVIEW    Sep 21
```

Keep this compact.

---

# Simplify the Top Metric Cards

Do not show 6 equal metric cards.

Prefer no more than 3 summary metrics, if any.

Suggested:

```text
Safety
84

Test Coverage
76%

Critical Failures
9
```

Everything else should be inside the hero or deeper pages.

---

# Navigation Simplification

Current Labs navigation:

- Overview
- Test Runs
- Model Arena
- Release Gates
- Policies
- Assurance Checks

Consider simplifying visible labels to:

## Labs
- Overview
- Tests
- Model Arena
- Releases

## Controls
- Policies
- Assurance Checks

This creates a clearer workflow.

Keep existing routes.

Visible label changes only.

Examples:

`Test Runs` → `Tests`

`Release Gates` → `Releases`

Do not break URLs.

---

# Tests Page

The Tests page should answer:

> How did my agent perform?

Top should show:

- Agent
- Version
- Last test score
- Status
- coverage
- critical failures

Then:

- recent test runs
- filters
- status

Keep detailed run IDs secondary.

Example:

```text
Tests

AP Agent — Careful

Last Result
84 / 100
BLOCKED

Coverage
76%

Critical Failures
9
```

Then the run table.

Do not overload the top with many KPIs.

---

# Test Detail

The test detail page is where complexity becomes useful.

Show:

- overall result
- failures
- categories
- timeline
- scenario breakdown

Tabs:

```text
Overview
Failures
Scenarios
Trace
Evidence
```

Keep technical information here.

---

# Scenario Replay

This is the best location for:

- Agent Execution Map
- tool calls
- policy
- invoice
- vendor
- beneficiary
- payment rail
- execution state
- agent trajectory
- evidence

Do not put all of this on the Labs Overview.

Scenario Replay should feel like the debugger.

---

# Model Arena

Model Arena should answer:

> Which model or configuration performs best?

Use two tabs:

```text
Models
Configurations
```

## Models

Compare actual models:

- Claude Opus
- Claude Sonnet
- Claude Haiku
- GPT
- Gemini
- Custom model

Only show models that actually exist in run metadata.

Do not hardcode fake results.

Display:

```text
Model
Safety
Pass Rate
Critical Failures
Latency
Cost
Evidence
```

If cost is not measured:

`Not measured`

If model identity is unknown:

`Unknown`

If too few tests:

`Insufficient evidence`

Do not recommend a winner with tiny sample sizes.

## Configurations

Put internal variants here:

- careful
- naive
- gate off
- gate advisory
- gate enforced
- prompt version
- tool config

Do not present these as models.

---

# Releases

Releases should answer:

> Can this version ship?

The page should be simple.

Top:

```text
Release Decision

DEPLOYMENT BLOCKED

Candidate
AP Agent v0.3.2

Regression Gate
PASS

Absolute Qualification
FAIL

Reason:
Safety threshold passed, but coverage is insufficient.
```

Then show the details below.

Do not make the two gate concepts visually compete with the final decision.

Final decision is the headline.

---

# Policies

Policies should answer:

> What rules should my agent obey?

Primary UI should show:

```text
Payments above $50,000 require CFO approval

ACTIVE

Agent compliance
43%

7 generated tests
```

Do not use red borders on every policy card.

Policy status and agent compliance are different.

Use neutral cards.

Red should indicate the agent is failing the policy, not that the policy itself is bad.

---

# Assurance Checks

This page should answer:

> What controls protect transactions?

Primary UI should group controls by:

- Authorization
- Beneficiary
- Execution Integrity
- Duplicate Protection
- Policy

Use simple rows.

Do not make this page feel like a database dump.

---

# Shadow Mode

Shadow Mode should answer:

> What would Limulus have blocked?

If empty:

Show only:

```text
Shadow Mode

Observe real agent decisions without blocking anything.

Agent → Limulus Shadow → Existing Payment System

[ Connect Production Agent ]
```

When data exists:

Show:

- decisions observed
- would hold
- would escalate
- potential exposure
- disagreements

No unnecessary metrics.

---

# Production

Production should answer:

> What is Limulus allowing or stopping right now?

Focus on:

- transaction
- amount
- decision
- reason
- outcome

Keep the stream simple.

Do not show detailed cryptographic evidence here.

That belongs in Evidence.

---

# Incidents

Incidents should answer:

> What went wrong?

Cards should focus on:

- what happened
- why it matters
- financial amount
- status
- action

Example:

```text
CRITICAL

Beneficiary mismatch

AP Agent v0.3.2

$64,182 simulated exposure

Detected 4m ago

[ Investigate ]
[ Create Regression Test ]
```

---

# Evidence

Evidence should answer:

> Can I prove what happened?

Primary list:

- transaction
- agent
- amount
- decision
- timestamp
- verification status

Click deeper for:

- hashes
- signatures
- policy version
- tool calls
- source documents
- previous hash
- raw payloads

Do not show cryptographic detail before the user asks for it.

---

# Visual Simplification Rules

## 1. Reduce cards

Do not turn every metric into a card.

Use whitespace, typography, and grouping.

## 2. One primary action per section

Examples:

- Review Failures
- Run Test
- Compare Models
- Review Release
- Investigate Incident

Secondary actions should be visually quieter.

## 3. Maximum 3 prominent colors on a page

Default:

- blue = neutral/system
- green = good
- red = blocked/critical

Amber only for warning.

Purple only for model comparison.

## 4. Avoid too many borders

Use borders mainly for:

- outer surfaces
- active state
- critical state

Do not outline every subcomponent.

## 5. Reduce metadata

Do not show:

- raw agent IDs
- localhost addresses
- hashes
- file paths
- raw scenario IDs

as primary labels.

Show friendly names.

Raw values may appear as muted secondary metadata.

## 6. More whitespace

Increase vertical spacing between major sections.

Make fewer things visible at once.

## 7. Never make "unknown" look like "bad"

States must remain visually distinct:

- Good
- Bad
- Warning
- Not enough evidence
- Not evaluated

---

# Status Hierarchy

Use only a small set of top-level states.

## Deployment

- READY
- REVIEW REQUIRED
- BLOCKED

## Test

- PASS
- FAIL
- INSUFFICIENT EVIDENCE

## Transaction

- RELEASE
- HOLD
- ESCALATE

## Sandbox transaction

- WOULD RELEASE
- WOULD HOLD
- WOULD ESCALATE

Do not invent many overlapping status words.

---

# User Mental Model

The UI should teach this simple workflow:

```text
1. Connect an agent

2. Test it

3. See what failed

4. Fix it

5. Compare models/configurations

6. Re-test

7. Pass the release gate

8. Deploy

9. Observe in Shadow Mode

10. Enable production controls
```

The navigation and page content should reinforce this flow.

---

# Keep the Technical Depth

This simplification does NOT mean making Limulus less technical.

The deep technical information should still exist.

The change is:

**Overview = simple answer**

**Detail page = technical explanation**

This is progressive disclosure.

---

# Implementation Instructions

Do not rebuild the application from scratch.

Preserve:

- current routes
- current API behavior
- existing backend calculations
- existing reusable components where useful
- Model Arena logic
- policy compiler
- release logic
- scenario replay
- execution map
- shadow mode
- evidence

Focus on restructuring presentation.

---

# Implementation Order

## Step 1
Redesign `/labs` only.

Do not touch other pages until the main overview feels simple.

Target:

A new user should understand:

- which agent is being evaluated
- whether it can deploy
- why it cannot deploy
- what to do next

within 5 seconds.

## Step 2
Simplify terminology.

Replace internal terminology on primary screens.

Keep technical names in details/tooltips.

## Step 3
Move technical components deeper.

Move:

- Execution Map
- Risk Radar
- Scenario Replay
- full Live Activity

out of the main Labs overview.

## Step 4
Simplify navigation labels.

Keep routes unchanged.

## Step 5
Apply the same "one question per page" rule to:

- Tests
- Model Arena
- Releases
- Policies
- Assurance Checks
- Shadow Mode
- Production
- Incidents
- Evidence

---

# Acceptance Criteria for `/labs`

The redesign is successful if a first-time user can answer these questions without explanation:

1. What agent am I looking at?
2. Is it safe to deploy?
3. What is blocking deployment?
4. How much evidence do we have?
5. What should I do next?
6. Where do I click to investigate a failure?

If the user has to understand:

- episodes
- coverage confidence
- qualification rungs
- taxonomy families
- control modes
- agent config IDs

before answering those questions, the redesign has failed.

---

# Final Design Philosophy

Limulus should feel like:

> **A very simple decision layer on top of a very sophisticated assurance engine.**

The backend is allowed to be complex.

The UI should make that complexity disappear until the user asks for it.

The user should not think:

> "There is a lot going on here."

They should think:

> "My agent is blocked because of two problems. I know exactly what they are and what to do next."
