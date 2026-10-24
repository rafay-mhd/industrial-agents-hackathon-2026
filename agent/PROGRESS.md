# Agent progress

Source of milestones: `TEAM_PLAN.md`, section 5.2.

**Current status:** step 3 complete; step 4 next.
**Checklist progress:** 3 / 12 steps = 25%.
This is milestone completion, not measured agent accuracy or a time estimate.

- [x] 1. Repository setup and dependencies
- [x] 2. Answer entry point and small live baseline
- [x] 3. Parallel benchmark runner
- [ ] 4. Tool wrappers for Core methods
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

## Next: step 4

Implement `agent/tools.py::make_tools(building)` around the agreed Core API. Preserve existing
search, route, closure, and door-edit capabilities; add wrappers for the delivered computation
methods, with clear descriptions and compact outputs. Report unavailable Core methods honestly
until the teammate delivers them. Keep geometry and routing implementations in Core's ownership.

## Integration points to keep visible

- Core owns all geometry, routing, validation, and reference-resolution calculations.
- Chat must cover locate, route, closure/replanning, edits, clarification, and remembered constraints.
- Connect Builder's `build_building` tool when delivered; Interface owns rendering and voice input.
- Cross-building paths need an agreed Core contract; a building picker alone does not provide them.
- The brief mentions Sunday JSON output, while the kit defines the current test CSV and defers
  Sunday's exact format to release. Verify the released schema before the Sunday run.
