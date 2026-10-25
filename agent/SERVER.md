# UI server handoff — Team Simran

The local FastAPI server exposes the TEAM_PLAN.md §4.3 contract. From the repository root:

```bash
uv sync --frozen
uv run --frozen --env-file .env uvicorn agent.server:app --host 127.0.0.1 --port 8000
```

Use one worker. Conversation sessions and planned trips live in memory; imported buildings and confirmed building changes persist under the output directory. Restarting clears conversations, not saved doors and outages.
The fetched UI (`origin/ui` at `938cfa9`) targets `http://localhost:8000`; CORS allows
`http://localhost:5173`. The API docs are at `/docs`. The model uses the same Sonnet default and
optional `AGENT_MODEL` override as the benchmark agent. Credentials stay in the local ignored `.env`.

During verification, another process occupied port 8000. We left it running and tested this server
on port 8010. Point the UI at the same port as this server, or use 8000 when it is available. A full
browser-to-API run with the teammate UI is still pending; HTTP and Core integration were verified.

## Endpoints

- `GET /buildings`: metadata summaries `{id,name,source,floors:[{level,name}]}`. By default all 280
  supplied train/dev/test buildings are available, without reading question files or answer keys.
- `GET /buildings/{id}`: raw original building JSON for rendering. Unknown IDs return 404.
- `POST /buildings/{id}/chat`: `{session_id,message}` → `{reply,understood,needs_clarification,actions}`.
  Blank inputs return 422. Reuse a session ID to continue; a new ID starts fresh conversation and location state against the current shared building.
- `POST /buildings/{id}/transcribe`: multipart audio → editable transcript using ElevenLabs Scribe.
- `POST /tts`: `{text}` → ElevenLabs MP3 of the existing agent's reply.
- `GET /voice`: Agent-owned recording, transcript review, chat and spoken-reply page. See
  [VOICE.md](VOICE.md) for configuration, session sharing, limits and verification.

```bash
curl --fail http://127.0.0.1:8000/buildings/proc-factory-dev-003/chat \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"demo","message":"route from main entrance to the cnc mill"}'
```

This building has four entrances and none called "main entrance", so clarification is expected.
Continue with the same session:

```bash
curl --fail http://127.0.0.1:8000/buildings/proc-factory-dev-003/chat \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"demo","message":"Use the entrance into Warehouse zone H-C2 and CNC mill H-A1-A. I need a step-free route."}'
```

Verified: a 46.1 m route with complete ground-floor coordinates and Core's directions.

## State and actions

Each `(building_id, session_id)` owns chat history, a confirmed position, a planned trip and a
step-free preference. Its Core Building synchronizes with the current shared building revision. `remember_context` records explicit starts/arrivals and mobility needs;
planning a route does not move the user. Remembered step-free requirements are enforced by the
chat tool layer for routes, nearest amenities, errands, exit distances and reachability.
Calls in the same
session are serialized; different sessions can proceed concurrently. Session IDs are opaque and
never used as file paths. The demo limits active sessions to 256 and returns 503 at capacity.
No authentication or durable session store is included in this local demo server.

Actions come from successful real tool calls in the current turn:

| Tool | Action |
| --- | --- |
| `find_route` | `route`: length, human-readable directions and geometry captured immediately for the complete route |
| `search_building` | `highlight`: returned space/asset IDs and the assets' containing spaces |
| `set_closed` | `closed`: the **complete current closed-ID set**, including an empty list after reopening |
| `add_door` | `door_added`: the actual new opening |
| configured `build_building` | `building_created`: validated and newly registered building ID |

