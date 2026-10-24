# Agent plan: integrating the core

For the Agent owner and their Claude Code session. Start the session with:

> Read TEAM_PLAN.md section 5.2, then docs/agent_plan.md, then core/README.md. I am the Agent owner.
> Follow the steps in docs/agent_plan.md section 3 one at a time, running each check before moving on.

---

## 1. What the core gives you

`core/building.py` defines `Building`, a subclass of the starter's `BuildingMap`. Everything the starter
could do still works (`route`, `search`, `overview`, `set_closed`, `add_door`, `describe_space`). On top,
about twenty methods compute every fact the benchmark and the chat need. All of them are proven: fed with
the dataset's own parameters they reproduce **517/517 train and 138/138 dev** benchmark answers and
**2,130/2,130 warm-up** answers through the official scorer.

```python
from pathlib import Path
from core import Building, MapError

b = Building.load(Path("data/dev/proc-factory-dev-003"))      # ~30 ms even for the largest building
```

### Methods by purpose
| Purpose | Method | Returns |
|---|---|---|
| **Scored kinds** | `total_area(floor, room_type)` | `{total_m2, count, floor, room_type, rooms}` |
| | `largest_room(floor, room_type)` | `{space_id, name, label, ref, area_m2, floor, room_type, runner_up, candidates}` |
| | `straight_line_3d(a, b)` | `{distance_m, horizontal_m, vertical_m, a, b, warning?}` |
| | `shared_wall_rooms(space)` | `{count, room, floor, rooms: [{name, room_type, shared_m}]}` |
| | `stacked_room(space, "above" or "below")` | `{space_id, name, label, ref, floor, overlap_m2, overlap_share, runner_up}` |
| | `reachable_rooms(start, floor, step_free=True, min_width_m=None, closed=())` | `{count, floor, start, rooms, closed}` |
| | `errand(start, asset_type, floor, room_type, step_free=False)` | `{total_m, legs_m, start, via, target, steps}` |
| | `what_if_door(a, b, floor, threshold_m=1.0)` | `{count, door, between, floor, rooms_improved}` |
| **Chat helpers** | `rooms(floor, room_type=None)` | list of rooms largest first, each with `label` and `area_m2` |
| | `nearest_room_with_asset(start, asset_type, step_free=False)` | `{space_id, name, floor, distance_m, asset_id, asset_name}` |
| | `distance_to_exit(space, step_free=False)` | metres to the nearest entrance |
| | `assets_of_type(asset_type, floor=None)` | list of items with their rooms |
| | `room_types(floor=None)`, `asset_types(floor=None)` | the vocabularies of this building |
| | `area_m2(space)`, `centroid_3d(space)` | single facts |
| **Routing** | `route(start, dest, step_free=False, via=None)` | starter `RouteResult`: `length_m`, `steps`, `space_path` |
| | `route_geometry(route=None)` | `{length_m, floor_order, floors: {"0": [[x, y], ...]}, start, destination}` for the UI |
| | `set_closed(ref, True/False)`, `add_door(a, b)` | starter behaviour, caches refreshed |
| **Lookups** | `resolve_space(ref, floor=None)`, `resolve_floor(floor)` | ids, or `MapError` with candidates |
| | `search(query, floor_level=None)` | starter free-text search over rooms and items |

### What the methods accept (so Claude can copy words instead of translating them)
- **space**: id, asset id, exact name `"Office 1.12"`, number `"1.12"`, name with floor as in the questions
  `"Kitchen 2.09 (apartment 6) (Floor 2)"`, a unique part of a name, or an item `"cnc mill"` / `"CNC mill H-A1-A"`
  (resolves to the room holding it, or lists the candidates if several rooms have one).
- **floor**: `1`, `-1`, a floor id, `"ground floor"`, `"Floor 2"`, `"floor 2"`, `"Basement 1"`, `"first floor"`.
- **room_type**: `"generic_room"` or `"generic room"`, `"offices"`, `"meeting room"`, `"lab"`.
- **asset_type**: `"ups unit"`, `"office chair"`, `"3d printer"`, singular or plural.

