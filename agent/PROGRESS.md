# Agent progress

Source of milestones: `TEAM_PLAN.md`, section 5.2.

**Current status:** step 12 in progress: ElevenLabs speech input/output implemented and service/browser checks pass; v2 generated. Clean-clone rehearsal and the user's actual microphone check remain. Real Builder hookup and main UI integration remain pending dependencies.
**Checklist progress:** 11 / 12 steps = 91.7%.
This is milestone completion, not measured agent accuracy or a time estimate.

- [x] 1. Repository setup and dependencies
- [x] 2. Answer entry point and small live baseline
- [x] 3. Parallel benchmark runner
- [x] 4. Tool wrappers for Core methods
- [x] 5. Benchmark prompt and first accurate question type
- [x] 6. Scoreboard and failure diagnostics
- [x] 7. Integrate remaining question types and compare models
- [x] 8. Full dev evaluation and test submission v1
- [x] 9. BENCHMARK.md and clean-checkout rehearsal
- [x] 10. HTTP server, UI actions, and tested Builder hook (real Builder pending)
- [x] 11. Conversation behavior and tricky-user checks
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

## Step 5: benchmark prompt and live area evaluation (2026-10-24)

- Added `agent/prompts.py` with BENCHMARK_PROMPT and a separate CHAT_PROMPT (the preserved
  starter conversational instructions; interaction tuning remains step 11).
- BuildingAgent now accepts `mode="benchmark"` or `mode="chat"`, defaulting to chat.
  The evaluator's `answer()` explicitly selects benchmark mode. Both modes cache the building overview.
- The benchmark prompt maps all nine question patterns to the eight task tools, preserves exact
  floor/room/type words, instructs use of `label` for room answers, and supplies scored Answer formats.
- It calls for one direct task-specific tool on the successful path, limited search/retry on tool
  errors, and `Answer: unavailable` rather than an invented value if recovery fails.
- It distinguishes stairs-allowed errands, minimum-width deliveries, temporary closure calculations,
  stacked-room direction, and hypothetical doors on a different floor from the rooms being counted.
- The runner now optionally supplies the public kind as a hint (default on), records it as `kind_hint`,
  and offers `--no-kind-hints` to exercise the question-only interface used by the official evaluator.
  Expected answers and oracle inputs are never included in the model's user message.
- All 21 local tests pass, including prompt selection at the SDK boundary, chat-mode separation,
  benchmark selection in answer(), and kind hints containing only public metadata.
- Core dev oracle remains **138/138**.

Live verification:

1. Four-question sample without kind hints scored **4/4**. Three replies had extra explanatory
   text before the correct Answer line, so the final-response brevity instruction was strengthened.
2. The revised prompt was tested on every dev question of the two milestone kinds:

```bash
uv run --env-file .env python -m agent.benchmark data/dev data/dev \
  --kinds floor_area_total largest_room --no-kind-hints \
  --out agent_output/benchmark/step5_dev_areas.csv
```

- `floor_area_total`: **31/31**; `largest_room`: **20/20**; combined **51/51 (100%)**.
- All 51 replies are single plain `Answer:` lines; no API/scoring errors, one attempt each.
- Re-scored all saved replies with the official scorer and verified exact CSV/JSONL correspondence,
  unique IDs, and absence of kind hints. Inspected room labels on OSM and Swiss buildings.
- Results: `agent_output/benchmark/step5_dev_areas.csv` and `.jsonl`; sample in `step5_sample.*`.
- This meets the Agent's first end-to-end milestone and the >=90% acceptance target for these two kinds.
  It is not a live score for all nine kinds; that expansion belongs to steps 7 and 8.
- 55 live question runs in this step (4 sample + 51 full evaluation); exact credit spending not recorded.

## Step 6: scoreboard and tool traces (2026-10-24)

- Added `agent/report.py`: official per-kind scores and failure evidence (question, tool arguments,
  recorded results, reply, expected answer and errors). Run it without API credentials:

```bash
uv run python -m agent.report agent_output/benchmark/step6_traced.jsonl
```