The UI replaces its closure set and applies `building_state` snapshots. Successful chat edits are
published to the shared catalog and saved atomically under `agent_output/sessions/changes/`.
Other sessions synchronize before answering; the UI checks revisions every five seconds. The
organizer's source files remain unchanged. An edit that races a newer revision returns 409 rather
than overwriting it; retry against the updated map.
No action is reconstructed by replaying a tool or reading model-written JSON. A later turn cannot
reuse an old turn's actions. Route geometry is captured before later tool calls can change `last_route`.
Multi-stop route results include Core-computed leg distances while retaining the complete route action.
Door edits return before/after walking distances between the edited rooms. A closure or door edit
invalidates earlier route actions in the same turn and clears the server's cached route. The UI must
also clear any previously displayed route on those actions; a subsequent `route` action supplies the
replacement. This matters when a closure leaves no accessible alternative.

The server asks the chat model to use `Understood:` or `Clarification:` as the first response line;
it removes that marker and fills the corresponding response fields. The chat prompt asks one necessary
clarification at a time and uses grounded names and directions. Internal references are retained for
tool calculations but stripped from the directions displayed by the UI.
On failed turns, in-memory edits/history/context and pending catalog registrations are rolled back. Generated
artifact files may remain locally, but the API does not serve those files. Provider rate limits return
429, other provider failures return 502, and unexpected failures return 500 with a generic message.
There is no automatic replay of state-changing chat requests.

## Builder connection

The fetched `origin/buildersim` branch has no Builder implementation yet. The real Builder connection
and an image-upload UI are pending teammate delivery. No pretend building tool is exposed by default.

When delivered, set `AGENT_BUILDER=package.module:build_building` to the callable with the agreed
signature `build_building(name, image_paths) -> {building_id,path,report}`. The server imports it
on startup and adds the tool only in chat mode. `path` can name a generated building directory or its
`building.json`; the returned ID must match the file, and existing IDs cannot be overwritten.
The server loads the result through Core and publishes it only after a successful chat turn.

Place approved plan images in `agent_output/uploads` (or configure `AGENT_UPLOAD_DIR`) and provide
their paths. The adapter accepts 1–20 existing PNG/JPEG/WebP files inside that directory; it rejects
other files and paths, including symlinks resolving outside it. It does not invent or discover images.
The handoff was tested with a controlled Builder fixture, not a real plan-generation model.

`AGENT_DATA_DIR` may point to one building directory, a split, or a root containing split directories.
It defaults to this checkout's `data`. Generated buildings are discoverable immediately after a
successful Builder call; restart persistence needs a configured data location containing their files.

## UI follow-ups

- The remote UI currently falls back to mock replies when a live request fails. For the real demo,
  show the actual error and a retry option rather than presenting a mock as a live result.
- The remote UI's action dispatcher handles route/highlight/closed/door actions, but does not yet handle
  `building_created`; it should refresh the building list and open the returned building when Builder lands.
- Clear a previous route when processing `closed` or `door_added`, then apply any later route action.
  The fetched UI currently keeps old route geometry after a closure; a blocked-lift answer must not
  leave the earlier lift route highlighted. No new action type is required.
- `POST /tts` now implements **ElevenLabs text-to-speech** using the existing request contract.
  The integrated main UI uses ElevenLabs realtime transcription and `/tts/stream`, with an explicitly
  labelled recording fallback. `/voice` retains the original upload/review flow. See VOICE.md.

## Verification

```bash
uv run --frozen python -m unittest discover -s agent/tests -v
uv run --frozen python -m core.oracle_check data/dev
```

The HTTP tests use real Core tools with controlled model responses. They cover request validation,
CORS, route/highlight actions, successive route snapshots, closures/reopening, door edits, rollback,
per-building/per-session isolation, concurrency, capacity, Builder registration and path restrictions.
Live HTTP checks exercise Claude → tools → response and compare route geometry directly with Core.
Responses are saved locally under ignored `agent_output/server/`.

Step 11 adds 17 live conversational regression turns, eight offline context/action tests, and a
two-turn real HTTP check of remembered start/accessibility. Reproduce the conversation checks with:

