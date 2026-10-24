# Team Simran benchmark runbook

Run commands from the repository root in a checkout containing `agent/`, `core/`, and `uv.lock`.
The default agent uses Claude Sonnet 5.5 to interpret questions and calls Core for building facts.
No model training is required. Each question starts with fresh building and conversation state.

The organizers supply train and dev questions with answer keys for development. Their separate test
split supplies building data and 145 questions without answer keys; those generated replies form the
submission. The 138-question dev score measures development-set performance, not hidden-test accuracy.

## Setup

Prerequisites: Git, `uv` available on PATH, and an Anthropic API key with API credits.
The repository pins Python 3.12; `uv` creates the local `.venv` and installs the locked dependencies:

```bash
uv sync --frozen
```

For a new checkout, copy `.env.example` to `.env` and fill in `ANTHROPIC_API_KEY` locally.
Do not overwrite an existing configured `.env`. The file is ignored by Git; keep the key out of
commands, chat and commits. ElevenLabs is unnecessary for benchmarks.

```bash
cp .env.example .env
```

## One building: quick live check

This runs all five scored questions for the factory building, with four workers and no kind hints:

```bash
uv run --frozen --env-file .env python -m agent.benchmark \
  data/dev/proc-factory-dev-003 data/dev/proc-factory-dev-003/questions.jsonl \
  --no-kind-hints --model claude-sonnet-5-5 --out agent_output/benchmark/factory.csv
uv run --frozen python -m agent.report agent_output/benchmark/factory.jsonl
```

Expect five replies and a per-kind score table; the verified target is 5/5. This uses API credits.
The 2026-10-24 clean-clone rehearsal took **8.67 seconds** for these five questions; dependency sync
took 2.45 seconds on that machine. Allow roughly a minute for five questions and several minutes for
a full split; network latency,
prompt-cache state, provider load and retries affect runtime. First-time dependency downloads add time.

The runner writes:

- `factory.csv`: UTF-8 `question_id,answer`, with the complete reply quoted as CSV when needed.
- `factory.jsonl`: scores, reference answers where provided, tool calls/results, attempts, errors,
  elapsed seconds, token totals and links to individual attempt traces.
- `agent_output/answers/<unique-id>/trace.json`: the actual tool transcript and model metadata.

The console's `correct / scored` column counts answers passing the organizers' official scorer.
`saved` counts output rows and `errors` counts execution/scoring failures. The report additionally
checks extracted arguments against dev references and prints failure evidence. Extraction is distinct
from answer accuracy. Test rows are unscored because no answer key is available.

## Full dev run and test submission

```bash
uv run --frozen --env-file .env python -m agent.benchmark data/dev data/dev \
  --no-kind-hints --model claude-sonnet-5-5 --out agent_output/benchmark/dev.csv
uv run --frozen python -m agent.report agent_output/benchmark/dev.jsonl

uv run --frozen --env-file .env python -m agent.benchmark data/test data/test/questions.csv \
  --no-kind-hints --model claude-sonnet-5-5 --out agent_output/benchmark/test_candidate.csv
```

The current v2 submission is `submissions/team_simran_v2.csv`; v1 is preserved. Generate new candidates under
`agent_output/` first; `--out` replaces an existing CSV and its JSONL sidecar. Validate the candidate
before saving a new version in `submissions/`. Send only the CSV to the organizers, not the diagnostics.

Submission checks: exactly the two header columns, 145 unique question IDs matching
`data/test/submission_template.csv`, one nonempty full reply per ID, an `Answer:` line in every reply,
valid CSV quoting, UTF-8, and at most 5 MB. Our single-line replies give 146 physical lines including
the header; the official format also permits properly quoted multiline replies. Format validation
does not establish hidden-test accuracy. See README.md section 6 for the official scoring rules.

Verified again in step 12 on 2026-10-24: full dev **138/138**, with all nine kinds correct;
v2 contains **145 fresh answers** and passes the submission format checks.
Test accuracy is unknown. See `agent/PROGRESS.md` for model comparison, validation and provenance.

## Organizers' checks and our own checks

The organizers provide a warm-up evaluator and a scored benchmark evaluator:

```bash
# Official warm-ups: direct tools, no model calls or credits; not an LLM accuracy test.
uv run --frozen python -m starter_agent.evaluate data/dev --oracle

# Official benchmark harness, using OUR agent (omitting --agent uses their limited starter).
uv run --frozen --env-file .env python -m benchmark.evaluate data/dev \
  --agent agent.answer:answer --per-kind 1 --name official_smoke
```

The official harness runs sequentially and saves `agent_output/benchmark/official_smoke.jsonl`.
Verified on 2026-10-24: the free warm-up oracle passed **369/369**; the official live smoke test
passed **9/9** across all nine kinds in **24.65 seconds** from the fresh clone.
Its custom-agent path does not collect our usage counters; use our traces for observed token usage.
Remove `--per-kind 1` to run the entire dev set through that harness. Our parallel runner uses the
same official `benchmark.score.score_reply` function, with bounded retries and richer diagnostics.

These additional checks belong to our team, not the organizers:

```bash
# Core algorithms with known oracle inputs; no language interpretation or API calls.
uv run --frozen python -m core.oracle_check data/dev
# Adapter, runner, prompt, tool and diagnostic regression tests; no API calls.
uv run --frozen python -m unittest discover -s agent/tests -v
```

## Options and new buildings

- `--workers 4` is the default; reduce it if the account is rate limited.
- `--retries 3` allows three retries after the first attempt for transient API errors.
- `--kinds floor_area_total largest_room`, `--per-kind 3` and `--limit 5` select small samples.
- `--model` overrides `AGENT_MODEL` in the environment, which overrides the Sonnet default.
  The official harness uses that environment/default selection through `agent.answer:answer`.
- The runner normally adds public question-kind hints. These documented commands disable them
  to match the official two-argument entry point. Oracle inputs and answers never enter model messages.

Failures still get a CSV row; an execution failure without a reply leaves its answer empty. The CLI
exits nonzero after saving results if execution/scoring errors occurred. Wrong scored answers alone
do not cause a nonzero exit: inspect the score table and `agent.report` before accepting a run.

For a new building in the supplied schema, pass its directory and question file as the two positional
arguments. A split directory also works. Question CSVs require `question_id,building_id,kind,question`;
JSONL supports `id` instead of `question_id`. Building IDs must match the supplied building metadata.
Outputs must be outside the input building/question directories.

The Sunday building and questions have not been released or tested. Use the released files and verify
their announced submission format then. No hidden/unreleased judge tests are available locally.

## Clean-checkout rehearsal

Use a clone of a branch containing this implementation. Until the local `agent` commits are pushed,
a clone from GitHub will not contain those unpublished changes. A local clean clone can be made with:

```bash
git clone --no-local --branch agent /absolute/path/to/industrial-agents-hackathon-2026 /tmp/simran-rehearsal
cd /tmp/simran-rehearsal
uv sync --frozen
```

Configure `.env` as above (or securely copy your existing local file), then run the exact factory
command and report command from this document. Do not copy the original `.venv` or source files.
If a restricted environment cannot write normal cache directories, use writable `UV_CACHE_DIR` and
`MPLCONFIGDIR` locations; these settings do not change the agent or its answers.

Step 12 repeated this rehearsal from a clean local clone of `d843931`: frozen sync **0.49 s**, all
**67 offline tests passed**, documented factory benchmark **5/5 in 5.31 s**, extraction **5/5**.
The working tree remained clean and the temporary credential file was removed after the checks.