Every method raises `MapError` with a message that lists candidates, floors or types. Pass that message
back to Claude as a tool error; one retry fixes most slips.

### Three details that decide points
1. **Use `label`, not `name`, in Answer lines for rooms.** OSM buildings have several rooms called "Büro";
   `label` adds the number: `Büro (1.02)`. The scorer needs the number.
2. **Answer-line shapes** (from `core/README.md`): numbers as `Answer: 214.70`, counts as `Answer: 6`,
   largest room as `Answer: Seminar room 0.32, 61.4 m²`, stacked room as `Answer: Office 1.29`. Never `m2`,
   never a comma decimal, never two numbers.
3. **Mutable state.** `set_closed` and `add_door` change the `Building` in place and affect later calls. For
   the benchmark, load a fresh `Building` per question (30 ms) so questions never leak state into each other,
   and so a parallel runner needs no locking. For the chat, one `Building` per session is exactly what you want.

### Tools that are not methods
- `python -m core.oracle_check data/dev` proves the maths; run it after every merge that touches `core/` or `agent/`.
- `python -m core.check_questions <building_or_split> <questions.csv|jsonl>` resolves every name in a question
  file with no LLM. Run it on the Sunday building first; a problem there is a Core problem, not yours.
- `python -m core.validate_building <building.json>` for buildings the Builder generates.

---

## 2. How to integrate: the pattern

### 2.1 Tool wrappers (your step 4)
One `@beta_tool` per method, exactly the starter's pattern in `starter_agent/tools.py`. The docstring is
what Claude reads, so write it in question vocabulary and tell it to copy words verbatim:

```python
from anthropic import beta_tool
from anthropic.lib.tools import ToolError
from core import Building, MapError

def make_tools(b: Building, output_directory: Path) -> list:
    def guard(call):                      # MapError -> tool error Claude can read and retry on
        try:
            return as_json(call())
        except MapError as error:
            raise ToolError(str(error)) from error

    @beta_tool
    def largest_room(floor: str, room_type: str) -> str:
        """Largest room of one type on one floor, with its area in m². Use for "which is the largest X on floor N".

        Args:
            floor: Copy the floor words from the question, e.g. "ground floor", "floor 2", "Basement 1".
            room_type: Copy the room type words from the question, e.g. "meeting room", "generic room", "office".
        """
        return guard(lambda: b.largest_room(floor, room_type))

    @beta_tool
    def total_area(floor: str, room_type: str) -> str:
        """Total floor area in m² of every room of one type on one floor. Use for "total area of every X on floor N"."""
        return guard(lambda: b.total_area(floor, room_type))

    # ... straight_line_3d(first_room, second_room), shared_wall_rooms(room), stacked_room(room, direction),
    #     reachable_rooms(start, floor, min_width_m, closed_element), errand(start, item, floor, room_type),
    #     what_if_door(first_room, second_room, floor), plus the starter's search_building, find_route, set_closed, add_door
    return [...]
```

Guidelines for the wrappers:
- Parameter names in the words of the questions: `room`, `start`, `item`, `floor`, `min_width_m`, `closed_element`.
- Say "copy exactly as written in the question, including any '(Floor 1)' part" in every room argument.
- Keep results compact: the number or label first, then at most 20 supporting rows. `rooms` lists on big
  OSM buildings can run to hundreds of entries; truncate them in the wrapper.
- Nine benchmark kinds map to eight tools (`wide_delivery_count` and `step_free_reachable_count` are both
  `reachable_rooms`). The chat needs the starter's four plus `rooms`, `nearest_room_with_asset`, `distance_to_exit`.

