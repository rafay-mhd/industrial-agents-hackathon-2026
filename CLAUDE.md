# Project instructions

Source: `TEAM_PLAN.md`, sections 3 and 4. Keep these shared contracts aligned with the team plan.

## 3. Shared rules

**Repo**: `https://github.com/rafay-mhd/industrial-agents-hackathon-2026` (our fork). The organizers' repo is
`upstream`; the Sunday building may arrive there (use "Sync fork" or `git fetch upstream`).

**Folders**: you only edit your own folder plus `docs/` for your own documents. `starter_agent/` and
`benchmark/` are never edited; they are the reference. `data/` is never edited.

**Branches**: one per role: `core`, `agent`, `ui`, `builder`. Commit small and often; message starts with the
role: `core: shared walls solver`. Only Agent merges to `main`, at the checkpoints. `main` must always pass
`uv run python -m core.oracle_check data/dev` and the `BENCHMARK.md` command on one dev building.

**Secrets**: `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY` live in `.env` (gitignored) and nowhere else.

**Installs**: `uv` (installs Python 3.12 for you: `uv python install 3.12`), then `uv sync`. Interface also
needs Node.js 20+. Do not run the repo from an iCloud or OneDrive folder; four people syncing `.git` through
a cloud drive corrupts it.

**Checkpoints** (15 minutes, everyone shows their check, Agent merges). Fill in the times at kickoff:
| CP | Time | What everyone shows |
|---|---|---|
| 0 | kickoff + 1 h | `____:__` | env works, starter runs, playbook step 1–2 done |
| 1 | + 4 h | `____:__` | first thin slice: one scored kind at ~100%, one floor drawn, validator runs |
| 2 | end of day 1 | `____:__` | all nine kinds in, dev ≥ 85%, **test CSV v1 committed**, server live, UI on the real server |
| 3 | Sunday morning + 2 h | `____:__` | core frozen, test CSV v2, interaction tuned, voice, demo script |
| 4 | Sunday release | `____:__` | Sunday command run and submitted |
| 5 | freeze − 60 min | `____:__` | video, explanation, repo tagged |

**Interruptions**: if you are stuck for 20 minutes, ask a teammate, not Claude again. Core and Agent expect
interruptions; it is part of their job this weekend.

**Working with Claude Code, for everyone**
- One step, one check, one commit. Every step below ends with a check command; have Claude run it before you commit.
- Test first when there is a truth file (Core and Builder both have ground truth).
- Plan mode for anything over 30 minutes: let Claude propose, read it, then build.
- Point Claude at one building and one question kind, not the whole `data/` folder.
- If Claude wants to edit another owner's folder, stop and message that owner.

---

## 4. Contracts (change only after telling the whole team)

### 4.1 Core → Agent: Python API in `core/building.py`
`class Building(starter_agent.building_map.BuildingMap)`. Every method returns plain dicts/lists (JSON-able).
Every method accepts human references: a space id, an asset id, an exact name (`"Office 1.12"`), a ref
(`"1.12"`), or a unique substring. `floor` arguments accept an int level (`1`), a floor id, or words
(`"ground floor"`, `"Floor 2"`, `"Basement 1"`).

