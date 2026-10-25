# Inside — Talk to Your Building

Team Simran’s building explorer. React + TypeScript + Vite, Motion, Three.js and the existing Claude building agent. ElevenLabs supplies speech input/output; it is not a separate conversational agent.

## Run

Requires Node 22.18+ (Node 25.7 tested).

Run everything from a single `main` checkout. From the repository root:

```sh
uv sync --frozen
npm --prefix ui ci
npm --prefix ui run build
uv run --frozen --env-file .env uvicorn agent.web:app --host 127.0.0.1 --port 8012
```

Open **http://127.0.0.1:8012** for the built app. The UI, GLB models and API share one origin. Keep the existing root `.env` private; use `.env.example` only when configuring a new checkout.

For hot reload, leave the combined server running and use a second terminal:

```sh
npm --prefix ui run dev -- --host localhost --port 5174 --strictPort
```

Open **http://localhost:5174**. Vite proxies `/api` unchanged to **http://127.0.0.1:8012/api**. `AGENT_API_URL` can point to a different combined server. For a separately hosted API, `VITE_API_BASE_URL` changes the browser API base; that server must allow your UI origin. The original `agent.server:app` still exposes the API at its root for legacy clients. Never put Anthropic or ElevenLabs secrets in a `VITE_` variable.

Offline, five bundled buildings and local JSON imports remain explorable. Requests never silently turn into mock answers. The old response fixtures remain in `public/mock/` for reference.

## What is implemented

- Warm beige interface, royal blue/red and gold accents; bundled Lobster display type and DM Sans for readable controls and labels.
- Searchable building and room directories, floor selection, layer controls, metadata/attribution and original JSON download.
- A simplified 2D SVG map from the original polygons. Concave rooms get interior labels; small labels reveal as you zoom. Pan, zoom, fit and source-coordinate scale are available. The compass indicates **Y+**, not an invented true north.
- Visual navigation starts with each new route: one moving character, a gold completed trail, following camera, pause/resume, replay, progress scrubbing and 1×/2×/4× speed. The same journey continues when switching between 2D and 3D. Floor changes follow uniquely identified source stairs/lifts; stair transfers follow the illustrative display model. Manual map interaction releases the camera; “Follow” recentres it. Walking segments use the exact API coordinates, without curves that cut corners. This is a simulated preview, not indoor tracking; it never changes your confirmed location. Reduced-motion settings disable automatic playback. Every written step remains available under “Written directions”.
- True WebGL 3D opens in Exterior: a continuous envelope, dark pitched metal roof caps, recessed glazing, warm timber detailing and source-positioned oak entrance doors. The envelope combines indoor polygons, closes gaps up to 0.32 m to account for wall thickness, and retains courtyard holes, concavity, detached wings and outdoor exclusions. Higher storeys cap the spaces beneath them; adjacent double-height halls retain their source height. Below-ground volumes remain available in Cutaway/Inside rather than being shown above the presentation base. Cutaway keeps the coloured rooms and source floor elevations; Exploded separates levels and Inside isolates a floor. The shell is an interpretation of floor-plan data, not surveyed facade geometry.
- Entrances & outdoors lists actual exterior access points and recorded balconies/terraces. Selecting one flies the camera to it. Door gaps and widths use source records; balcony doors are separate from building entrances. An entrance point more than 0.65 m from the derived facade remains an explicitly unaligned marker instead of a fabricated portal. Outdoor polygons have open deck surfaces and illustrative railings on exposed edges. No terraces are inferred merely because a flat roof exists. Roof profiles, facade colours, windows, canopies, railings and the presentation base are illustrative treatments. The roof rise is a display convention capped at 2.2 m and below the next wing height, while original floor elevations and heights stay unchanged. Rectangular wings get planar hip faces; concave outlines and courtyards retain their exclusions. Original procedural maps provide zinc seams, oak grain and limestone texture without external image requests. Wider picture windows, narrower bays, recessed frames and timber fins break up the facade; oak door leaves retain each source opening’s width.
- A persistent scene animates camera flights and floor separation. Select a room in the model or directory to move inside; zoom smoothly towards the pointer, switch to a top view, reset, or enable a slow orbit. The 2D map has animated room focus, zoom and reset too. Reduced-motion preferences are respected.
- Floating room/floor labels, soft shadows, selected-room emphasis and an expanded map view (Escape to leave). Camera framing accounts for viewport aspect and control space. Selection, orbit and layer changes reuse the renderer; replacing a building disposes its graphics resources.
- Source asset footprints and opening accessibility/width details. Closures replace the complete current set, including empty sets on reopen. A closed vertical connector marks all its stop rooms. Edits invalidate stale routes. New doors appear in both map views.
- Original selectable pixel people identify the **location you explicitly choose**. The app does not invent live tracking or other people.
- One conversation session per building selection. Stale responses are ignored when switching buildings. Clarification and service errors remain visible.
- Hands-free voice turns: microphone → voice activity detection → existing ElevenLabs transcription endpoint → **the same building agent** → ElevenLabs audio playback → listening again. The orb reacts to measured microphone/playback audio. There is an explicit interrupt button, mute control and microphone cleanup.
- Local `building.json` import with structural validation, clear errors and preservation of unknown metadata. A captured/selected floor-plan photo can be previewed without uploading it anywhere.
- Responsive layouts, keyboard-operable directories and controls, native focus-trapping dialogs, reduced-motion support, lazy 3D/orb modules and CSS fallback if the orb cannot create a graphics context.

