# Test log

One entry per test run, newest first. Every entry names the commit it was run on, the exact commands, the
numbers, and every miss with its cause. Add an entry whenever Core, Agent prompts or tools change, and after
each dev run before a new submission CSV.

## 2026-10-25 — merge current work and teammate zoom update before voice verification

Combined local `01f7a9b` (adaptive navigation, accessibility/equipment reports, warning UI and resolution fixes) with remote `c3912a2` (smoother 2D/3D zoom; optional look switches off). Automatic merge preserved both sides.

Commands: `npm --prefix ui run build`, `npm --prefix ui run lint`, `npm --prefix ui test`; `MPLCONFIGDIR=/private/tmp/inside-mpl uv run --frozen --cache-dir /private/tmp/inside-uv-cache python -m core.oracle_check data/dev`; the same UV prefix with `--env-file .env python -m agent.benchmark data/dev/proc-factory-dev-003 data/dev/proc-factory-dev-003/questions.jsonl --no-kind-hints --model claude-sonnet-5-5 --out agent_output/verification_20261025/pre_voice_merge/factory.csv`; `git diff --check`.

Build/lint, **84 UI tests**, Core dev **138/138**, and the required live factory check **5/5** passed on the combined tree. Existing lazy Three.js chunk warning remains. No keys or generated verification artifacts are included in Git. Voice verification follows the user's requested initial push.

## 2026-10-25 — resolve unavailable equipment and retain resolved history

Working tree based on `main` at `5b3b8a5`, preserving the earlier uncommitted changes. Deterministic route-intent restoration and warning resolution changed; no model prompt, official scoring, Core, starter or source-data edits in this step.

Commands: `MPLCONFIGDIR=/private/tmp/inside-mpl uv run --frozen --cache-dir /private/tmp/inside-uv-cache python -m unittest agent.tests.test_accessibility_equipment agent.tests.test_live_warnings`; the same Python prefix with `-m unittest discover -s agent/tests` and `-m core.oracle_check data/dev`; `npm --prefix ui run build`, `npm --prefix ui run lint`, `npm --prefix ui test`, `git diff --check`.

- Root cause confirmed from Edge and server logs: an unavailable nearest-coffee query caused HTTP **422** before the resolve handler could change the report. Trip restoration performed availability lookup too early. Nearest intent now survives an unavailable result and is recalculated after the warning update. An already-resolved response now includes shared state and any stale route correction.
- **119 backend tests**, **84 UI tests** (58 Node + 26 Vitest), build/lint and Core dev oracle **138/138** pass. Three backend regression tests failed on the old implementation and pass after the fix: all matching equipment unavailable, report/sync with blocked nearest intent, and repeated resolution by a stale viewer. Coverage includes fresh sessions, other viewers, preserved stops/step-free constraints, persistence, independent outages/closures and idempotency. UI regressions cover pending/duplicate clicks, retryable failures, resolved history and removal of resolved pins. An initial new UI assertion used the wrong helper name; corrected to `warningPins` and the complete UI suite passes. Existing lazy Three.js chunk-size warning remains.
- Live native Edge on imported `pulse-equipment-house-20261025`: both coffee machines unavailable → nearest-coffee request shows an unavailable result → **Mark resolved** on the temporary studio outage succeeds → **16.9 m** route appears, warning count **3 → 2**, studio warning pin disappears, and **Resolved issues** shows the report as **Resolved just now**. An independent HTTP viewer also receives the recovered route with its step-free preference preserved. Repeating resolution returns state without another revision. The original corner-machine outage and wet-stairs caution stay active; only the temporary report was resolved. Runtime evidence is under ignored `agent_output/verification_20261025/resolve_issue/`. Updated backend is running on port 8012. No paid model/speech calls were needed.

## 2026-10-25 — readable shared warnings and clear report validation

Working tree based on `main` at `5b3b8a5`; earlier uncommitted features preserved. UI-only fix; no backend, model, Core, scorer or source-data changes in this step.

Commands: `npm --prefix ui run build`, `npm --prefix ui run lint`, `npm --prefix ui test`, `git diff --check`. Local HTTP verification used `MPLCONFIGDIR=/private/tmp/inside-mpl uv run --frozen --cache-dir /private/tmp/inside-uv-cache python` with separate HTTP clients against the synthetic building's warnings, changes and sync endpoints. Verification IDs/results are under ignored `agent_output/verification_20261025/warning_panel/`.

