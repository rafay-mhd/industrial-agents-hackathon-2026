# Team Simran · benchmark run instructions

`answers.json` in this folder holds our agent's replies to all 145 test questions in `data/test`:
a JSON list of `{"question_id": ..., "answer": ...}`. `answer` is the agent's full reply; its last
`Answer:` line is the one the scorer reads. It was produced with the commands below on the current
`main` and converted from the runner's CSV (`submissions/team_simran_v2.csv`).

## Setup, once

Prerequisites: `uv` on PATH and an Anthropic API key with credits. Python 3.12 and every dependency are
pinned in `uv.lock`; nothing is trained or downloaded besides packages.

```bash
git clone https://github.com/rafay-mhd/industrial-agents-hackathon-2026.git
cd industrial-agents-hackathon-2026
uv sync --frozen
cp .env.example .env        # then set ANTHROPIC_API_KEY=... in .env
```

## Run on the secret building (one building folder per invocation)

The building folder must contain `building.json` and a question file in the kit format: a
`questions.jsonl` (fields `id`, `question`, like `data/test/*/questions.jsonl`) or a CSV with the columns
`question_id,building_id,kind,question` (like `data/test/questions.csv`).

```bash
uv run --frozen --env-file .env python -m agent.benchmark \
  /path/to/secret_building /path/to/secret_building/questions.jsonl \
  --no-kind-hints --model claude-sonnet-5-5 --out agent_output/benchmark/secret.csv

uv run --frozen python -m core.to_answers_json agent_output/benchmark/secret.csv SUBMISSION/answers.json
```

The first command answers every question (4 parallel workers, retries with backoff; a failing question
still gets a row) and writes a `question_id,answer` CSV plus a `.jsonl` sidecar with the tool calls and
timings. The second command converts that CSV into this folder's `answers.json` format. Expect about a
minute for five questions and a few minutes for a whole building, depending on API latency.

The organizers' harness runs the same agent through the two-argument entry point:

```bash
uv run --frozen --env-file .env python -m benchmark.evaluate /path/to/secret_building \
  --agent agent.answer:answer --submission-csv agent_output/benchmark/secret_official.csv
```

## What runs

`agent/answer.py` exposes `answer(building_directory, question_text) -> str`. Claude (Sonnet 5.5) reads
the question and calls deterministic tools in `core/`: shapely geometry for areas, centroids, shared walls
and stacking; a networkx graph of rooms, doors, stairs and lifts that follows the kit 1.1.0 route rules
(door-to-door walking, stairs 2 m per metre climbed, lifts 15 m plus 1 m per metre). Nothing is tuned to
specific buildings. Checks that need no API key:

```bash
uv run --frozen python -m core.oracle_check data/dev                 # 100 % on train and dev with the known inputs
uv run --frozen python -m unittest discover -s agent/tests           # runner, prompt and tool regression tests
```

Full options, the clean-checkout rehearsal and the verification log: `BENCHMARK.md` at the repository
root, `agent/PROGRESS.md` and `docs/test_log.md`.