```bash
uv run --frozen --env-file .env python -m agent.interactions \
  --out agent_output/interactions/new_run.jsonl
```

This invokes the actual HTTP handler through ASGI with live Claude calls and spends API credits.
The output must be a new file. See [the interaction log](../docs/interaction_log.md) for before/after
results, fixture adaptation, manual review and limits. These are team checks, not an official score.


## Calibrated floor-plan imports

The API now provides `POST /buildings/import` (multipart `file` JSON), `POST /imports/preview` (multipart `files`, images/PDF), `GET /imports/{upload_id}/pages/{index}`, `POST /imports/build` and `GET /imports/status`.

Build accepts `{upload_id,name,floors:[{page,a,b,length_m,level,height_m,name,verified_step_free}]}`. `a` and `b` are normalized image coordinates marking the same physical reference on each floor. Plans are rasterized to at most 1600 pixels per side, limited to 20 MB/file and 12 pages. Scale is checked before model calls. Validated registrations persist under the app output directory; generated filenames and collision checks preserve existing buildings. Successful identical build requests are cached. Models carry `geometry_status:"draft"` and review warnings.

Import reachability uses Core's terminal entrance-door nodes rather than a shared `outside` graph node. Floor-plan extraction does not create missing entrances or unresolved shafts. Route map actions now include additive ordered `segments:[{floor_id,points}]`, alongside the existing `floors`, `steps`, and `length_m` fields, to preserve repeated visits to floors.


## Indoor directions and building updates

- `POST /buildings/{id}/route`: `{session_id,start,destination,via?:[],step_free?:false}`. Runs Core directly, with no model request. Remembers the planned trip without claiming that the user is physically at its start. Returns `{reply,actions}`.
- `DELETE /buildings/{id}/trip/{session_id}` clears the saved trip.
- `GET /buildings/{id}/changes` returns `{revision,closed,changes,warnings,unavailable_assets}`.
- `POST /buildings/{id}/changes`: `{session_id,kind:"closure",element_id,closed}` or `{session_id,kind:"door",first,second,step_free}`. Saves the change and recalculates the session's current trip. New doors require adjoining rooms on one floor; step-free status must be confirmed.
- `building_state`: `{type,building}` replaces the local snapshot and closure metadata. `route_unavailable`: `{type,reason}` clears any previous trail. A blocked accessible route never silently falls back to stairs.
- `route` retains the original fields and adds `start_space_id`, `destination_space_id`, `via_space_ids`, `step_free`, `geometry_valid`, optional `geometry_notice` and `distance_note`. Ordered segments may contain `exit_connector_id` to disambiguate parallel stairs/lifts.

The display path reconstructs Core's graph edges using an interior visibility graph. It bends around concave corners and passes through the mapped door landings. It refuses a walkthrough when the geometry cannot be verified, even if Core's scoring fallback supplies a distance. Core's official route costs remain unchanged: floor-transfer totals are walking-equivalent metres, including lift waiting or stair-climbing allowances. Furniture is not a routing obstacle under the challenge's route model.


## Live Warn: community reports and targeted route updates