- Build, lint and **82 UI tests** pass (58 Node + 24 Vitest). Four new React tests cover reading while busy/offline, missing-location validation and the valid submission payload, incoming shared reports while preserving a draft, and retrying a failed report without losing its fields. Existing lazy Three.js chunk-size warning remains.
- Root cause observed in Edge: **Post live warning** was disabled because the report's **Where exactly?** field was still unselected. Missing fields now produce visible guidance and native validation instead of a disabled submit button. Reading reports does not depend on posting or an active voice session. The sidebar reader opens from a persistent map-toolbar button, including in 3D; reports precede the form. Writes and feed requests have a 20-second timeout.
- Native Edge in a separate synthetic-building tab: the toolbar opened the report reader with an independently posted **Another visitor** report. A second HTTP session posted a **Second visitor** report while that page was open; without refresh, the count changed **3 → 4** and its message/map pin appeared. An empty report form displayed an enabled **Post live warning** button and field guidance. Both temporary synthetic reports were resolved by API and verified inactive; the original two fixture reports were preserved. No user draft was submitted or assigned an invented location.

## 2026-10-25 — restore animated walkthrough and clear on-screen directions

Working tree based on `main` at `5b3b8a5`; all unrelated prior changes preserved. UI-only change requested by the user: remove the physical-walking/location flow and restore the video-style route demonstration.

Commands: `npm --prefix ui run build`, `npm --prefix ui run lint`, `npm --prefix ui test`, `git diff --check`.

- Build, lint and **78 UI tests** pass (58 Node + 20 Vitest). Removed the laptop diagnostic component and its three tests; added corner/arrival regression coverage and updated the provider/component test for the restored autoplay behavior. Existing lazy Three.js chunk-size warning remains.
- First-person selection starts the animated route. Play/pause, replay, speed and progress stay visible; directions now remain specific in both 2D and 3D rather than being replaced by a generic playing status. Larger arrows, metre counts, “Turn now” and U-turn cues; incomplete geometry does not falsely claim arrival. Written directions open by default. No product motion/geolocation hooks mount or request permissions.
- Native Edge on the existing synthetic fixture: Reception → Studio displays a left-turn arrow and 7 m instruction before playback. First person starts playback, advances the camera/footprints and decreases the remaining distance; arrival reaches 0 m. Replay starts again; Pause freezes at 7% with “In 5 m, turn left” and 16 m remaining. Screenshot reviewed for legibility. Phone calibration and laptop-location panels absent. No source dataset, backend, agent or official scorer changes in this step.

## 2026-10-25 — laptop location capability diagnosis

Working tree based on `main` at `5b3b8a5`, preserving the previous uncommitted features. UI-only addition; backend/Core/agent unchanged in this step.

Commands: `npm --prefix ui run build`, `npm --prefix ui run lint`, `npm --prefix ui test`, `git diff --check`.

- Build/lint and **80 UI tests** (57 Node + 23 Vitest) pass. Existing Three.js chunk warning remains. New tests cover explicit location permission trigger, coarse location jitter, reported precision vs actual positioning, permission denial, timeout, stop/unmount cleanup, and late callbacks.
- Native Edge on the imported synthetic building: route and new laptop accuracy panel render correctly; phone sensor mode now says **Phone walking**. The actual location request could not be completed by automation because the user changed the browser during both click attempts; no measured device accuracy is claimed. User can invoke **Check laptop location** in that panel.
- This is a capability diagnostic, not completed laptop walk tracking. No camera, background tracking, location upload, fake movement or absolute indoor-position claim. Original request for actual laptop movement still needs a usable positioning source.

## 2026-10-25 — equipment-aware trips, accessibility pulse and live-walk startup

Baseline: `main` at `5b3b8a5`, merged and pushed before these new working-tree changes. The earlier push includes the teammate's circulation models.

Commands: `npm --prefix ui run build`, `npm --prefix ui run lint`, `npm --prefix ui test`; `MPLCONFIGDIR=/private/tmp/inside-mpl uv run --frozen --cache-dir /private/tmp/inside-uv-cache python -m unittest discover -s agent/tests`; the same Python prefix with `-m core.oracle_check data/dev`; `MPLCONFIGDIR=/private/tmp/inside-mpl uv run --frozen --cache-dir /private/tmp/inside-uv-cache --env-file .env python -m agent.benchmark data/dev/proc-factory-dev-003 data/dev/proc-factory-dev-003/questions.jsonl --no-kind-hints --model claude-sonnet-5-5 --out agent_output/verification_20261025/pulse_equipment/factory_final.csv`; `git diff --check`.