## Geometry and capability boundaries

The dataset gives room footprints, opening positions/widths, floor elevations and heights. It does **not** give an architectural exterior, windows, equipment heights, stair-flight shapes or wall thickness. The 3D view therefore renders source geometry as a spatial model:

- Wall thickness is a **10 cm display convention**. Slabs are a thin display surface. Cutaway mode lowers visible walls; full-height mode uses source heights.
- Missing floor heights/elevations use an explicitly identified **3 m estimate**. Supplied values are not changed, even where source volumes overlap.
- Equipment uses the 22 team-authored Blender GLBs from `ui-models` for matching object types: chairs, desks, beds, racks, machines, fixtures and more. Model bounds follow each source footprint and rotation exactly. Heights are representative unless an optional positive `height_m` is supplied; missing footprints use an explicitly unknown 0.45 m display size. Unknown types use a generic bounding volume. Shapes, materials and vertical placement are illustrative, not recovered CAD geometry. Matching types load once per building; geometry and materials are shared through instanced rendering. Procedural models appear immediately and remain for unmatched types or failed downloads. Editable source: `models_src/furniture.blend`; preview: `models_src/overview.png`.
- An object directory supports name/type search across floors, category filtering, focus and inspection. Source IDs are retained for agent questions. The inspector distinguishes `dataset` annotations from `generated` furnishings: 8,248 vs 77,455 objects in the supplied 280 buildings. Those generated objects are not evidence of real-world furnishings.
- Object parts use instanced rendering. Furniture stays mounted while layers and highlights change; raycasting maps each instance back to its original asset ID. A selected object lowers the cutaway walls for visibility. Shared collinear wall pieces are deduplicated to avoid flickering without moving source geometry.
- Room colours is the default interior appearance, restoring the use-based palette to floors and walls. Materials remains an optional neutral interior finish with original procedural wood grain, studio reflections and soft directional shadows. These finishes are illustrative; Exterior uses its own neutral facade palette.
- Source vertical connectors now render illustrative switchback stairs with treads, landings and rails, or transparent lift shafts with doors and a terminal enclosure. Floor openings are display cutaways within shared landing footprints, not surveyed architectural voids. Connector names, served floors, accessibility and closure state come from source IDs. The Connections menu, labelled model buttons and inspector support focus and visiting each stop.
- Cutaway mode keeps supplied floor elevations. Exploded mode is explicitly labelled artificial spacing: it moves floors and landing pieces, keeps real-rise stairs unscaled, and shows dashed links across the artificial gap. Inside retains incoming stairs/shafts so upper-floor cutaways are meaningful.
- Offset landing polygons, contradictory shared rooms and unsupported connector kinds use schematic links; the UI does not invent aligned shafts. Buildings without connector data do not acquire guessed stairs or lifts.
- Geometry with metre coordinates in the organizers’ JSON schema works generically. Arbitrary photos/PDFs cannot supply verified geometry without Builder conversion. The image panel explains this and does not fabricate a reconstruction.
- Local imports are not automatically registered with the agent. An imported file may reuse an existing building ID while containing different geometry, so it deliberately stays local until registered on the server.
- The route API groups geometry by floor, which cannot fully express the order of repeated floor visits. Outdoor journeys therefore show an explicit note: use the complete written directions for the outdoor leg. The UI does not invent a joining line.

Voice currently uses the server’s **batch** `/transcribe` and `/tts` endpoints. Turn detection and playback are automatic, but transcription/answer audio are not streamed, and interruption is button-driven. Full-duplex voice, live partial transcripts, automatic barge-in and lower latency need a streaming transport in the agent backend. The frontend does not claim those are already implemented.

## Check

```sh
npm test
npm run build
npm run lint
```

The tests validate all 280 source buildings (22,725 spaces), exact equality of the five bundled copies, an unseen concave/negative-coordinate building, bad imports, floor-level route lookup, corner-preserving previews, closure/reopen semantics, connector closures and measured 3D wall cuts. Voice tests use controlled microphone/recorder/audio doubles; they cover silence, automatic turns, playback, interruption, stop cancellation, switching buildings and denied permissions.

