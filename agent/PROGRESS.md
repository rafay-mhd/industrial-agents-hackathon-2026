# Agent progress

Source of milestones: `TEAM_PLAN.md`, section 5.2.

**Current status:** step 4 complete; step 5 next.
**Checklist progress:** 4 / 12 steps = 33.3%.
This is milestone completion, not measured agent accuracy or a time estimate.

- [x] 1. Repository setup and dependencies
- [x] 2. Answer entry point and small live baseline
- [x] 3. Parallel benchmark runner
- [x] 4. Tool wrappers for Core methods
- [ ] 5. Benchmark prompt and first accurate question type
- [ ] 6. Scoreboard and failure diagnostics
- [ ] 7. Integrate remaining question types and compare models
- [ ] 8. Full dev evaluation and test submission v1
- [ ] 9. BENCHMARK.md and clean-checkout rehearsal
- [ ] 10. HTTP server, UI actions, and Builder tool integration
- [ ] 11. Conversation behavior and tricky-user checks
- [ ] 12. Submission v2, voice endpoint, and final rehearsal

After step 12, follow the Sunday release/submission run-book in TEAM_PLAN.md section 6.

## Step 1 evidence

- Active branch: `agent`, tracking `origin/agent`.
- Local role branches: `agent`, `core`, `ui`, `builder`; new role branches start at `main`.
- Python 3.12 pinned in `.python-version`; `uv sync` succeeded and created `uv.lock`.
- Added FastAPI, Uvicorn, and python-multipart to project dependencies.
- Created the `agent` package and included it in the package build.
- Created CLAUDE.md from TEAM_PLAN.md sections 3 and 4, with check/progress instructions.
- Added ignore rules for local credentials, virtual environments, caches, and working outputs.
- Preserved the existing Anthropic credential template and added the optional ElevenLabs variable.
- Import check passed for FastAPI, Uvicorn, python-multipart, Anthropic, and agent.
- Starter smoke check passed: loaded `proc-factory-dev-003` (79 spaces), initialized all six tools,
  searched for CNC equipment, and imported BuildingAgent without creating an API client.
- `git diff --check` passed; `.env`, `.env.local`, `.venv/`, and `agent_output/` are ignored.
- Required `python -m core.oracle_check data/dev` was attempted but is unavailable:
  `ModuleNotFoundError: No module named 'core'`. This is a pending teammate dependency,
  not a passing oracle result. No Core implementation was added.
- No Claude API calls or credit usage during setup.

Within the restricted coding environment, uv checks use
`UV_CACHE_DIR=/tmp/industrial-agents-uv-cache` to keep cache writes in an allowed directory.
The starter import check also uses `MPLCONFIGDIR=/tmp/industrial-agents-matplotlib`.

## Step 2 implementation and offline evidence

- Implemented `agent.answer:answer`, wrapping the unchanged starter BuildingAgent.
- Each call loads a fresh BuildingMap and creates a fresh conversation and unique output directory
  under `agent_output/answers/`. Closures, edits, conversation history, and artifacts cannot leak
  from one question into another through shared agent state.
- The Anthropic client is initialized lazily and shared, with initialization protected by a lock.
- The adapter reads only the supplied building and question text, not answer keys or oracle inputs.
- Three offline tests pass: question isolation, error propagation, and invalid-building handling
  before client creation. Command: `uv run python -m unittest discover -s agent/tests -v`.
- The official evaluator successfully loads `agent.answer:answer` without API credentials.
- Its seeded two-question sample selects `proc-factory-dev-003-H02` and `swiss-5097-H02`.
- Core's oracle was attempted again and remains unavailable (`No module named 'core'`).

## Step 2 live baseline (2026-10-24)

The user activated Anthropic credits and configured the key in ignored local `.env`.
Verified only that the key is configured, without printing its value. Ran:

```bash
uv run --env-file .env python -m benchmark.evaluate data/dev \
  --kinds floor_area_total --per-kind 2 --agent agent.answer:answer
```

- Command completed successfully (exit code 0); both replies were nonempty and inspected.
- Official score: `floor_area_total 0 / 2`, total `0 / 2 (0%)`.
- `proc-factory-dev-003-H02`: expected 171.65 m². Claude listed seven meeting rooms but
  returned `Answer: not available...` because its tools do not provide areas.
- `swiss-5097-H02`: expected 14.66 m². Claude listed four storage rooms but
  returned `Answer: unknown...` because its tools do not provide areas.
- These are the expected starter capability failures, not authentication or adapter failures.
  Do not use these ground-truth numbers in the agent implementation.
- Full replies and scores: `agent_output/benchmark/results.jsonl`; preserved a separate copy
  at `agent_output/benchmark/step2_baseline.jsonl` so later evaluator runs can overwrite results.
- Live requests used the user's Anthropic account. Exact credit usage was not captured by this
  custom-entry-point evaluator run; no cost estimate is asserted.
- Core oracle attempted before recording completion; still unavailable (`No module named 'core'`).

## Step 3: parallel runner (2026-10-24)

- Implemented `agent/benchmark.py` for a single building or a split, with JSONL/CSV inputs
  or a directory containing per-building `questions.jsonl` files.
- Buildings are resolved by metadata id, so renamed building folders also work.
- Four workers by default; `--workers` controls concurrency. Files preserve input order.
- Three retries after the first attempt, with exponential backoff and jitter for transient
  API failures. Permanent API errors are not retried. Disabled the SDK's internal retries
  in `agent/answer.py` so they do not multiply the runner's retries.
