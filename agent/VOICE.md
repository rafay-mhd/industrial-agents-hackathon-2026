# Voice for our building agent

ElevenLabs transcribes the question and speaks the answer. The existing `BuildingAgent` and Core
still perform all reasoning, lookups, routes and edits. No ElevenAgents agent, conversation service,
knowledge base or alternate tool implementation is involved.

## Use it

The integrated Inside UI on `main` is the recommended voice interface: build `ui/`, then run `agent.web:app` on port 8012 and open `http://127.0.0.1:8012`. Its automatic voice turns use the same `/api` agent and speech endpoints. See `ui/README.md` for the complete setup. The standalone recorder below is also available at `/api/voice` on the combined server.

To run only the original standalone recorder:

```bash
uv sync --frozen
uv run --frozen --env-file .env uvicorn agent.server:app --host 127.0.0.1 --port 8012
```

Open `http://127.0.0.1:8012/voice`. Select a building, record a question, stop, check/edit the transcript,
and send. The same agent replies and ElevenLabs reads that reply. Typed questions and audio uploads
work in the same conversation. The audio controls replay the generated answer without another API call.
If speech generation fails, the answer stays visible and **Retry speech** calls only `/tts`; it never
replays a route/edit request. There is no silent fallback to browser speech or mock answers.

The microphone needs browser permission and localhost or HTTPS. Recording stops after 60 seconds;
tracks are released on stop, errors and navigation. Audio uploads have a 10 MB limit. If recording is
unsupported or denied, choose a recording or type. Browser autoplay restrictions leave a Play control.

Required local environment: `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY`. The ElevenLabs key needs
speech-to-text and text-to-speech permissions; Voices read access helps choose a voice. Optional
`ELEVENLABS_VOICE_ID` overrides the standard George voice. Credentials are server-only and gitignored.
Restart the process after changing environment variables. Text-only chat needs no ElevenLabs key.

## Building and session behavior

The picker reads `/buildings`, including all 280 supplied buildings and buildings later registered by
Builder. Set `AGENT_DATA_DIR` for another collection of valid building JSON files. Voice has no fixed
building IDs, room names, training step or per-building ElevenLabs agent. The server must have the
building's data; selecting a local file only in a separate frontend does not register it on the server.

`/voice?building_id=<id>&session_id=<existing-session>` opens a specific building and shares the text
agent session on that same backend. Otherwise the page starts a fresh UUID session. Changing building
or choosing New conversation starts a new session. Refresh buildings preserves the current conversation
when its building still exists. Sessions remain in memory, using one server worker.

Room/asset/floor/connector names from the selected building provide optional transcription vocabulary.
We limit hints to 100 terms, 3,500 UTF-8 bytes total, under 50 characters and five normalized words per
term. A live Swiss-building test revealed an additional provider limit of 5,000 aggregate keyword tokens;
the bounded vocabulary fixes that failure. If the provider still rejects optional hints, transcription
retries once without them. Transcription alone cannot mutate the agent's state.

Hints improve recognition but cannot guarantee every name, room number, accent or noisy recording.
The editable transcript is the accuracy check before the agent acts. Unrecognized or ambiguous rooms
continue through the existing agent clarification behavior. Spoken output removes Markdown styling
without an LLM rewrite or changes to the numerical facts.

## API and Interface handoff

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /buildings/{id}/transcribe` | Multipart `file`, optional `language_code` (`en`, `de`, or another supported 2–3 letter code) | `{text, language_code, language_probability, needs_review:true}` |
| `POST /buildings/{id}/chat` | Existing `{session_id, message}` using the reviewed transcript | Existing `{reply, understood, needs_clarification, actions}` |
| `POST /tts` | Existing contract `{text}`; at most 10,000 characters | `audio/mpeg`, no-store |
| `GET /voice/status` | None | Key configured flag and speech model names; this is not a provider health check |

The page uses `MediaRecorder` for audio capture, ElevenLabs `scribe_v2` for transcription and
`eleven_multilingual_v2` for speech. It sends only `reply` to TTS, the same text shown to the user;
long replies are spoken in ordered chunks. The provider APIs are documented at
[Create transcript](https://elevenlabs.io/docs/api-reference/speech-to-text/convert) and
[Create speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).

The Interface branch inspected was `origin/ui` at `e192d43`. Its `/tts` request already matches this
backend. Its microphone still uses `SpeechRecognition`, so the main UI does **not** yet use ElevenLabs
input. The Interface owner can replace that capture with `MediaRecorder` → `/transcribe`, put the
returned text in the editable chat input, then use its existing send/action-dispatch flow. Keep one
backend origin and the existing session ID. Alternatively link to `/voice` with the query parameters
above. This change stays in Agent-owned files; the teammate's UI was not edited.

Expected errors: 404 unknown building, 413 oversized audio, 415 unsupported audio type, 422 empty
speech/invalid request, 429 provider limit, 503 missing/rejected credential, 502 provider failure,
504 timeout. Error responses do not disclose provider response bodies or keys. Text chat remains
available if ElevenLabs fails. Audio is processed per request and not permanently saved by these routes.

## Verification evidence

- 67 offline tests pass, including 11 speech tests: multipart provider calls, selected-building
  vocabulary, all 280 building vocabulary limits, newly registered buildings, invalid uploads, safe
  provider failures, one-time hint fallback, shared agent state and speech-only retries.
- Real factory browser flow: uploaded synthetic spoken question → “How large is Office 1.20?” →
  our agent → **29.6 m²** → ElevenLabs MP3. Edge visibly entered **Audio playing**, including replay.
- Real residential flow: `resplan-1465`, “Living room 0.01” → **82.13 m²**, spoken output 70,260 bytes.
- Real large Swiss flow after vocabulary fix: `swiss-5097`, “Bedroom -1.02 in Apartment 1” →
  **14.53 m²**, spoken output 46,436 bytes. Both answers were checked against Core.
- The user also tested two spoken requests in the browser: wheelchair route from Warehouse zone
  H-C2 to Office 1.20, then Kitchen 0.28 instead. Observed answers/actions were **151.1 m** and
  **53.87 m**, with the original Warehouse start and step-free need retained. Both live input/chat/TTS
  chains returned 200 and the browser showed playable audio and playback progress. The first transcript included
  a spoken correction; the agent still resolved the intended start correctly.
- The three area-test inputs were generated speech. The two user route turns add real-user evidence,
  but none of these checks guarantees recognition for every accent, noise level or room identifier.
- The 280-building check validates vocabulary/request construction; it is not 280 live speech tests.

Local generated test audio and JSON evidence are ignored under `agent_output/voice/`. Run offline
checks with `uv run --frozen python -m unittest discover -s agent/tests -q` and
`uv run --frozen python -m core.oracle_check data/dev`. Full Step 12 live dev result: **138/138**;
test submission v2 has 145 answers with no supplied test answer key.

The final server runs on port 8012. Its restart after the user's test starts fresh in-memory sessions.
The clean-clone rehearsal installed the frozen dependencies, passed all 67 tests, and scored 5/5 on
the documented factory benchmark. See PROGRESS.md for evidence and remaining team integration work.
