# Test log

One entry per test run, newest first. Every entry names the commit it was run on, the exact commands, the
numbers, and every miss with its cause. Add an entry whenever Core, Agent prompts or tools change, and after
each dev run before a new submission CSV.

## How to add an entry

```bash
# free, seconds: the maths against the dataset's own parameters
uv run python -m core.oracle_check data/train
uv run python -m core.oracle_check data/dev
uv run python -m core.oracle_check data/dev --warmup
# does every name in a question file resolve? (run on the Sunday building first)
uv run python -m core.check_questions data/test data/test/questions.csv
# live, costs credits: Claude reads the sentence, picks the tool, core computes
uv run --frozen --env-file .env python -m agent.benchmark data/dev data/dev --no-kind-hints --model claude-sonnet-5-5 --out agent_output/benchmark/dev.csv
uv run --frozen python -m agent.report agent_output/benchmark/dev.jsonl
```
Record: date, commit, model, per-kind answers and extraction, misses with cause, tokens or cost, runtime.
"Extraction" = the rooms, floors, types and widths Claude passed to the tool matched the dataset's hidden
`inputs`. Raw logs stay under `agent_output/` (ignored by git); only the summary goes here.

---

## 2026-10-24 — full live run, sentence only, all train + dev questions

**Commit**: `ceeeee2` (main, after the Agent branch merge). **Model**: `claude-sonnet-5-5`, benchmark prompt
for the scored kinds, chat prompt for the warm-ups, `--no-kind-hints`, 4 workers. **Run by**: Core owner.

### Scored kinds (`questions.jsonl`), official scorer

| Kind | Train answers | Train extraction | Dev answers | Dev extraction |
|---|---|---|---|---|
| floor_area_total | 150 / 150 | 150 / 150 | 31 / 31 | 31 / 31 |
| largest_room | 76 / 76 | 76 / 76 | 20 / 20 | 20 / 20 |
| shared_walls_count | 118 / 119 | 118 / 119 | 24 / 24 | 24 / 24 |
| errand | 74 / 74 | 73 / 74 | 19 / 19 | 19 / 19 |
| wide_delivery_count | 61 / 61 | 61 / 61 | 19 / 19 | 19 / 19 |
| straight_line_3d | 17 / 17 | 15 / 17 | 13 / 13 | 13 / 13 |
| room_stacked | 17 / 17 | 16 / 17 | 9 / 9 | 9 / 9 |
| what_if_door | 2 / 2 | 2 / 2 | 2 / 2 | 2 / 2 |
| step_free_reachable_count | 1 / 1 | 1 / 1 | 1 / 1 | 1 / 1 |
| **Total** | **516 / 517 (99.8%)** | **512 / 517** | **138 / 138 (100%)** | **138 / 138** |

Tool choice correct on all 655; one tool call per question; no API errors, no retries.

### Warm-up kinds (`questions_basic.jsonl`), starter scorer on what the tools computed

| Kind | Train | Dev |
|---|---|---|
| locate | 452 / 453 | 100 / 100 |
| count | 199 / 199 | 40 / 40 |
| route | 595 / 600 | 120 / 120 |
| route_step_free | 198 / 200 | 40 / 40 |
| route_with_closure | 107 / 109 | 28 / 29 |
| tour | 198 / 200 | 40 / 40 |
| **Total** | **1,749 / 1,761 (99.3%)** | **368 / 369 (99.7%)** |

Two starter-scorer artifacts were corrected by hand when reading the raw results: (1) the chat agent locates
items via `assets_of_type`, not the starter's `search_building`, so `located_asset_ids` is never set even when
the reply names the right room (checked by text instead); (2) on "is there a step-free route" questions whose
answer is no, the agent says no and then also shows the normal route, which the starter scorer misreads as a
found step-free route.

### Misses, with cause
- **17 of 18**: identical room names on the same floor in two OSM buildings (`osm-way37850565`: nine rooms
  named "Büro" on floor 1, three on the ground floor; `osm-way58216509`: duplicate labels such as
  "Generic room N2146"). The question text cannot distinguish them. Benchmark mode ran the tool for every
  candidate and took the majority (right in 4 of 5). Chat mode asked which room was meant (right behaviour,
  scored as a miss). **The test set has none of these**: `core.check_questions` resolves all 109 room mentions
  in the 145 test questions to exactly one space.
- **1 of 18**: `swiss-3338-Q01` locate; the reply "Outdoor table 2.17, on the balcony of apartment 10
  (Balcony 2.17)" is correct, the text check expected the dataset's word order. Not an agent error.

### Cost and time
| Run | Questions | Time | Approx. cost (Sonnet list prices) |
|---|---|---|---|
| Benchmark train + dev | 655 | 15 min | $10 |
| Warm-up dev | 369 | 6 min | $4.50 |
| Warm-up train | 1,761 | 27 min | $21 |
| **Total** | **2,785** | | **≈ $36** |

Tokens, benchmark train: 349k input, 55k output, 6.16M cache read, 2.20M cache write. Dev: 91k / 15k / 1.88M / 0.53M.

### Open items
- Sunday building: run `core.check_questions` first; duplicate room names there would be the only known risk.
- Optional: a regex pre-extractor for the templated wording as a no-LLM fallback (Core offer, not built).

---

## 2026-10-24 — core oracle (no LLM), all train + dev

**Commit**: `a8279d8` (core branch, merged to main). Parameters fed straight from the dataset's `inputs`.

| Set | Questions | Correct |
|---|---|---|
| Train benchmark, 9 kinds | 517 | 517 |
| Dev benchmark, 9 kinds | 138 | 138 |
| Train warm-up (locate, count, 4 route kinds) | 1,761 | 1,761 |
| Dev warm-up | 369 | 369 |

Calibrations made to reach this: shared walls count rooms and halls only (balconies excluded, 143/143);
room answers carry the room number (`label`) because OSM rooms share names. `errand` `via`/`target` ids match
the dataset in 93/93. `what_if_door` rests on only 4 examples.

---

## 2026-10-24 — Agent owner's runs (from `agent/PROGRESS.md`)

**Commit**: `9873d57`. Full dev live: **138/138** answers, **138/138** extraction, Sonnet 5.5, no kind hints.
Opus vs Sonnet on the same 24 questions: both 24/24; Sonnet chosen. Test CSV `submissions/team_simran_v1.csv`
generated: 145 rows, all with Answer lines. Clean-clone BENCHMARK.md rehearsal: 5/5 on the factory building;
organizers' evaluator from the clone: 9/9 (one per kind).
