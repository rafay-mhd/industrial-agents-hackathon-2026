"""Core-backed answer entry point for the official evaluator.

Run with credentials loaded by uv:
    uv run --env-file .env python -m benchmark.evaluate data/dev \
        --kinds floor_area_total --per-kind 2 --agent agent.answer:answer

Each question gets fresh map/conversation state and a separate artifact directory.
Only the API client is shared. Core supplies the calculations through our tool
wrappers. The starter conversation prompt is retained until step 5.
"""

from pathlib import Path
from threading import Lock
from uuid import uuid4

import anthropic

from core import Building
from agent.agent import BuildingAgent

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


def answer(building_directory: Path, question_text: str) -> str:
    """Return the Core-backed agent's full reply for one independent question.

    Propagate errors to the evaluator, which owns retry/failure handling.
    Never load question files, expected answers, or oracle inputs here.
    """
    building = Building.load(building_directory)
    client = _get_client()
    output_directory = OUTPUT_DIRECTORY / uuid4().hex
    output_directory.mkdir(parents=True, exist_ok=False)
    agent = BuildingAgent(building, output_directory, client=client)
    return agent.ask(question_text)
