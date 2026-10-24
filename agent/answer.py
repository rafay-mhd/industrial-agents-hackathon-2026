"""Core-backed answer entry point for the official evaluator.

Run with credentials loaded by uv:
    uv run --env-file .env python -m benchmark.evaluate data/dev \
        --kinds floor_area_total --per-kind 2 --agent agent.answer:answer

Each question gets fresh map/conversation state and a separate artifact directory.
Only the API client is shared. Core supplies the calculations through our tool
wrappers. Benchmark calls use the dedicated benchmark prompt; chat stays separate.
"""

import json
from pathlib import Path
from threading import Lock
from uuid import uuid4

import anthropic

from core import Building
from agent.agent import BuildingAgent
from agent.diagnostics import error_details, publish_trace, take_trace, tool_calls

OUTPUT_DIRECTORY = Path("agent_output") / "answers"
_client: anthropic.Anthropic | None = None
_client_lock = Lock()


def _get_client() -> anthropic.Anthropic:
    """Create the shared client lazily; imports do not require credentials."""
    global _client
    with _client_lock:
        if _client is None:
            # The benchmark runner owns retries; avoid multiplying SDK retries.
            _client = anthropic.Anthropic(max_retries=0)
        return _client


def answer(building_directory: Path, question_text: str, *, model: str | None = None) -> str:
    """Return the Core-backed agent's full reply for one independent question.

    Propagate errors to the evaluator, which owns retry/failure handling.
    Never load question files, expected answers, or oracle inputs here.
    """
    take_trace()  # Clear any previous call in this thread, including setup failures.
    building = Building.load(building_directory)
    client = _get_client()
    output_directory = OUTPUT_DIRECTORY / uuid4().hex
    output_directory.mkdir(parents=True, exist_ok=False)
    agent = BuildingAgent(building, output_directory, client=client, mode="benchmark", model=model)
    reply, failure = "", None
    try:
        reply = agent.ask(question_text)
        return reply
    except Exception as exc:
        failure = error_details(exc)
        raise
    finally:
        path = output_directory / "trace.json"
        trace = {
            "version": 1, "path": str(path.resolve()),
            "building_id": building.data["building"]["id"],
            "building_directory": str(building_directory.resolve()),
            "question": question_text, "reply": reply, "mode": agent.mode,
            "requested_model": agent.model,
            "tool_calls": tool_calls(agent.messages), "usage": dict(agent.usage),
            "responses": agent.responses, "error": failure,
        }
        try:
            path.write_text(json.dumps(trace, ensure_ascii=False, indent=2), encoding="utf-8")
        except OSError as exc:
            # Keep a successful answer or original API error even if disk logging fails.
            trace["trace_write_error"] = error_details(exc)
        publish_trace(trace)