Main integration verification (2026-10-25): frontend build/lint and 49 tests pass, including parsing all 22 GLBs, normalized source bounds/rotation, instancing, picking, missing-model fallback and existing voice controls. The 69 backend tests include the same-origin UI/API/model server and a missing frontend build. The current kit 1.1.0 Core oracle passes 138/138 dev questions; the live Claude factory benchmark passes 5/5. A live browser request returned the current 91.06 m step-free route from Warehouse zone H-C2 to Kitchen 0.28 (displayed as 91.1 m), with animated playback. The combined API served all 280 buildings and successfully synthesized and transcribed a short test sentence with ElevenLabs. This is a generated-audio round trip, not a physical microphone acceptance test. Older route distances from the pre-1.1.0 kit are not used as integration expectations.

Browser verification in Microsoft Edge covered desktop and a 400 px responsive viewport, room selection, confirmed location, a live route request, animated route preview, actual ElevenLabs answer playback, 2D/3D switching and all-floor/separated-floor rendering. The observed avatar scaling and 3D contrast issues were corrected. A real microphone conversation still needs the user's acceptance check; automated voice tests use doubles and do not prove microphone capture or end-to-end latency on a physical device.

The subsequent 3D revision was visually checked in Edge on the factory: coloured whole-building volumes, animated separated floors, the expanded view and direct model picking into a labelled room interior. Camera tests check all box corners in wide, portrait, tall and top views; palette tests cover industrial halls and stairwells with a generic corridor type. That revision had 20 passing tests in total. Further manual checks of the revised renderer on other buildings and mobile were interrupted when the browser window became unavailable; the earlier mobile check predates this revision.

Manual acceptance:

1. Open the factory, then a Swiss dwelling and an unfamiliar registered building. Search rooms and switch floors. Inspect both map views, Building / Floors / Inside modes and layers. Expand the map, zoom, select a room, switch to top view and use Escape to leave.
2. Select a starting room → “I’m here”; select a destination → “Go here”. Play the route in both 2D and 3D; pause, scrub across a floor transition and replay. Close/reopen a door and verify the old route clears. Ask the agent to add a door between adjacent rooms.
3. Import a valid previously unseen `building.json`, then a malformed file. The valid map should remain after a rejected import. Choose a photo; the UI must not claim that conversion is complete.
4. Start voice, grant microphone permission and ask a building question. Pause to send; hear the answer; interrupt; end voice. Confirm the browser microphone indicator stops. Repeat in another building.
5. Check narrow and wide windows, keyboard focus, reduced motion and WebGL fallback.

## Design references and credits

The [awesome-design-md](https://github.com/voltagent/awesome-design-md) Apple and Claude references informed restrained controls, warm surfaces and editorial spacing. The palette and original pixel artwork are specific to this app. The voice orb adapts the MIT-licensed ElevenLabs component featured on [21st.dev](https://preview.21st.dev/%40ElevenLabs-crawled/components/orb), with a custom blue/red/gold ramp, local noise and audio-driven motion. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

The object-model revision passes 25 tests, TypeScript/production build and lint. It adds tests for source identity/provenance, exact transformed footprint bounds, unknown-size/height handling, instance picking and hidden/highlighted instances, batching, and shared wall overlap removal. Browser inspection in Edge confirmed furnished factory interiors, directory search, selecting a desk, camera focus, and its source footprint/rotation/provenance details. This is a spatial visualisation, not automatic recognition from photographs or a surveyed architectural twin.

A CPU-side compatibility check finds a display family for every supplied object type. The largest building (`osm-way27917482`) creates 5,250 object models in 19 shared geometry/material batches with finite bounds; this check does not measure browser frame rate.

The connected-floor revision passes 29 tests, including all 712 source connector records, unordered basement elevations, conservative landing envelopes, offset/conflicting source stops, matching factory floor heights, unchanged stair dimensions during explosion, connector selection IDs and closure styling. Edge checks confirmed staircase and lift focus, source floor/accessibility details and the assembled cutaway model.

Route-player verification also covers ascending and descending journeys in an unseen building with unordered floor IDs and basement levels, exact path corners, partial routes with ambiguous/missing connectors, pause/resume, scrubbing, speed and arrival. The live Hall access 0.19 → Server room 1.05 route was checked in Edge in both map views, including the Office staircase transition.

Exterior verification: topology, openings, roof-height transitions, outdoor exclusions and immutable source data are checked across all 280 buildings. Geometry/picking tests also check source-sized entrance holes, terrace rail boundaries, closures and floor offsets. In Edge, the factory exterior and coloured cutaway were inspected, and Residence 1465’s balcony deck and entrance chooser were exercised.

Animated interface: `ShaderSurface` uses Paper Shaders (featured on 21st.dev) for a warm moving mesh behind the map and a pulsing aurora contour around the voice orb. The existing audio-reactive orb still receives the real microphone/playback levels and agent phase. Glass panels, moving tab indicators, orbiting accents and hover transitions retain the original data and actions. The top-bar Animated visual effects control pauses decorative motion; system reduced-motion preferences also stop the shader clocks. Paper handles tab/off-screen suspension, with bounded canvas pixel counts; the voice orb also suspends off-screen rendering. Static gradients remain as a fallback when WebGL is unavailable. Shader code is lazy loaded, and there are no remote shader/image requests at runtime.