- Every initialized answer attempt writes `trace.json` in its unique output directory. It records
  actual SDK tool calls/results, response IDs/model names/stop reasons, token usage and errors.
  It excludes model thinking and never re-executes tools to reconstruct a trace.
- The runner includes calls, token totals and per-attempt trace references in its JSONL sidecar.
  Context-local transfer keeps concurrent questions isolated; retries retain each attempt's evidence.
  Trace-file write errors do not mask successful answers or the original API error.
- Oracle inputs are retained only in evaluator diagnostics, never passed to the model. Extraction
  checks use Core's resolvers to compare room/floor/type/asset references and task constraints.
- Failure categories distinguish argument mismatches, final-answer rendering, tool errors, execution
  errors, prior state changes, and tool-result mismatches. The latter is a review signal, not proof
  of a Core bug. Diagnostics use the final attempt; usage includes all recorded attempts.
- Legacy logs remain readable. Missing traces, inputs, buildings and usage remain explicitly unknown;
  an API failure before a response is not counted as incorrect extraction. `--data` supplies a relocated
  building root; `--failures N` optionally limits printed failure details.
- All **34 offline tests pass**, including concurrent/retry isolation, partial traces, disk errors,
  all nine extraction mappings, symmetric endpoints and controlled failure classification.
- Required Core oracle remains **138/138**. Core, starter, benchmark reference and data files unchanged.
- Re-scored the previous area log: **51/51 correct**, with extraction/token coverage correctly unknown.
  Read the earlier 0/5 starter log and verified failure evidence prints without inventing old tool traces.

Live verification used two questions without kind hints:

```bash
uv run --env-file .env python -m agent.benchmark data/dev data/dev \
  --kinds floor_area_total largest_room --per-kind 1 --no-kind-hints \
  --out agent_output/benchmark/step6_traced.csv
```

- Answers **2/2 correct**, extraction **2/2 correct**, one task tool and one attempt each.
- Verified unique trace files match the CSV/JSONL replies, tool results, usage and model metadata.
- Recorded tokens: 1,001 input, 182 output, 16,172 cache-read input, 16,172 cache-creation input.
  These are provider-reported token categories, not a billing estimate.
- Live results are in ignored local `agent_output/benchmark/step6_traced.*`.

## Step 7: all-kind live samples and model selection (2026-10-24)

- All nine kinds were already available through the unchanged Core wrappers. Exercised them through
  live natural-language questions, without public kind hints or oracle inputs in model messages.
- Added per-instance model selection and `--model` to the runner. Precedence is explicit argument,
  then `AGENT_MODEL`, then the selected default. The official two-positional-argument entry point still works.
- Implemented the starter-pattern loop in `agent/agent.py` to pass the instance's model without changing
  global starter state or the shared API client. It preserves transcript mirroring and usage tracking.
- Benchmark mode omits server-side automatic fallback so a comparison does not silently change models.
  Chat retains the starter fallback behavior. Both comparison runs explicitly use medium effort.
- Traces and JSONL attempt details now include the requested model alongside the actual response model.
- Compared **the same 24 questions in the same order** with Opus 5.5 and Sonnet 5.5: both **24/24 answers
  correct and 24/24 extraction checks correct**. Verified every actual response model matched the requested
  model, with one attempt and one task tool per question. No prompt or Core changes were needed.
