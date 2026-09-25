# Limulus console

The web console over the engine in `../src`. It reads signed records over HTTP and computes no number the engine did not: every figure on a screen is in a record, every rate carries its n, and every action is an API call.

```bash
# in the repository root: the engine
node src/server.ts                      # http://localhost:8787

# here: the console
npm install
npm run dev                             # http://localhost:3000
```

`LIMULUS_API` points the console at an engine somewhere else; `LIMULUS_API_KEY` is the bearer key when that engine requires one. See `.env.example`.

## Screens

Labs, before deployment:

| Route | Nav | What it shows |
|---|---|---|
| `/labs` | Overview | Can this version be deployed? Readiness rung and state, the latest run, the critical failure with its trajectory, coverage by failure family, every agent, the latest comparison, shadow mode |
| `/labs/tests` | Test Runs | Every Lab run, newest first, four axes with n |
| `/labs/tests/:runId` | | One run as a debugger: Overview, Failures, Scenarios, Trace, Artifacts |
| `/labs/tests/:runId/scenarios/:scenarioId` | | Scenario replay: context, a scrubbable execution timeline, the evaluation checklist and the result with its amount |
| `/labs/arena` | Model Arena | Comparisons on record and a form to run one; `/labs/arena/:id` for one |
| `/labs/releases` | Release Gates | Every gate run, previous against candidate; `/labs/releases/:id` for one, with the override rules |
| `/labs/policies` | Policies | Controls as guardrail cards with what each compiles into and its last result, plus the compiler |
| `/labs/qualifications` | Assurance Checks | The ten deterministic checks with usage, and the signed qualifications they have earned |

Core, in production:

| Route | Nav | What it shows |
|---|---|---|
| `/production` | Shadow Mode | Production outcomes beside what the three-way match would have done; `/production/:id` for one, with review |
| `/decisions` | Production | The gate's real decisions as a live stream, with risk events, system state and agent health; `/decisions/:id` is the transaction as three records side by side with every mismatch marked |
| `/incidents` | Incidents | Monitor candidates: production failures turned into regression scenarios, approved by a person |
| `/evidence` | Evidence | The signed decision chain; `/evidence/:id` for the packet and its receipt, verified |

## Shell

A sidebar with a Labs / Production mode switch and Lucide icons, and a command bar with search (⌘K, backed by `/api/search` over everything the engine has sealed), a docs link, the environment, and the one action that matters in that mode: Run Simulation in Labs, Connect Agent in Production. There is no notification bell and no avatar, because nothing stands behind them yet.

## Semantics it keeps

Terminology is exact and counts are never mixed: a scenario is a definition, a variant a generated mutation, an episode one execution, a check failure one deterministic finding, a failing episode one with at least one finding, and a critical failure a failing episode whose worst finding is critical. Screens show critical episodes (deduplicated) beside critical check failures (per finding).

Release logic is two questions: the regression gate (no worse than the baseline, from the sealed gate record) and the absolute qualification (safety at or above a minimum, no critical episode, a minimum episode count, required failure families with sufficient evidence). Final release is READY only when both pass. Thresholds are defaults in `lib/config.ts`, shown as defaults on screen, and overridable with `LIMULUS_MIN_SAFETY`, `LIMULUS_MIN_EPISODES`, `LIMULUS_REQUIRED_FAMILIES`, `LIMULUS_MIN_EPISODES_PROVISIONAL` and `LIMULUS_MIN_EPISODES_RECOMMEND`.

Unknown is never zero. A radar axis is measured, "insufficient evidence" or "not evaluated", and only measured axes are on the shape. Coverage confidence, the share of families with sufficient evidence, sits beside the safety score.

The environment drives the copy. The engine reports which rail it is wired to; with the simulated rail, decisions read "would release" and "would hold" and the Production page is a sandbox decision stream. A release the rail then contradicted is a miss, never an ordinary success, and appears under Incidents.

Model Arena keeps models and configurations apart. A comparison whose arms report at least two distinct models is a model comparison; the reference agents and gate modes are configurations. A recommendation is shown only when the evidence is eligible; below that it is provisional or insufficient. Models arrive as the endpoint reported them (`opus`, `anthropic/claude-sonnet-4.5`, `openai/gpt-4.1`) and are shown by family and version, marked self-reported. To put models in the arena, start `npm run model-agent` in the engine (vendor keys, OpenRouter or the Vercel AI Gateway; Claude through the local CLI with no key) and pick models in the Compare Models form, which reads the agent's `/health` at `LIMULUS_MODEL_AGENT` (default `http://localhost:9100`); or run `lab compare` with a labelled URL per arm.

## Rules it keeps

Amounts from the Lab are labelled simulated at every appearance and every Lab screen carries the sandbox bar. Shadow mode says "would have", never "did". A status colour never appears without its word. The words the findings register bans do not appear.
