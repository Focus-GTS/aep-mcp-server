# AEC-Bench — an agentic benchmark for Adobe Experience Cloud

**How well can an AI agent actually operate Adobe Experience Cloud?**

Nobody publishes an answer. Adobe ships MCP tools, third parties ship MCP tools, and every one of them is described by its tool count — a number that measures surface area, not competence. A server with fifty tools that 404 scores higher on that metric than a server with ten that work.

AEC-Bench measures the thing that matters: **given a real task and a live tenant, does the agent complete it, and can you prove it?**

## What makes this different from a test suite

A test suite asserts that a function returns what its author expected. A benchmark asserts that a **goal was achieved**, by an agent that chose its own path, verified independently of the tools it used.

Three properties follow from that, and they are the whole design:

1. **Assertions are made against Adobe, not against tool output.** A task that says "create a dataset" is scored by a GET that finds the dataset — never by the create call's own success flag. A write reporting on itself is not evidence; this project has already been bitten by exactly that, when a `200` from DELETE meant nothing had been deleted.

2. **Every task cleans up, and cleanup is scored.** A run that completes the task and leaves an orphan has not passed. Benchmarks that dirty the environment can only be run once honestly, and a benchmark you cannot re-run is an anecdote.

3. **Read-only tasks are the default tier.** Anyone can run tier 1 against any tenant, including production, without risk. That matters more than breadth: a benchmark nobody dares execute measures nothing.

## Tiers

| Tier | Touches | Safe on production? | Needs |
|---|---|---|---|
| **1 — read** | GET only | **Yes** | any credential |
| **2 — reversible write** | creates then deletes what it created | No | development sandbox |
| **3 — irreversible** | ingestion, lifecycle | No | development sandbox, explicit opt-in |

Tier 3 is defined but deliberately ships empty. The tasks that belong there — record deletion, dataset expiry — are non-cancellable and can take 30 days to settle. A benchmark is not a good reason to run one.

## Scoring

Each task yields:

```
completed   the goal state was reached, verified independently
efficient   completed within the expected number of tool calls
clean       no residue left behind
```

A task scores `1.0` only when all three hold. Partial credit is reported but never rounded up — "it worked but left three orphaned datasets" is a failure mode worth seeing, not a rounding error.

## Running it

```bash
node bench/runner/run.mjs --env .env --tier 1
node bench/runner/run.mjs --env .env --tier 1 --json results.json
```

The runner refuses to execute tier 2+ unless `AEP_EXPECTED_SANDBOX_NAME` matches the credential and Adobe classifies the sandbox as `development`. It fails closed: an unknown sandbox type blocks writes rather than allowing them.

## Status

Early. Tier 1 is real and runnable; tier 2 has its first tasks. The point of publishing at this size is that the *format* is the contribution — a neutral, reproducible way to compare agentic Adobe tooling, including tooling that competes with ours.

We expect to score badly on tasks we have not built for. That is the intended use.
