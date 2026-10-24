# UI server handoff — Team Simran

The local FastAPI server exposes the TEAM_PLAN.md §4.3 contract. From the repository root:

```bash
uv sync --frozen
uv run --frozen --env-file .env uvicorn agent.server:app --host 127.0.0.1 --port 8000
```

Use one worker: sessions and newly registered buildings live in process memory. Restarting resets them.
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
  Blank inputs return 422. Reuse a session ID to continue; a new ID starts fresh state.

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

Each `(building_id, session_id)` owns a fresh Core Building and chat history. Calls in the same
session are serialized; different sessions can proceed concurrently. Session IDs are opaque and
never used as file paths. The demo limits active sessions to 256 and returns 503 at capacity.
No authentication or durable session store is included in this local demo server.

Actions come from successful real tool calls in the current turn:

| Tool | Action |
| --- | --- |
| `find_route` | `route`: length, directions and geometry captured immediately for that route |
| `search_building` | `highlight`: returned space/asset IDs and the assets' containing spaces |
| `set_closed` | `closed`: the **complete current closed-ID set**, including an empty list after reopening |
| `add_door` | `door_added`: the actual new opening |
| configured `build_building` | `building_created`: validated and newly registered building ID |

The UI should replace its closure set and apply door edits locally. The raw building endpoint stays
unchanged by a session's closures/doors; these changes do not affect other sessions or source data.
No action is reconstructed by replaying a tool or reading model-written JSON. A later turn cannot
reuse an old turn's actions. Route geometry is captured before later tool calls can change `last_route`.

The server asks the chat model to use `Understood:` or `Clarification:` as the first response line;
it removes that marker and fills the corresponding response fields. Chat refinement remains step 11.
On failed turns, in-memory edits/history and pending catalog registrations are rolled back. Generated
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
- `POST /tts` is intentionally scheduled for step 12 with **ElevenLabs text-to-speech**. The UI already
  attempts that endpoint and falls back to browser speech. Microphone speech recognition is a separate UI feature.

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