- **116 backend tests**, **77 UI tests** (57 Node + 20 Vitest), build and lint pass. Core dev oracle **138/138**; final live Claude benchmark **5/5**. Existing lazy Three.js chunk-size warning remains. No source data, starter or scorer edits.
- Regression coverage: equipment outages vs room closures; asset names/IDs and ordered stops; nearest-item rerouting and all-items-unavailable; explicit asset destinations; duplicate report resolution; cautions vs blocked passages; chat transaction publication; lift/width/door effects on pulse; stale and mismatched pulse responses; walking time vs floor-transfer allowance; first-person selection without autoplay; step/heading sensor updates and no progress from animation ticks during a live walk.
- Imported a separate synthetic two-floor `pulse-equipment-house-20261025` with two coffee machines, one 3D printer, stairs, lift and a disconnected room. Real HTTP/SSE checks saw pulse **9 → 5 → 9** reachable spaces when the lift failed and reopened. SSE carried unavailable asset IDs. An unrelated coffee trip was preserved. Only synthetic imported data was edited.
- Real Claude conversation found the nearest coffee machine, posted its outage and moved the saved nearest-item trip to the other machine without closing the room; accepted a wet-stairs caution; located the 3D printer. An all-machines-unavailable test exposed a generic error rewrite that incorrectly claimed the room route was missing. Fixed that distinction and reran the live check: the reply now says equipment is unavailable and the room stays open; a direct room route still succeeds. Evidence: `live_chat.json`, `live_final.json` (initial finding), `live_final_corrected.json`, and benchmark diagnostics in the ignored output directory above.
- Native Edge browser: closest-coffee destination search (including “coffe” typo), step-free 3D-printer route, walking time/ETA, first-person calibration without autoplay, 2D reachability labels and 3D green floors. Submitted a printer-jam report through the actual free-text form: only that asset became unavailable, the affected trail cleared, and resolving it restored the route. An unrelated report left first-person on. Temporary printer/lift/general notices resolved; demo retains a coffee outage and wet-stairs caution.
- Limits: browser motion tests use sensor events, not a physical walk. Phone tracking remains calibrated dead reckoning with drift/off-route stops and floor confirmation, requiring a supported secure phone browser and an on-site accuracy check. ETA is an estimate. Existing hypothetical-door Core/chat functionality is unchanged; no dedicated hypothetical visual editor was built. ElevenLabs was not called again because speech-credit testing was deferred. Single-process/unverified community-report limitations still apply.

## 2026-10-25 — Live Warn, targeted rerouting and cross-user notifications

Baseline: `main` at `24a4144`, with prior uncommitted changes preserved; this run is on the working tree.

Commands: `npm --prefix ui run build`, `npm --prefix ui run lint`, `npm --prefix ui run test`; `MPLCONFIGDIR=/private/tmp/inside-mpl uv run --frozen --cache-dir /private/tmp/inside-uv-cache python -m unittest discover -s agent/tests`; the same Python prefix with `-m core.oracle_check data/dev`; `MPLCONFIGDIR=/private/tmp/inside-mpl uv run --frozen --cache-dir /private/tmp/inside-uv-cache --env-file .env python -m agent.benchmark data/dev/proc-factory-dev-003 data/dev/proc-factory-dev-003/questions.jsonl --no-kind-hints --model claude-sonnet-5-5 --out agent_output/verification_20261025/live_warn/factory.csv`; `git diff --check`.

- **104 backend tests**, **71 UI tests** (55 Node + 16 Vitest), build and lint pass. Core dev oracle **138/138**. Live Claude factory benchmark **5/5**; diagnostics saved under `agent_output/verification_20261025/live_warn/`. Existing lazy Three.js bundle-size warning remains; no source dataset, starter agent or scorer edits.
- Regression coverage: impacted versus unrelated trips; cautions without rerouting; step-free no-alternative behavior and restoration; independent manual/report closure layers; duplicate reports; restart persistence and lost session recovery; invalid input; failed persistence rollback; ordered stops; new-door geometry sync; SSE revision resume; event coalescing while busy; obsolete responses; polling fallback; unaffected playback progress/camera; avoiding duplicate mutation notifications.
- Native Edge, two independent browser tabs on imported synthetic `live-warn-house-20261025`: Reception → upper lift landing initially uses the lift; another visitor posts an outage through the real form; first tab automatically receives the adapted stairs route and **See what changed** shows dashed red previous geometry beside the current footprint trail. Pins and the report feed show the actual lift target and entered message. Step-free Reception → Upper studio correctly reports no available route; resolving the warning restores the lift route. Test warning was resolved at the end. All organizer buildings remained unmodified.
- Visual review moved the notification inside the map so it does not cover view controls. Browser testing exposed a duplicate sync response replacing the main route-change notice; synchronous revision acknowledgement now suppresses it, with a dedicated passing regression test.
- Real HTTP SSE probe confirmed `text/event-stream`, event ID 2, `building-update` and `{revision:2,closed:[]}` after resolution; evidence in `sse_check.json`. No repeated full geometry transfer while revisions are unchanged.
- Limits: shared single-process backend; in-app notifications, not OS push; community reports are unverified and do not expire automatically. Phone motion accuracy was not retested and requires real-device verification. No live ElevenLabs calls were retried because the user deferred them after speech credits ran out.

## 2026-10-25 — map-first planner, verified walkthroughs and shared updates

Baseline: `main` at `24a4144` with the previous uncommitted upgrades preserved.