- Selected **`claude-sonnet-5-5`** as the default. Published base input/output rates are $2/$10 per million
  tokens for Sonnet versus $4/$20 for Opus, as checked on 2026-10-24 in
  [Anthropic's model comparison](https://platform.claude.com/docs/en/models/opus-5-5/overview).
  This choice is supported by the benchmark sample; conversational behavior remains step 11.

Reproduce the matched comparison (run once per model):

```bash
uv run --env-file .env python -m agent.benchmark data/dev data/dev \
  --per-kind 3 --no-kind-hints --model claude-opus-5-5 \
  --out agent_output/benchmark/step7_opus_compare.csv
uv run --env-file .env python -m agent.benchmark data/dev data/dev \
  --per-kind 3 --no-kind-hints --model claude-sonnet-5-5 \
  --out agent_output/benchmark/step7_sonnet_compare.csv
```

The selected default then passed a larger sample using no model override:

```bash
uv run --env-file .env python -m agent.benchmark data/dev data/dev \
  --per-kind 5 --no-kind-hints --out agent_output/benchmark/step7_sonnet_kinds.csv
uv run python -m agent.report agent_output/benchmark/step7_sonnet_kinds.jsonl
```

| Kind | Answers | Extraction |
| --- | --- | --- |
| errand | 5/5 | 5/5 |
| floor_area_total | 5/5 | 5/5 |
| largest_room | 5/5 | 5/5 |
| room_stacked | 5/5 | 5/5 |
| shared_walls_count | 5/5 | 5/5 |
| step_free_reachable_count | 1/1 | 1/1 |
| straight_line_3d | 5/5 | 5/5 |
| what_if_door | 2/2 | 2/2 |
| wide_delivery_count | 5/5 | 5/5 |
| **Total** | **38/38** | **38/38** |

- Rare kinds use every available dev example (one closure-reachability, two hypothetical doors).
  Every kind exceeds the >=90% sample target, but this is not a full dev score.
- Verified CSV/JSONL/trace correspondence, 38 distinct IDs, actual Sonnet responses, one attempt and
  task-tool call per question, and exactly one Answer line in each reply. No execution/scoring errors.
- All **36 offline tests pass**, including explicit/environment model selection, per-agent isolation,
  benchmark fallback omission, model propagation to traces and the existing full tool-boundary suite.
- Required Core oracle: **138/138**. Core, starter, reference benchmark and data files unchanged.
- **86 live question runs** in this step (24 Opus + 24 Sonnet + 38 Sonnet; samples overlap).
  Token usage is recorded in each JSONL; exact account spending is not asserted.
- Full local results and traces remain under ignored `agent_output/`. Commands, counts and the
  selection decision are preserved here for the team.

## Step 8: full dev evaluation and Team Simran submission v1 (2026-10-24)

- Ran the selected Sonnet model on **all 138 dev questions** without kind hints: **138/138 (100%)**,
  above the >=85% milestone target. The report also verified **138/138 correct extraction checks**.
- Every dev question used one attempt and one task tool; no execution/scoring errors. All replies
  were single Answer lines, matched their CSV/JSONL/trace records, and came from the requested Sonnet model.
- No agent, prompt or Core changes were needed. Evaluation used implementation commit `9873d57`.

| Dev kind | Correct |
| --- | --- |
| errand | 19/19 |
| floor_area_total | 31/31 |
| largest_room | 20/20 |
| room_stacked | 9/9 |
| shared_walls_count | 24/24 |
| step_free_reachable_count | 1/1 |
| straight_line_3d | 13/13 |
| what_if_door | 2/2 |
| wide_delivery_count | 19/19 |
| **Total** | **138/138** |

Commands used:

```bash
uv run --env-file .env python -m agent.benchmark data/dev data/dev \
  --no-kind-hints --model claude-sonnet-5-5 --out agent_output/benchmark/step8_dev.csv
uv run python -m agent.report agent_output/benchmark/step8_dev.jsonl
uv run --env-file .env python -m agent.benchmark data/test data/test/questions.csv \
  --no-kind-hints --model claude-sonnet-5-5 --out agent_output/benchmark/step8_test.csv
uv run python -m agent.report agent_output/benchmark/step8_test.jsonl
```

- The user confirmed the team name **Team Simran**. Saved the validated test CSV to
  **`submissions/team_simran_v1.csv`** with LF line endings for version control; verified all parsed
  rows match the original generated CSV exactly. This is the local v1 artifact; it has not
  been uploaded to the organizers or pushed to a remote.
- Test generation returned **145/145 nonempty replies**, one attempt and one task tool per question,
  no execution errors and no unavailable answers. Actual response models all matched Sonnet 5.5.
- Validated UTF-8, exact `question_id,answer` header, 145 unique IDs matching the official template,
  no missing/extra rows, exactly 146 physical lines, and exactly 145 plain Answer lines.
- The CSV is **5,631 bytes**, below the 5 MB limit. CSV replies match JSONL and per-attempt traces.
  Numeric answers have one finite nonnegative number; counts are integers. Room labels and numeric
  values match the recorded successful task-tool outputs, allowing only rounding to two decimals.
- Test inputs contain no reference answers or oracle arguments, so **test accuracy and extraction
  accuracy are unknown**. Output consistency and format checks are not a test-set correctness score.
- Required pre-commit Core oracle remains **138/138**. No Core, starter, benchmark or data edits.
- **283 live question runs** this step (138 dev + 145 test), without retries. Full diagnostics, token
  usage and validation summaries are saved locally under ignored `agent_output/benchmark/step8_*`.
  Provider token usage was captured; exact account spending is not asserted.

## Step 9: runbook and clean-checkout rehearsal (2026-10-24)

- Added `BENCHMARK.md`: prerequisites, credential setup, locked installation, exact single-building
  and full-split commands, CSV/JSONL/traces, score interpretation, model selection, retry behavior,
  submission validation, official/team checks, and the future Sunday building procedure.
- Clarified that train/dev have answer keys, test does not, and no hidden/unreleased judge tests
  are available locally. The submission comes from live agent answers, not model training.
- Ran the organizers' free warm-up oracle: **369/369** (100 locate, 40 count, 120 route,
  40 step-free route, 29 closure route, 40 tour). This tests direct starter tools, not LLM interpretation:

```bash
uv run --frozen python -m starter_agent.evaluate data/dev --oracle
```

- Created a clean local Git clone of committed `agent` at **`821292a`** using `git clone --no-local`.
  The runtime code came entirely from Git; no source files or original virtual environment were copied.
  This verifies the current unpublished local branch, not a download of the older remote branch.
- Clone location: `/private/tmp/team-simran-step9-1h1n28yw/repo`. It began with a clean working tree,
  no `.venv` and no `.env`. `uv sync --frozen` created its own Python 3.12.13 environment and installed
  all 37 packages successfully in **2.45 seconds**. Import checks confirmed `agent`, `core` and the
  interpreter came from the clone.
- Copied only the local credential file with owner-only permissions for the live checks and removed
  it in a `finally` cleanup. No key contents were printed or retained in copied diagnostics.
- The exact documented factory command passed **5/5**, with **5/5 extraction checks**, in **8.67 seconds**.
  The report ran successfully in 0.11 seconds. CSV replies matched JSONL and trace records.
- Also ran our agent through the organizers' unchanged official harness from that same clean clone:

```bash
uv run --frozen --env-file .env python -m benchmark.evaluate data/dev \
  --agent agent.answer:answer --per-kind 1 --name official_smoke
```

- Official harness: **9/9**, one question per benchmark kind, **24.65 seconds**. Independently re-scored
  all saved replies and verified their actual traces used Sonnet 5.5. The clone's working tree stayed clean.
- Preserved factory/official results, all 14 live traces and timing measurements under ignored
  `agent_output/step9_clean_clone/`. The temporary clone contains no `.env` after verification.
- These observed runtimes are machine/provider/cache dependent; the runbook includes extra time for
  downloads, latency and retries. Four workers are the default for our runner; the official runner is sequential.
- Required Core dev oracle remains **138/138**. No runtime implementation, data or v1 submission changes.
- **14 live question runs** this step; the 369 warm-up cases used no API credits. Exact account spending
  is not asserted. Step 8's full live dev score remains **138/138**.

## Step 10: HTTP API and UI actions (2026-10-24)

- Fetched teammate branches. `origin/main` still points to `ba29088`; no new Core changes to merge.
  Inspected `origin/ui` at `938cfa9`: request/response types match TEAM_PLAN.md §4.3.
  `origin/buildersim` currently contains no Builder implementation.
