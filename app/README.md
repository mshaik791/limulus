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

| Route | What it shows |
|---|---|
| `/labs` | Overview: agents tested, critical violations and simulated wrongful amount in the latest run per agent, latest gate, qualifications in force, what needs attention |
| `/labs/tests` | Every Lab run, newest first, four axes with n |
| `/labs/tests/:runId` | One run: the ladder, axes, controls wiring, violations by code, one row per scenario with a dot per trial |
| `/labs/tests/:runId/scenarios/:scenarioId` | Scenario replay: what the agent was given, every tool call in order, each finding anchored to the call it came from |
| `/labs/arena` | Comparisons on record, and a form to run one on the open pool |
| `/labs/arena/:id` | One comparison: arms, axes by arm, where they differ, the recommendation and its rule |
| `/labs/releases` | Every release-gate run, sealed |
| `/labs/releases/:id` | Baseline against now, what changed, the override if one applied |
| `/labs/policies` | Control types, and a compiler that shows what a controls file produces |
| `/labs/qualifications` | Every qualification with its binding, state and signature check |
| `/production` | Shadow mode: production outcomes beside what the three-way match would have done |
| `/production/:id` | One shadow decision: the three records, the checks, both verdicts, a person's review |
| `/evidence` | The signed decision chain |
| `/evidence/:id` | One decision and its receipt, verified |

## Rules it keeps

Amounts from the Lab are labelled simulated at every appearance and every Lab screen carries the sandbox bar. Shadow mode says "would have", never "did". A status colour never appears without its word. The words the findings register bans do not appear.