Commands: `npm --prefix ui run build`, `npm --prefix ui run lint`, `npm --prefix ui run test`; `MPLCONFIGDIR=/private/tmp/inside-mpl uv run --frozen --cache-dir /private/tmp/inside-uv-cache python -m unittest discover -s agent/tests`; the same Python prefix with `-m core.oracle_check data/dev`; the BENCHMARK.md factory command with `--no-kind-hints --model claude-sonnet-5-5 --out agent_output/verification_20261025/maps/factory.csv` and the local `.env`; `git diff --check`.

- **91 backend tests**, **62 UI tests** (52 Node + 10 Vitest), build and lint pass. The existing lazy Three.js bundle warning remains.
- Official Core dev checks: **138/138**. Live Claude factory benchmark: **5/5**. No scorer, starter agent or supplied building data changed.
- New geometry tests cover a concave hallway, boundaries crossed only at real doorways, invalid doorway coordinates, repeated floors and explicit connectors. Camera position no longer interpolates through corners; floor transfers do not simulate passage through slabs. Unverified geometry blocks walkthroughs. Sensor drift is map-matched and stops on excessive deviation.
- The fresh two-floor **Corner House** fixture passes the import validator and exercises an initially disconnected store, a lift, stairs and a bent corridor. HTTP tests verify shared closure/reopening, step-free no-route behavior, restart persistence, mid-wall door placement, automatic rerouting, preserved multi-stop order, source-file immutability and stale-revision rejection.
- Edge browser checks: Start/Destination search → step-free route; full-route preview remains paused until explicitly started; eye-level doorway navigation; a lift transition screen with **Show the next floor**; closing East lift withdraws the inaccessible route; adding a door Reception → New store creates an immediate **4 m** route. Voice and chat remain in **Ask Inside**.
- Live Claude update check: a previously blocked accessible trip was restored by asking the agent to reopen East lift. It returned `closed`, a verified step-free `route`, and `building_state`; shared closures became empty. A discovered explanation issue (walking step lengths omit lift waiting allowance) was addressed in chat instructions and route metadata; a follow-up live response correctly explained the allowance. Core totals were preserved.
- ElevenLabs live streaming remains deferred at the user's request because that workspace has zero credits. No new live speech or physical-phone-accuracy claim is made.

Evidence: `agent_output/verification_20261025/maps/` contains the fixture, official factory results and live-agent responses. These files are ignored local verification artifacts.

## 2026-10-25 — first-person walking, calibrated imports and streaming transport

Baseline: `main` at `24a4144`, with the previous integrated-verification and shader changes preserved. This entry describes the uncommitted upgrade; it does not replace the earlier physical-microphone result.

Commands/checks:

```text
npm --prefix ui run build
npm --prefix ui run lint
npm --prefix ui test
MPLCONFIGDIR=/private/tmp/inside-mpl uv run --frozen --cache-dir /private/tmp/inside-uv-cache python -m unittest discover -s agent/tests
MPLCONFIGDIR=/private/tmp/inside-mpl uv run --frozen --cache-dir /private/tmp/inside-uv-cache python -m core.oracle_check data/dev
git diff --check
```

Results:

- Backend: **80/80** tests. UI: **60/60** (50 Node geometry/navigation tests, 8 voice tests, 2 motion-hook tests). Build, lint and whitespace checks pass. The existing lazy Three.js chunk size warning remains.
- Official dev reference checks through Core: **138/138**. The previous full Claude dev run remains 138/138; it was not repeated solely for additive UI route fields.
- Live PNG extraction: a newly drawn five-room plan, with a known 12 m width, recovered **5 named rooms and 5 openings**. Polygon IoU against the independent drawing is **0.9016–0.9312**. This is a draft-geometry check, not proof of arbitrary-plan accuracy. The source drawing, PDF, expected geometry and outputs are under `agent_output/verification_20261025/upgrade/`.
- Browser PDF workflow: file selection → raster preview → two-point calibration → extraction → persistent catalog registration → live agent selection all passed. Generated `fresh-copper-plan` (`plan-92bf9964e7b6`) routes Copper reception → Ivory hall → Cobalt studio, step-free, **7.54 m** in Core and **7.5 m** in the UI.
- Browser navigation: first-person camera, expanded map, visible floor footprints, pause/replay and hidden model-editing overlays inspected. Selecting Jade store → **I’m here** replanned the active trip from Jade store to the same Cobalt studio destination, retained step-free routing, and displayed **9.3 m**. Desktop calibration correctly times out with “No usable phone sensor data” and never reports a live walk. Physical phone motion/heading accuracy is **not tested**; HTTPS and a real device remain necessary.
- Motion regressions cover stationary-noise rejection, step release/debounce, off-route estimates, live progress immunity to animation timers, turns, repeated floors, explicit floor-transfer confirmation, both-sensor initialization, heading-only updates without position movement, permission denial and sensor loss.
- Streaming regressions cover playback before EOF, PCM samples split across chunks, cancellation of scheduled audio/network reads, single-use token scope, building isolation, and quota-error mapping. The **live upgraded ElevenLabs path is blocked**: the provider returned HTTP 401 `quota_exceeded`, **0 credits remaining**. The user explicitly requested finishing other checks for now. No successful live streaming result is claimed.
- Integration fixes found during testing: the configured Claude model rejects forced tool choice, so extraction uses auto tool choice with validated tool output; Core entrances are terminal door nodes, so import reachability uses `exit_distances`; floor transfers clamp estimated progress before entering a connector; zero-credit speech failures now return a clear 429 instead of misleading key-permission errors.