- `POST /buildings/{id}/warnings`: `{session_id,element_id,kind,message,reporter?,blocks_route?,planned_trip?}`. Kinds: `lift_outage`, `blocked_access`, `hazard`, `equipment_outage`, `other`. Message is required (1–280 characters), public reporter name is optional (40 max). Lift outage targets normalize to the whole lift and always block routing; other reports can be advisory. Place IDs come from the loaded building, not a fixed demo.
- `POST /buildings/{id}/warnings/{warning_id}/resolve`: `{session_id,planned_trip?}`. Resolution is idempotent; an already-resolved report still returns the current building state and any needed route correction, without advancing the revision. Reports remain active until explicitly resolved; they do not silently expire and reopen equipment.
- `GET /buildings/{id}/events?since={revision}` streams SSE `building-update` events containing `{revision,closed}` with an event ID. Reconnects honor `Last-Event-ID`; the latest full state is fetched rather than replaying every event. Heartbeats keep connections alive.
- `POST /buildings/{id}/sync`: `{session_id,revision,planned_trip?}` checks the saved trip against the current building. Optional `planned_trip` uses the `/route` request shape and restores lost in-memory session state after restart. Warning mutations accept it too.
- Additive action `route_update`: `{changed,title,message,previous_length_m,new_length_m,warning_ids}`. Advisories on the route notify without replacing its geometry. Changed paths keep destination, ordered stops and step-free constraints; an impossible trip returns `route_unavailable`.
- `route.element_ids` identifies the actual rooms, openings and vertical connectors used. `building_state.preserve_route:true` leaves an unaffected trail intact; `geometry_changed:false` means only building metadata changed, allowing the client to retain its renderer and camera.

Active warning closures and manual/chat closures are separate layers. Resolving one report does not reopen another active report or a manual closure. Chat's `set_closed` tool reports when an active warning still blocks an attempted reopening. Reports, closures and revisions persist atomically with the building snapshot. Up to 100 active and 100 resolved reports are retained per building.

The frontend uses SSE with a five-second polling fallback, queues synchronization during agent requests, immediately withdraws a trail when a received closure intersects it, and preserves unaffected playback. A changed route pauses the animated walkthrough for review before replaying. Resolved reports leave active counts and map pins and remain in a separate history. Notifications appear inside the app; this is not background OS push or automatic equipment detection. Use one shared backend process for the hackathon: the current catalog/session locks are process-local, with file persistence, not a distributed multi-worker database. Community reports are not independently verified or authenticated staff approvals.


## Equipment searches and accessibility pulse

- `POST /buildings/{id}/accessibility`: `{start,step_free?:true,min_width_m?:null}`. Read-only Core reachability, returning revision, reachable/unreachable space IDs and counts by floor. Counts include rooms, corridors and landings. Effective closures, door widths, steps and actual newly added doors apply. The UI discards responses from a different revision. Mapped reachability is not accessibility certification.
- `/route` accepts `asset_query` for nearest-item intent; the frontend uses `destination:"nearest:<type>"` until resolved. `destination` and ordered `via` entries can be asset IDs or unambiguous asset names. Route actions retain `destination_asset_id`, `via_place_ids` and `asset_query`; synchronized or restored sessions preserve those identities. Nearest means Core walking distance to the containing room, not straight-line proximity, and includes the starting room. Room/asset existence comes from the uploaded map.
- Nearest-item intent is stored before evaluating availability. No reachable/available match produces a `route_unavailable` action while retaining the query, stops and accessibility setting. This also lets a fresh/restored session post or resolve a warning while every matching item is unavailable, and recover its route after resolution.
- `equipment_outage` on an asset adds `asset_unavailable:true`, not a room closure. Nearest searches omit unavailable assets; an explicit trip to that asset or via it becomes unavailable. A nearest-item trip can choose another matching reachable item automatically. Every unresolved outage for an item must be resolved before it returns to the available search pool. No report is not proof of operation. Unknown equipment can be described against a room, but only mapped assets can be excluded individually.
- Warning pins can use asset coordinates. Revision SSE data includes `unavailable_assets`. Equipment faults only affect relevant trips, while a room's through-route stays usable. `blocks_route` defaults to false; lift outages always block the shaft. Wet stairs can remain a caution; genuinely impassable passages must be reported as blocking.
- Chat-only tools `report_warning` and `building_warnings` use the same shared reports as the UI. A successful report returns the active trip's automatic update for a consistent spoken/text response. The benchmark prompt and official Core routing/scoring remain unchanged.

The existing `what_if_door` tool performs a hypothetical calculation without adding a real door. `add_door` and the map-change UI persist an actual mapped door. A dedicated hypothetical before/after visual editor has not been added.