- Added `agent/server.py` with `GET /buildings`, `GET /buildings/{id}` and
  `POST /buildings/{id}/chat`. The catalog loads all 280 supplied buildings without question files.
  Pydantic validates requests; CORS permits the agreed `http://localhost:5173` origin.
- Each `(building_id, session_id)` owns a fresh Building and chat agent, with a lock serializing
  turns in that session. Different sessions run concurrently. UUID artifact paths do not use user IDs.
  State is in memory, limited to 256 sessions; the local demo uses one server worker.
- Added `agent/chat_tools.py`: action capture at successful tool execution, using the actual result.
  Routes capture geometry immediately, searches supply highlight IDs, closure actions contain the whole
  current closed set, and door actions contain the actual new opening. No actions are model-generated
  JSON, replayed tool calls, or stale previous-turn state.
- The server splits first-line `Understood:` / `Clarification:` markers into the response fields.
  Full conversation refinement remains step 11. Failed turns restore in-memory map/history and discard
  pending generated-building registrations. API errors return safe 429/502/500 responses.
- Added an optional `AGENT_BUILDER=module:function` integration hook for the agreed Builder signature.
  It accepts existing approved image paths, loads returned buildings through Core, checks matching/new
  IDs and publishes successful builds to the catalog with `building_created`. Without a configured
  real Builder callable the tool is not advertised. A controlled Builder fixture verifies the hook;
  **real Builder generation and upload/UI integration remain pending teammate delivery**.
- All **48 offline tests pass**: actual Core tool actions, multiple route snapshots, closures/reopening,
  door edits, rollback after model errors, request/CORS checks, same/different session concurrency,
  isolation across buildings, capacity, Builder publication and restricted image paths.

Live verification:

```bash
uv run --frozen --env-file .env uvicorn agent.server:app --host 127.0.0.1 --port 8010
```

- Port 8000 was occupied by an existing process; it was left untouched. Our test instance uses 8010.
  The UI currently targets 8000, so **joint browser-to-API verification is still pending port alignment**.
- Both GET endpoints passed; returned factory JSON exactly matches the source building.
- The plan's generic main-entrance/CNC request correctly returned clarification: this building has
  four entrances and no named main entrance. A same-session follow-up selected Warehouse zone H-C2,
  CNC mill H-A1-A and step-free travel. The returned route is **46.1 m**, with geometry and directions
  exactly matching Core's independently computed route.
- A subsequent request closed the actual Office lift (`proc-factory-dev-003-V02`). A separate session
  confirmed no lifts closed. A thank-you in the original session remembered its closure and returned
  no stale actions. Live CORS preflight returned the exact allowed UI origin.
- Five successful live chat turns; saved replies are in ignored `agent_output/server/`.
  These are real API/Core integration checks, not a claim that the browser UI or Builder was exercised.
- Added `agent/SERVER.md` with commands, state/action semantics, Builder wiring and UI follow-ups.
  The remote UI currently substitutes mock answers on API failures and lacks a `building_created`
  dispatcher case; both are flagged for the Interface owner, without editing their files.
- Required Core oracle remains **138/138**. Benchmark runtime/prompt/tool behavior and v1 submission
  are unchanged; the existing full live benchmark score remains 138/138 from step 8.
- Confirmed with the user that **ElevenLabs text-to-speech (`POST /tts`) is step 12**. It is not
  implemented in this step. The UI already attempts this endpoint and currently falls back to browser speech.

## Step 11: conversational behavior (2026-10-24)

- Replaced the starter chat prompt with explicit clarification, location/constraint memory, destination
  replacement, grounded directions, closure/reopening and persistent-edit instructions.
- Added session context and `remember_context`. Confirmed position changes only through an explicit
  memory call; route planning does not advance it. Chat routing tools enforce remembered step-free
  requirements. Failed HTTP turns roll back context alongside the map and conversation.
- Multi-stop routes return Core-computed leg distances and one complete UI route; internal leg
  calculations no longer leave the UI showing only the final leg. Door edits report actual before/after
  distances between the edited rooms. Closures/edits invalidate stale server route state/actions.
