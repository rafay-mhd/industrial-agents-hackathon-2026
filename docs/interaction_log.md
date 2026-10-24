# Step 11 interaction evidence — Team Simran

Run date: 2026-10-24. Scope: TEAM_PLAN.md §5.2, step 11.

The CLI drives the actual FastAPI chat handler through ASGI, using live Claude calls and real Core
tools. It checks tool evidence and response fields, then we review the text. These are our regression
checks, not the organizers' official 25-point interaction score. Browser rendering and real Builder
generation were not exercised here.

## Scenarios and fixture adaptation

Source: Interface's `docs/tricky_users.md`, read from `origin/ui` at commit `938cfa9`.
Its example names are illustrative; the executable cases in `agent/interaction_cases.py` use rooms,
assets and connectors that actually exist in the supplied dev buildings. No expected answers or test
assertions are sent to Claude. No source building is edited on disk.

| Interface scenario | Real fixture and check |
| --- | --- |
| Ambiguous printer | `proc-campus-dev-000`: group printer locations, ask one question, set clarification flag; no arbitrary route |
| Missing room | `proc-factory-dev-003`: room 9.99 does not exist; explain and request one useful correction |
| Change destination | Factory: Warehouse zone H-C2 → CNC mill H-A1-A, then Kitchen 0.28 instead; preserve start and remove old destination |
| Remember wheelchair | Factory: route to Office 1.20, switch to Toilet 0.22 before moving, then explicitly report arrival and route onward; retain step-free constraint |
| Closed lift | Factory: close Office lift during the accessible route; do not invent an alternative or use stairs; reopen and route again |
| Coffee synonym | Factory: locate actual coffee amenities/kitchens without requiring a route start |
| Carrying a toolbox | Factory: Warehouse zone H-C2 → Server room 1.05; grounded human directions and lift option |
| Add a door | `osm-way27917482`: Corridor 02.06.001 (Floor 2) ↔ Corridor 2.402 (Floor 2); actual edit and measured route benefit |
| Multi-stop tour | Factory: Warehouse → Tool cabinet H-A2-A → CNC mill H-A1-A → Office 1.20; preserve order, report legs and whole route |
| Unique room on another floor | Factory: Office 1.20 area is 29.6 m²; no unnecessary floor clarification |

The first ten cases contain 15 turns. We added a two-turn nearest-restroom case: explicitly arrive at
Office 1.20 with a wheelchair, then ask for the nearest restroom without repeating that constraint.
The route to Toilet 1.32 is step-free and about 59.26 m; the reply correctly distinguishes a step-free
path from evidence that the toilet itself has wheelchair facilities.

For the location-memory script, we distinguish planning a trip from arriving. The user's actual arrival
must be stated before position advances; otherwise a changed destination keeps the confirmed start.

## Before and after

| Run | Checks passed | Findings |
| --- | --- | --- |
| Step 10 baseline | 12/15 | Printer question lacked clarification flag; destination replacement retained the old stop; tour left the UI on its final leg |
| First Step 11 revision | 15/15 | Mechanical checks passed; text review found redundant questions, failure to save some explicit starts, and an unsupported claim that two areas only connect outdoors |
| Final prompt and context revision | 17/17 | Original 15 checks plus two nearest-restroom turns pass; confirmed positions and mobility state checked against Core |
| Final live HTTP smoke | 2/2 | Updated route directions and geometry match Core; start and wheelchair constraint retained across a destination change |

The baseline tour did compute the correct full trip, but subsequent per-leg tool calls overwrote its
displayed route with the last leg. The chat route tool now computes leg details internally and restores
the full route before emitting the UI action. This fixes the display evidence without changing Core.

Manual review tightened one-question clarification, ordinary `from X to Y` as an explicit start,
location-only coffee answers, and statements about outdoor paths. The final replies describe the
chosen outdoor segment without claiming that all indoor connections are impossible. Memory is stored
explicitly, and a remembered step-free requirement is enforced at the chat tool boundary.

The live door edit returned a **0.9 m** opening. Core's before/after walking distances between the
edited corridors were **88.74 m → 33.5 m**, a **55.24 m** reduction. This is the benefit between those
two rooms, not an unsupported claim about all exits or a user's unprovided lobby.

The final real HTTP check used the same session for both requests:

1. “I use a wheelchair. Give me directions from Warehouse zone H-C2 to Office 1.20.”
   Returned the **151.1 m** step-free route using the Office lift.
2. “Actually, take me to Kitchen 0.28 instead.”
   Returned the **53.87 m** route from the original Warehouse start and retained step-free travel.

Both action payloads' lengths and floor geometry matched independently computed Core routes. Their
directions matched Core after removal of bracketed internal references. This presentation cleanup
was added after the 17-turn run and verified by its offline test and these two final HTTP requests.

## Reproduce and inspect

```bash
uv run --frozen --env-file .env python -m agent.interactions \
  --out agent_output/interactions/new_run.jsonl
uv run --frozen --env-file .env python -m agent.interactions \
  --cases change_destination wheelchair lift_closed tour nearest_accessible \
  --out agent_output/interactions/focused_new_run.jsonl
uv run --frozen python -m unittest discover -s agent/tests -q
uv run --frozen python -m core.oracle_check data/dev
```

The live CLI uses API credits and refuses to overwrite an existing output file. In a restricted
workspace, prefix commands with `MPLCONFIGDIR=/tmp/industrial-agents-matplotlib` and
`UV_CACHE_DIR=/tmp/industrial-agents-uv-cache`.

Local ignored evidence:

- `agent_output/interactions/step11_before.jsonl`: baseline, 15 turns.
- `agent_output/interactions/step11_after.jsonl`: first revision, 15 turns.
- `agent_output/interactions/step11_final.jsonl`: final prompt/context, 17 turns.
- `agent_output/interactions/step11_http_first.json` and `step11_http_second.json`: final HTTP replies.

Records contain actual calls/results, response fields, context and cumulative per-case token usage.
The runner now also records requested/actual response models and a prompt digest for future runs;
those metadata fields were added after the saved evaluation runs and are not backfilled. The configured
default is Sonnet; this exercise is not a verified model comparison. Chat fallback remains enabled.

Total live chat turns in this step: **49**. Exact account spending is not asserted. **56 offline tests
passed**, including eight new context/action tests. Required Core oracle: **138/138**. Benchmark prompt
and benchmark tools are unchanged; the full live benchmark is scheduled again for step 12.

## Remaining limits and handoff

- Passing these cases does not establish perfect behavior on unseen conversations. Automated checks
  cover selected facts, actions and flags; transcript review is still necessary for unsupported wording.
- The UI must clear a previously displayed route when processing a closure/door edit before applying
  any replacement route. The fetched UI keeps old geometry after a closure; server-side invalidation
  alone cannot clear an earlier browser display. See `agent/SERVER.md` for the Interface handoff.
- Our verified server is on port 8010; the teammate UI targets 8000. Joint browser verification,
  mock-fallback removal and real Builder integration remain pending.
- Step 12 adds ElevenLabs `/tts`, the next full dev evaluation, submission v2 and clean-clone rehearsal.
  Sunday's unknown release format/buildings must still be handled when supplied by the organizers.