Evidence: `agent_output/verification_20261025/upgrade/verification.json`, `building.json`, `pdf-building.json`, `fresh-copper-plan.png`, `fresh-copper-plan.pdf`. No organizer data, starter agent, benchmark files or submission CSV were changed by this upgrade.

## 2026-10-25 — integrated frontend, voice and unfamiliar-building verification

Baseline: `main` at `24a4144`, with the local beige flow-field UI changes. Fetched `origin/main`
at `ef6a800`: its additional changes are circulation GLBs/aliases only; no newer backend implementation.
Before this run, the agent, voice, server, tools, context and prompts matched `origin/agent` exactly.
Results below include the local route-state and chat-prompt fixes described here; they are not a claim
that the unmodified baseline passed the new regression checks.

Commands (Python runs used `uv run --frozen --cache-dir /private/tmp/inside-uv-cache`; live runs also
used `--env-file .env`, with model `claude-sonnet-5-5`):

```bash
npm --prefix ui test
npm --prefix ui run build
npm --prefix ui run lint
python -m unittest discover -s agent/tests -v
python -m core.oracle_check data/train
python -m core.oracle_check data/dev
python -m core.oracle_check data/train --warmup
python -m core.oracle_check data/dev --warmup
python -m core.check_questions data/test data/test/questions.csv
python -m agent.benchmark data/dev data/dev --no-kind-hints --model claude-sonnet-5-5 --out agent_output/verification_20261025/dev.csv
python -m agent.report agent_output/verification_20261025/dev.jsonl
python tests/live_ambiguity.py data/train data/dev --out agent_output/verification_20261025/ambiguity.jsonl
python tests/live_no_route.py data/train data/dev --out agent_output/verification_20261025/no_route.jsonl
```

Results:

- Frontend: **43 Node tests + 6 voice-hook tests passed**; TypeScript/production build and lint passed.
  Existing Three.js bundle-size warning remains. The suite checks that all 280 source buildings import
  without losing data or metadata.
- Backend: **69/69 baseline tests passed**. Stronger multi-stop geometry coverage plus a new failed-turn
  regression exposed two bugs despite the old suite being green. After fixes: **70/70 passed**.
  Prompt/context checks were rerun after the final prompt change: **12/12 passed**.
- Core vs supplied reference answers: train **517/517**, dev **138/138**; warm-up train **1,761/1,761**,
  dev **369/369** — **2,785/2,785 total**. These are deterministic Core checks, not LLM runs.
- Live dev benchmark, using the organizers' `benchmark.score.score_reply`: **138/138 answers and
  138/138 parameter extractions correct**, zero errors. Per-kind: errand 19, floor area 31, largest room
  20, stacked room 9, shared walls 24, step-free reachability 1, 3D distance 13, what-if door 2, wide delivery 19.
  Recorded tokens: input 91,154; output 14,746; cached read 1,888,747; cached creation 519,283.
  Token counts are not an invoice or a guarantee on unseen inputs.
- Test split: all references in **145 questions across 38 buildings resolve**. This is a reference check;
  hidden test answers were not available for accuracy grading. Submission files were not changed.
- Live ambiguity: **19/19 ask instead of guessing**, both before and after the prompt adjustment.
- Live no-route cases: **231/233 explicitly said no route; zero invented routes and zero API errors**.
  `swiss-1457-Q07` and `swiss-148-Q07` offered alternatives without directly answering the requested
  step-free trip. The chat prompt now requires the no-route answer before alternatives. Each affected
  case passed **three independent retries (6/6)**. The entire 233-case suite was not rerun after that
  wording-only change; the 19-case ambiguity suite was rerun and remained perfect.

Fixes: multi-stop leg-distance calculations now preserve the complete route point list, so the UI gets
all legs rather than only the final one. HTTP failure rollback also restores route points along with the
route result. Door-impact comparisons preserve the same paired state. The two new/strengthened regression
checks failed on the baseline (one failure, one error) and passed after these fixes.

End-to-end checks:

- Both `http://127.0.0.1:8012/api` and the Vite proxy at `http://localhost:5174/api` return the 280-building
  catalog, configured voice status and real GLBs. A six-floor non-demo building, `proc-campus-dev-009`,
  returns all **207 spaces** exactly matching its source JSON.