- UI directions strip internal references while preserving human labels. Documented the Interface
  follow-up to clear a previously displayed route on a closure/edit with no replacement route.
- Added `agent.interactions`, a CLI that drives the real server handler with live Claude calls, plus
  reproducible fixtures adapted from Interface's ten tricky-user scenarios. Expectations remain in
  the test harness, never in model messages. Full evidence: `docs/interaction_log.md`.
- Matching baseline: **12/15** checks passed. First revision: **15/15**. Manual review found extra
  clarification and unsupported indoor-connectivity claims; tightened the prompt. Final revision:
  **17/17**, including two additional turns testing a remembered wheelchair need for nearest amenities.
- Confirmed final stored positions/accessibility against Core. These are team regression checks,
  not the official interaction score or proof of perfect behavior on arbitrary questions.
- All **56 offline tests pass**; required Core oracle **138/138**. The benchmark prompt is byte-for-byte
  unchanged and benchmark mode still uses the original Core wrappers. No new full live benchmark run
  was needed here; step 8's live dev score remains **138/138**, to be rerun in step 12.
- Restarted only our port-8010 verification server. Two live HTTP turns routed Warehouse zone H-C2
  to Office 1.20 (**151.1 m**, step-free), then changed the destination to Kitchen 0.28 (**53.87 m**)
  without repeating the start or wheelchair requirement. Both geometry/direction payloads match Core.
- **49 live chat turns** across baseline, revisions and HTTP smoke checks. Exact account spending is
  not asserted. Local transcripts are ignored under `agent_output/interactions/`; source fixtures and
  the summarized evidence are committed. Source data, Core, starter, official evaluator and v1 CSV unchanged.

## Step 12 in progress (2026-10-24)

- Created a restricted ElevenLabs key at the user's explicit request and saved it only in ignored
  `.env` with owner-only permissions. Speech-to-text, text-to-speech and Voices read are enabled;
  ElevenAgents access is disabled. The API returned the available standard voices successfully.
- Added speech input and output around the existing BuildingAgent, plus the Agent-owned `/voice` page.
  The transcript is reviewed before calling the unchanged chat endpoint. Voice and typed messages
  share the same building/session context. No ElevenLabs agent was created.
- Voice works with catalog building data, including new registrations; vocabulary construction is
  checked for all 280 supplied buildings. Fixed an observed large-building provider keyword-token
  rejection with bounded hints and a one-time transcription fallback without hints.
- Live browser speech upload → transcript → agent/Core → ElevenLabs audio and playback passed on
  the factory. Residential and Swiss service checks returned Core-verified areas and playable MP3s.
  See `agent/VOICE.md`. The user is trying the actual microphone separately; do not claim it passed yet.
- **67 offline tests pass**, including 11 speech tests; Core oracle **138/138**.
- Full live dev rerun: **138/138 answers and 138/138 extraction checks**, no execution errors.
- Generated 145 fresh test replies, validated the CSV, and saved `submissions/team_simran_v2.csv`
  (5,777 bytes). Test answers remain unscored because the organizers provide no test answer key.
- Pending: clean-clone rehearsal, actual-microphone confirmation, and loading the final vocabulary
  fix into the running voice server after the user's ongoing microphone test.

## Remaining step 12 work

Complete the clean-clone rehearsal and actual-microphone check. Carry forward real Builder hookup and
main UI checks as teammate code becomes available. Finishing the checklist does not guarantee
perfection on unseen questions. The main Interface microphone still uses browser recognition; both
ElevenLabs directions are available now on the Agent-owned `/voice` page.

## Integration points to keep visible

- Core owns all geometry, routing, validation, and reference-resolution calculations.
- Chat must cover locate, route, closure/replanning, edits, clarification, and remembered constraints.
- Connect Builder's `build_building` tool when delivered; Interface owns rendering and voice input.
- Cross-building paths need an agreed Core contract; a building picker alone does not provide them.
- The brief mentions Sunday JSON output, while the kit defines the current test CSV and defers
  Sunday's exact format to release. Verify the released schema before the Sunday run.