- Each selected question gets a CSV row and a JSONL diagnostic record, even on failure.
  When no reply was returned, the CSV cell stays empty; no answer is fabricated.
- CSV correctly quotes multiline replies; records are flushed as input-ordered results arrive.
- Sidecar diagnostics include attempts, elapsed time, expected answer (if supplied), official
  score, and error type. Expected answers and oracle inputs are not passed to the agent.
- API errors omit response bodies and request headers from saved diagnostics.
- Supports `--kinds`, `--per-kind`, and `--limit` for small development runs.
- Invalid inputs/duplicate question ids fail before model calls. Outputs must be outside
  source data. The CLI returns nonzero for execution/scoring errors after saving all rows;
  incorrect but successfully evaluated answers do not cause a nonzero exit.
- All 12 offline tests passed (3 entry-point tests, 9 runner tests), including actual concurrent
  fake calls, successful/exhausted retries, permanent errors, unknown buildings, score failures,
  CSV round trips, input validation, and filtering.
- Real-file loading checks mapped all 517 train, 138 dev, and 145 test questions to buildings.
  The test CSV also loaded all 145 questions with no reference answers.
- Required Core oracle check remains unavailable (`No module named 'core'`).

Live verification command:

```bash
uv run --env-file .env python -m agent.benchmark \
  data/dev/proc-factory-dev-003 \
  data/dev/proc-factory-dev-003/questions.jsonl \
  --out agent_output/benchmark/step3_factory.csv
```

- Exit code 0; five nonempty replies, one attempt each, zero execution/scoring errors.
- Verified five unique matching IDs and identical reply text in CSV and JSONL.
- Accuracy: 0/5 with the current starter tools (largest_room, floor_area_total,
  wide_delivery_count, errand, shared_walls_count). Capability improvements belong to steps 4–5.
- Outputs: `agent_output/benchmark/step3_factory.csv` and `step3_factory.jsonl`.
- Live requests used Anthropic credits; exact spending is not measured by this runner yet.

## Step 4: Core integration and tool layer (2026-10-24)

- Core was published during development. Fetched `origin/core` at `a8279d8` and integrated
  `origin/main` at `ba29088`, which includes Core plus `docs/agent_plan.md`.
- Read the authoritative Core README and integration guide. The `core/` implementation is
  unchanged from the teammate's handoff; no geometry or routing algorithms were duplicated.
- Resolved shared `.gitignore`, package list, and lockfile conflicts, keeping both `agent` and
  `core` packaged and retaining our FastAPI/Uvicorn dependencies. `uv sync` succeeded.
- Refreshed CLAUDE.md's shared-contract excerpt from the updated TEAM_PLAN.md.
- Added `agent/tools.py`: 25 tools (the six preserved starter tools plus 19 Core wrappers).
- Eight computation tools cover the nine benchmark kinds; two reachability kinds use one tool.
  Other tools expose lookup vocabularies, rooms/assets, single-room facts, exits and route geometry.
- Tool argument descriptions preserve room/floor words; room outputs preserve the unambiguous
  `label` field. MapError becomes ToolError with the original candidate/floor/type guidance.
- Missing/unimplemented methods report 'not available yet' rather than producing guessed values.
- Supporting room/asset lists are capped at 20 rows with explicit truncation metadata; totals,
  counts, labels, vocabularies, route coordinates and directions remain complete.
- `what_if_door` simulates a change; `add_door` remains a persistent session edit. Tests verify both.
- Added `agent/agent.py`, reusing the starter conversation loop with our tool set.
  `answer()` now loads a fresh `core.Building` per question. The dedicated benchmark prompt
  is intentionally still the next milestone.
- All 18 local tests passed. They include all 138 dev questions through serialized tool calls
  using known oracle inputs, plus errors, truncation, routes, closures and door-edit behavior.
  This verifies tool wiring, not natural-language extraction accuracy.
- Required `uv run python -m core.oracle_check data/dev` now passes: **138/138, all nine kinds**.
- A tool-list script confirmed all 25 named tools and schema construction.

Live smoke check:

```bash
uv run --env-file .env python -m agent.benchmark data/dev data/dev \
  --kinds floor_area_total --per-kind 1 --workers 1 \
  --out agent_output/benchmark/step4_tools.csv
```

- Exit code 0, one live question, one attempt, no execution errors; score **1/1**.
- `proc-factory-dev-003-H02` now finishes with `Answer: 171.65`, matching the official scorer.
  The same question failed in steps 2 and 3 before area tools were exposed.
- Full reply inspected in `agent_output/benchmark/step4_tools.jsonl`.
- This single successful live question is a smoke check, not a full dev accuracy result.

## Next: step 5

Add the benchmark prompt with nine question patterns, tool-selection guidance, exact Answer-line
formats, and the `label` rule. Keep the conversation prompt separate. Evaluate floor_area_total
and largest_room through Claude, targeting at least 90% as specified in docs/agent_plan.md.

## Integration points to keep visible

- Core owns all geometry, routing, validation, and reference-resolution calculations.
- Chat must cover locate, route, closure/replanning, edits, clarification, and remembered constraints.
- Connect Builder's `build_building` tool when delivered; Interface owns rendering and voice input.
- Cross-building paths need an agreed Core contract; a building picker alone does not provide them.
- The brief mentions Sunday JSON output, while the kit defines the current test CSV and defers
  Sunday's exact format to release. Verify the released schema before the Sunday run.