- Authored **Amber House**, a genuinely new synthetic schema fixture: 2 floors, 10 spaces, arbitrary
  floor IDs, negative x coordinates, a 4 m stair/lift rise, 100 m² per floor, one source-aligned entrance
  and an 8 m structural height. Core validation has zero errors/warnings; frontend parsing preserves
  its data, envelope and connectors. It is registered only on an isolated verification server at port
  8013; the supplied dataset is untouched.
- Actual ElevenLabs TTS generated the question “Take me from Amber reception to Cobalt studio without
  stairs.” Actual STT returned that exact text; the same Claude/Core agent returned **41.2 m**, with
  route geometry matching Core; ElevenLabs produced **455,200 bytes** of reply audio. Timing: STT 0.58 s,
  agent 5.66 s, TTS 4.06 s — **10.30 s excluding recording and network/UI overhead**.
- Closing the lift in that session correctly prevents the step-free route. Reopening it and requesting
  Archive → Amber reception → Jade laboratory returns the complete **56.8 m** multi-stop geometry.
- Browser checks on port 8013: selected Amber House; inspected its 3D exterior, 2D room map and agent
  response; replayed the route and observed progress from Entry level to arrival at Upper level.
  This is a simulated route preview, not real indoor position tracking.
- Loaded `data/dev/resplan-14509/floor_0.png` through the photo chooser. It correctly remains a preview.
  Imported the corresponding `building.json` through the actual UI file chooser: all **6 spaces** and
  the entrance appeared in 2D/3D; the map matched the source floor plan, including the detached bathroom.
  Local import correctly disables chat/voice until server registration.

Remaining boundaries: no Builder implementation/configuration is connected, so a new photo/PDF cannot
currently generate verified building JSON. File import does not automatically register buildings with the
agent. The voice hook automatically cycles listening/transcribing/answer/playback, but it is turn-based,
not simultaneous streaming audio. The user subsequently confirmed the physical microphone test on Amber
House at port 8013: “It hears me and speaks back.” This completes manual microphone and spoken-reply
acceptance alongside the automated provider-chain checks. Roofs/facades/furnishings are illustrative, not recovered
architectural details. Per-floor route polylines still cannot represent every interleaving in tours that
revisit a floor; the UI already labels that limitation.

Evidence (local, ignored): `agent_output/verification_20261025/` contains benchmark traces, ambiguity and
no-route results, six no-route retries, `http-and-voice.json`, `geometry.json`, MP3s and the fresh fixture.

## How to add an entry

```bash
# free, seconds: the maths against the dataset's own parameters
uv run python -m core.oracle_check data/train
uv run python -m core.oracle_check data/dev
uv run python -m core.oracle_check data/dev --warmup
# does every name in a question file resolve? (run on the Sunday building first)
uv run python -m core.check_questions data/test data/test/questions.csv
# ambiguity behaviour (chat mode): does the agent ask which room when a name exists several times? (~19 questions, cents)
uv run --frozen --env-file .env python tests/live_ambiguity.py data/train data/dev --out agent_output/livetest/ambiguity.jsonl
# no-route behaviour (chat mode): on every warm-up question whose answer is 'no route', does the agent say so? (233 questions, ~$4)
uv run --frozen --env-file .env python tests/live_no_route.py data/train data/dev --out agent_output/livetest/no_route.jsonl
# live, costs credits: Claude reads the sentence, picks the tool, core computes
uv run --frozen --env-file .env python -m agent.benchmark data/dev data/dev --no-kind-hints --model claude-sonnet-5-5 --out agent_output/benchmark/dev.csv
uv run --frozen python -m agent.report agent_output/benchmark/dev.jsonl
```
Record: date, commit, model, per-kind answers and extraction, misses with cause, tokens or cost, runtime.
"Extraction" = the rooms, floors, types and widths Claude passed to the tool matched the dataset's hidden
`inputs`. Raw logs stay under `agent_output/` (ignored by git); only the summary goes here.

---

## 2026-10-24 — behaviour tests on kit 1.1.0: ambiguity rerun and "no route"

**Commit**: `bfe4d0d` core, chat prompt unchanged. **Model**: `claude-sonnet-5-5`, chat mode. **Run by**: Core owner.

**Ambiguity rerun** (`tests/live_ambiguity.py`, 19 questions whose room name exists several times on the floor):
18 asked which room was meant, 1 resolved it without asking (both candidates give the same count), 0 guessed.
Identical to the run on 1.0.0, as expected: neither the prompt nor the name resolver changed. Cost ≈ $0.40.

**No-route test** (`tests/live_no_route.py`, new): every warm-up question whose correct answer is "there is no route".
Kit 1.1.0 raised their number from 121 to 233, because entrances no longer connect wings of a building:

| Kind               | Questions | "No route" before 1.1.0 | "No route" now |
|--------------------|-----------|-------------------------|----------------|
| route              | 720       | 0                       | 60             |
| route_step_free    | 240       | 63                      | 72             |
| route_with_closure | 138       | 58                      | 69             |
| tour               | 240       | 0                       | 32             |
| Total              | 1,338     | 121                     | 233            |