```python
Building.load(path)                                             # inherited
# lookups
b.resolve_space(ref) -> str                                     # id | name | ref | unique substring, else MapError listing candidates
b.resolve_floor(floor) -> str                                   # -> floor_id
b.room_types() -> list[str]
b.rooms(floor, room_type=None) -> list[dict]                    # {id, name, ref, type, room_type, area_m2}
# geometry
b.area_m2(space) -> float
b.largest_room(floor, room_type) -> dict                        # {space_id, name, ref, area_m2, runner_up: {name, area_m2}}
b.total_area(floor, room_type) -> dict                          # {total_m2, count, rooms: [{name, area_m2}]}
b.centroid_3d(space) -> dict                                    # {x, y, z}
b.straight_line_3d(a, b) -> dict                                # {distance_m, a: {...}, b: {...}}
b.shared_wall_rooms(space, min_len_m=1.0, tol_m=0.35) -> dict   # {count, rooms: [{name, shared_m}]}
b.stacked_room(space, direction) -> dict                        # direction "above"|"below"; {space_id, name, ref, overlap_m2, runner_up}
# graph
b.route(start, dest, step_free=False, via=None) -> RouteResult  # inherited
b.reachable_rooms(start, floor, step_free=True, min_width_m=None, closed=()) -> dict   # {count, rooms: [names]}
b.nearest_room_with_asset(start, asset_type, step_free=False) -> dict   # {space_id, name, distance_m, asset_id}
b.errand(start, asset_type, floor, room_type, step_free=False) -> dict  # {total_m, via: {...}, target: {...}, legs: [m, m]}
b.distance_to_exit(space, step_free=False) -> float
b.what_if_door(a, b, floor, threshold_m=1.0) -> dict            # {count, door: {...}, rooms_improved: [{name, before_m, after_m}]}
b.set_closed(ref, closed) / b.add_door(a, b)                    # inherited
b.route_geometry(route) -> dict                                 # {"floors": {"0": [[x,y],...], "1": [...]}, "length_m": ..}
```
Rules: no printing, no network, no state except `closed`. Each method covered by `core/oracle_check.py`.

### 4.2 Agent: entry point and benchmark command (what `BENCHMARK.md` documents)
```python
# agent/answer.py
def answer(building_directory: Path, question_text: str) -> str: ...
```
```
uv run --env-file .env python -m agent.benchmark <building_dir_or_split_dir> <questions.jsonl|questions.csv> --out answers.csv
```
Accepts one building folder or a whole split; questions as JSONL (`questions.jsonl`) or CSV
(`questions.csv` with `question_id,building_id,kind,question`). Parallel (4–6 workers), retries with backoff,
one failing question never stops the run (it still gets a row). Prints per-kind results when answers exist.
Also works through the kit: `python -m benchmark.evaluate data/dev --agent agent.answer:answer`.

### 4.3 Agent → Interface: HTTP API (`uv run uvicorn agent.server:app --reload --port 8000`)
```
GET  /buildings                      -> [{"id", "name", "source", "floors": [{"level", "name"}]}]
GET  /buildings/{id}                 -> the raw building.json (the UI draws polygons itself)
POST /buildings/{id}/chat            body {"session_id": "...", "message": "..."}
  -> {"reply": "...",                                   # what the user reads / hears
      "understood": "From Lobby 0.01 to Lab 1.07, step-free, Lift 1 closed" | null,
      "needs_clarification": false,
      "actions": [
        {"type": "route", "length_m": 123.4, "steps": ["..."], "floors": {"0": [[x,y],...], "1": [[x,y],...]}},
        {"type": "highlight", "space_ids": ["..."], "asset_ids": ["..."]},
        {"type": "closed", "element_ids": ["..."]},
        {"type": "door_added", "opening": {...}},
        {"type": "building_created", "building_id": "..."}
      ]}
POST /tts                             body {"text": "..."} -> audio/mpeg   (ElevenLabs; Sunday)
```
CORS open for `http://localhost:5173`. Interface works against `ui/mock/*.json` in exactly these shapes until CP2.

### 4.4 Builder → Core: Level 4 output
A `building.json` in the README §3 schema (section 1 above), one floor per `floors[]` entry, stairs and lifts
as `vertical_connectors`. Checked by:
```
uv run python -m builder.validate <generated.json> <truth_building_dir>      # IoU, refs, door pairs
uv run python -m core.validate_building <generated.json>                    # loads, connected, no overlaps
```
Agent tool signature (agreed at CP1): `build_building(name: str, image_paths: list[str]) -> {"building_id", "path", "report"}`.

---

## Required check

Run `uv run python -m core.oracle_check data/dev` before committing in `core/` or `agent/`.
If Core has not delivered this module yet, run the command, report that it is unavailable,
and record the bootstrap checks actually performed; do not claim the oracle passed.

## Agent workflow

Follow TEAM_PLAN.md section 5.2 one step at a time. Update `agent/PROGRESS.md` after each step.
Report the current step, verification results, and completed steps / 12 as a checklist percentage.
This percentage measures milestones completed, not benchmark accuracy or remaining effort.
Do not make live model calls during setup. Activate Anthropic credits before the step 2 live baseline.