### 2.2 Benchmark prompt (your step 5)
Put these in `BENCHMARK_PROMPT`, verbatim where quoted:
- The nine patterns and their tool, as a table.
- "Copy room names, floor words and type words exactly as written in the question; do not translate them."
- "Call exactly one tool; never compute areas, counts or distances yourself."
- "If a tool reports an error with candidates, pick the candidate that matches the question and call once more."
- "Finish with one line `Answer: ...`" plus the four shapes and the ✅/❌ examples from `core/README.md`.
- "For room answers use the tool's `label` field."
- If the question file has a `kind` column, prepend `Question kind: <kind>.` to the user message as a hint.
  Do not rely on it; the Sunday file may not have it.
- Keep the building overview (`b.overview()`) in the cached system block as the starter does.

Consider forcing a tool call on the first turn (`tool_choice={"type": "any"}`) so the model cannot answer
from its head. Check the SDK's `tool_runner` options for how to pass it.

### 2.3 Measuring the reading step, not just the answer (your step 6)
Log every tool call (name and arguments) in `answer()`. On dev, compare the arguments with the question's
`inputs` using the core's own resolvers, so you know whether a miss is reading or maths:

```python
b.resolve_floor(args["floor"]) == inputs["floor_id"]
b.normalize_room_type(args["room_type"]) == inputs["room_type"]
b.resolve_space(args["start"]) == inputs["start"]
b.normalize_asset_type(args["item"]) == inputs["asset_type"]
```
Print per-kind: extraction correct / answer correct. Reading failures are yours; a correct extraction with a
wrong answer goes to Core.

### 2.4 The server (your step 10)
One `Building` per `session_id`; it carries `closed`, added doors and `last_route`. Derive the `actions` of the
HTTP contract (TEAM_PLAN 4.3) from the tools that were called in the turn:

| Tool called | Action |
|---|---|
| `find_route` | `{"type": "route", **b.route_geometry(b.last_route), "steps": b.last_route.steps}` |
| `search_building` | `{"type": "highlight", "space_ids": [...], "asset_ids": b.located_asset_ids}` |
| `set_closed` | `{"type": "closed", "element_ids": sorted(b.closed)}` |
| `add_door` | `{"type": "door_added", "opening": result}` |
| `build_building` (Builder's tool) | `{"type": "building_created", "building_id": ...}` |

Generate the UI's mock fixtures from real data in one go, so Interface works against the true shape today:
```python
b = Building.load(Path("data/dev/proc-factory-dev-003")); r = b.route("Office 1.04", "Production zone H-A1")
json.dump({"reply": "...", "understood": "From Office 1.04 to Production zone H-A1", "needs_clarification": False,
           "actions": [{"type": "route", **b.route_geometry(r), "steps": r.steps}]}, open("ui/mock/chat_route.json", "w"), indent=1)
```

### 2.5 The chat prompt (your step 11)
The core helps the conversation in three places: `resolve_space` errors list candidates with their floors
(ask the user which one), `nearest_room_with_asset` answers "where is the closest coffee machine", and
`route_geometry` plus `RouteResult.steps` give the numbered directions. Tell Claude: one line
`Understood: ...` first, one question at most when the candidates list has several entries, directions as
numbered steps with room names and landmarks, never ids.

---

## 3. When: integration mapped onto your twelve steps

| Your step | Core involvement | Check before moving on |
|---|---|---|
| 1 Repo plumbing | none. Add `fastapi`, `uvicorn` to `pyproject.toml`; add `"agent"` to its `packages` list. | `uv run python -c "import fastapi, core"` |
| 2 Entry point wrapping the starter | none | kit evaluator runs on `--kinds floor_area_total --per-kind 2`, score ~0 |
| 3 Parallel runner | load a **fresh** `Building` per question inside `answer()` | 5 dev questions of one building → CSV with 5 rows |
| **4 Tool layer** | wrap the eight scored methods first, chat helpers second (section 2.1) | `python -m core.oracle_check data/dev` still 100%; a script lists the tool names |
| 5 Benchmark prompt | answer shapes and `label` rule from `core/README.md` (section 2.2) | `--kinds floor_area_total largest_room` on dev through Claude ≥ 90% |
| 6 Scoreboard | extraction check with the core resolvers (section 2.3) | failures split into reading vs maths |
| 7 Wire kinds, pick model | one kind at a time, `--per-kind 5` | every kind ≥ 90% on its sample |
| 8 Full dev run, test CSV v1 | `python -m core.check_questions data/test data/test/questions.csv` first (already clean today) | dev ≥ 85%; 145 rows, 145 `Answer:` lines; commit `submissions/team_<name>_v1.csv` |
| 9 BENCHMARK.md | document that the command needs only `uv sync` and `.env` | clean-clone run on one dev building |
| **10 Server** | `route_geometry`, `set_closed`, `add_door`, `located_asset_ids` → actions (section 2.4); generate `ui/mock/*.json` | `curl` a chat request returns a `route` action with per-floor points |
| 11 Chat prompt | `resolve_space` candidates, `nearest_room_with_asset`, `steps` (section 2.5) | Interface's ten tricky-user scripts pass by hand |
| 12 CSV v2, dry run | rerun `core.oracle_check` and `core.check_questions` after any merge | dev ≥ 95% or every failure understood |

Sunday: `python -m core.check_questions data/sunday/<id> <questions file>` the moment the building arrives.
If it reports problems, the Core owner fixes names while you keep the runner warm.

---

## 3b. Kit 1.1.0 (2026-10-24 evening): what changed for you
- The organizers corrected the route rules (door-to-door walking, stairs 2 m per metre climbed, lift 15 m +
  1 m per metre, no way round the outside) and recomputed 1,314 train/dev answers. The core follows the new
  rules and is back at 100% on all of them. Your tools need no change; **regenerate the test CSV**.
- The hidden-building route questions are graded on the **ordered list of spaces passed through**, validity
  first, then length within 1%. Use `route_summary()` (new) for that list; `RouteResult.space_path` now
  includes corridors crossed door to door.
- "No route" is a correct answer when the rules forbid one. `route()` raises `MapError` then; the reply
  should say so instead of guessing.
- `route(..., forklift=True)` applies the organizers' forklift note (openings ≥ 3 m, bays only as
  destinations). Expose it as a tool parameter for the Sunday file in case forklift questions appear.
- A fresh `Building` per question is still the right pattern: walking lengths are shared per building, so
  only the first load of a building pays (7 s for Terminal 2, under 1 s elsewhere).

## 4. Gotchas we already hit
- **`import anthropic` fails inside Claude Code's sandbox** on this machine: the sandbox refuses to read any
  path named `credentials*`, and the SDK has a folder with that name. Run anything that calls the API from your
  own terminal, or let Claude Code run that command outside the sandbox when it asks. The core does not import
  `anthropic`, so `oracle_check` and `check_questions` always work.
- **Corporate proxy**: set `UV_SYSTEM_CERTS=1` before `uv sync` or downloads fail with a certificate error.
- **`search` uses an int `floor_level`**, while the new methods accept floor words. Either is fine in a tool;
  just say which in the docstring.
- **Swiss Dwellings**: `stacked_room` raises `MapError` because their floors do not share one coordinate frame,
  and `straight_line_3d` adds a `warning` across floors. No test question asks these for Swiss buildings;
  in the chat, let Claude relay the warning.
- **Big OSM buildings** have hundreds of rooms per floor. Truncate `rooms` lists in tool results or the
  context grows fast and costs money.

## 5. Optional safety net
The questions are generated from fixed templates, so a regex parser could extract floor, type, width, item
and the "Name (Floor n)" mentions without any LLM, and be verified against the 655 `inputs` on train and dev.
If you want it as a fallback for the test CSV or the Sunday run, ask the Core owner; it is deterministic work
and sits in `core/`.