All 233 went through the chat agent: **233 said there is no route, 0 invented one**, 0 errors. Replies name the
reason where the data gives one ("the Main staircase is the only connection between the floors", "nothing is closed,
the map's connections just don't link these rooms"). Cost ≈ $4, 4 workers, about 6 minutes.

---

## 2026-10-24 — live rerun on kit 1.1.0 and test submission v2

**Commit**: `bfe4d0d` core + Agent layer unchanged. **Model**: `claude-sonnet-5-5`, benchmark prompt, `--no-kind-hints`, 4 workers. **Run by**: Core owner.

| Set                                    | Answers                    | Extraction | Time  | Approx. cost |
|----------------------------------------|----------------------------|------------|-------|--------------|
| Dev benchmark, all 138                 | 138 / 138                  | 138 / 138  | 3 min | $2           |
| Test, all 145 (no answers, submission) | 145 rows, 145 Answer lines |            | 3 min | $2           |

Every dev kind at 100%, one tool call per question, no retries. `submissions/team_simran_v2.csv` validated: all 145 ids,
no row without an Answer line, exactly one number on numeric kinds, no `m2`. Compared with v1, exactly the lines the
rule change affects differ: all 20 errand answers and 1 of the 3 what-if answers (the other two happen to be unchanged).
The 87 geometry answers are identical to v1. **v2 is the file to submit; v1 is kept only for the record.**

---

## 2026-10-24 — kit 1.1.0: corrected route rules, core rebuilt, oracle back at 100%

**Commit**: `f154c95` (merge of the organizers' 1.1.0) + `bfe4d0d` (core routing rewrite). **Run by**: Core owner.

The organizers recomputed 1,314 train/dev answers under their real route rules (see `CHANGELOG.md`): door-to-door
walking, stairs 2 m per metre climbed, lift 15 m + 1 m per metre, no way round the outside. Before the rewrite our
core scored 448/517 train and 120/138 dev on the new answers (errand and what-if wrong, all geometry kinds still
100%) and 22/229 on dev warm-up routes. After rebuilding the routing on the starter's new walking model:

| Set                                   | Questions | Correct  | Time   |
|---------------------------------------|-----------|----------|--------|
| Train benchmark, 9 kinds              | 517       | 517      | 7.5 s  |
| Dev benchmark, 9 kinds                | 138       | 138      | 10.7 s |
| Train warm-up (locate, count, routes) | 1,761     | 1,761    | 8.1 s  |
| Dev warm-up, incl. 112 "no route"     | 369       | 369      | 10.6 s |
| Agent owner's test suite              | 56 tests  | all pass |        |

New in the core: `route_summary()` (ordered spaces, as the judges score routes), `route(forklift=True)`
(openings ≥ 3 m, bays never crossed), `exit_distances()`; walking lengths shared between instances of a
building. Every route-related live figure in the entries below was measured against the 1.0.0 answers and is
historical; the live rerun on 1.1.0 and the test CSV v2 follow in the next entry.

---

## 2026-10-24 — ambiguity behaviour test, chat mode, all ambiguous train + dev questions

**Commit**: `ceeeee2` + `tests/live_ambiguity.py`. **Model**: `claude-sonnet-5-5`, chat prompt. **Run by**: Core owner.

Step 1 (free) scanned every train, dev and test question for a 'Room (Floor n)' mention that the core's resolver
reports as ambiguous (several rooms with that name on that floor). Found 19: 18 in train, 1 in dev, **0 in test**.
All 19 are in the OSM buildings `osm-way37850565` (rooms named "Büro"), `osm-way58216509` (duplicate labels such as
"Generic room N2146") and `osm-way27917482` ("Generic room 03.08.033" three times). Step 2 sent those 19 to the
chat agent. Success = the reply asks which room is meant and does not commit to a route or answer.

| Kind               | Asked | Resolved without asking | Guessed | Total |
|--------------------|-------|-------------------------|---------|-------|
| route              | 5     | 0                       | 0       | 5     |
| room_stacked       | 2     | 0                       | 0       | 2     |
| route_step_free    | 2     | 0                       | 0       | 2     |
| route_with_closure | 3     | 0                       | 0       | 3     |
| straight_line_3d   | 2     | 0                       | 0       | 2     |
| tour               | 2     | 0                       | 0       | 2     |
| shared_walls_count | 1     | 1                       | 0       | 2     |
| errand             | 1     | 0                       | 0       | 1     |
| Total              | 18    | 1                       | 0       | 19    |

- **18 asked**, each naming how many rooms share the label and offering a way to tell them apart (contents,
  neighbouring room). Where the question also closed a lift or stairs, the closure was applied first.
- **1 resolved without asking** (`osm-way58216509-H05`): the agent checked both rooms named N2148A, found each
  touches 9 other rooms, explained that the ambiguity does not change the answer, and answered 9. That is the
  rubric's "ask only what it needs" done right.
- **0 guessed silently.**

Cost ≈ $0.40, 19 chat turns, under a minute with 4 workers.

Note for the benchmark: in benchmark mode the same questions get an Answer line regardless (the prompt forbids
asking back there); the agent then runs the tool for every candidate and takes the majority, which was right in
4 of 5 cases in the live run above. The test set has no ambiguous mentions, so this cannot cost test points.

---

## 2026-10-24 — full live run, sentence only, all train + dev questions

**Commit**: `ceeeee2` (main, after the Agent branch merge). **Model**: `claude-sonnet-5-5`, benchmark prompt
for the scored kinds, chat prompt for the warm-ups, `--no-kind-hints`, 4 workers. **Run by**: Core owner.

### Scored kinds (`questions.jsonl`), official scorer

| Kind                      | Train answers     | Train extraction | Dev answers      | Dev extraction |
|---------------------------|-------------------|------------------|------------------|----------------|
| floor_area_total          | 150 / 150         | 150 / 150        | 31 / 31          | 31 / 31        |
| largest_room              | 76 / 76           | 76 / 76          | 20 / 20          | 20 / 20        |
| shared_walls_count        | 118 / 119         | 118 / 119        | 24 / 24          | 24 / 24        |
| errand                    | 74 / 74           | 73 / 74          | 19 / 19          | 19 / 19        |
| wide_delivery_count       | 61 / 61           | 61 / 61          | 19 / 19          | 19 / 19        |
| straight_line_3d          | 17 / 17           | 15 / 17          | 13 / 13          | 13 / 13        |
| room_stacked              | 17 / 17           | 16 / 17          | 9 / 9            | 9 / 9          |
| what_if_door              | 2 / 2             | 2 / 2            | 2 / 2            | 2 / 2          |
| step_free_reachable_count | 1 / 1             | 1 / 1            | 1 / 1            | 1 / 1          |
| Total                     | 516 / 517 (99.8%) | 512 / 517        | 138 / 138 (100%) | 138 / 138      |

Tool choice correct on all 655; one tool call per question; no API errors, no retries.

### Warm-up kinds (`questions_basic.jsonl`), starter scorer on what the tools computed

| Kind               | Train                 | Dev               |
|--------------------|-----------------------|-------------------|
| locate             | 452 / 453             | 100 / 100         |
| count              | 199 / 199             | 40 / 40           |
| route              | 595 / 600             | 120 / 120         |
| route_step_free    | 198 / 200             | 40 / 40           |
| route_with_closure | 107 / 109             | 28 / 29           |
| tour               | 198 / 200             | 40 / 40           |
| Total              | 1,749 / 1,761 (99.3%) | 368 / 369 (99.7%) |

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
| Run                   | Questions | Time   | Approx. cost (Sonnet list prices) |
|-----------------------|-----------|--------|-----------------------------------|
| Benchmark train + dev | 655       | 15 min | $10                               |
| Warm-up dev           | 369       | 6 min  | $4.50                             |
| Warm-up train         | 1,761     | 27 min | $21                               |
| Total                 | 2,785     |        | ≈ $36                             |

Tokens, benchmark train: 349k input, 55k output, 6.16M cache read, 2.20M cache write. Dev: 91k / 15k / 1.88M / 0.53M.

### Open items
- Sunday building: run `core.check_questions` first; duplicate room names there would be the only known risk.
- Optional: a regex pre-extractor for the templated wording as a no-LLM fallback (Core offer, not built).

---

## 2026-10-24 — core oracle (no LLM), all train + dev

**Commit**: `a8279d8` (core branch, merged to main). Parameters fed straight from the dataset's `inputs`.

| Set                                          | Questions | Correct |
|----------------------------------------------|-----------|---------|
| Train benchmark, 9 kinds                     | 517       | 517     |
| Dev benchmark, 9 kinds                       | 138       | 138     |
| Train warm-up (locate, count, 4 route kinds) | 1,761     | 1,761   |
| Dev warm-up                                  | 369       | 369     |

Calibrations made to reach this: shared walls count rooms and halls only (balconies excluded, 143/143);
room answers carry the room number (`label`) because OSM rooms share names. `errand` `via`/`target` ids match
the dataset in 93/93. `what_if_door` rests on only 4 examples.

---

## 2026-10-24 — Agent owner's runs (from `agent/PROGRESS.md`)

**Commit**: `9873d57`. Full dev live: **138/138** answers, **138/138** extraction, Sonnet 5.5, no kind hints.
Opus vs Sonnet on the same 24 questions: both 24/24; Sonnet chosen. Test CSV `submissions/team_simran_v1.csv`
generated: 145 rows, all with Answer lines. Clean-clone BENCHMARK.md rehearsal: 5/5 on the factory building;
organizers' evaluator from the clone: 9/9 (one per kind).
