"""Baseline entry point for the official evaluator.

Run with credentials loaded by uv:
    uv run --env-file .env python -m benchmark.evaluate data/dev \
        --kinds floor_area_total --per-kind 2 --agent agent.answer:answer

Each question gets fresh map/conversation state and a separate artifact directory.
Only the API client is shared. The starter's prompt and tools remain unchanged
until the tool and prompt integration steps in TEAM_PLAN.md.
"""

from pathlib import Path
from threading import Lock
from uuid import uuid4

import anthropic

from starter_agent.agent import BuildingAgent
from starter_agent.building_map import BuildingMap

OUTPUT_DIRECTORY = Path("agent_output") / "answers"
_client: anthropic.Anthropic | None = None
_client_lock = Lock()


def _get_client() -> anthropic.Anthropic:
    """Create the shared client lazily; imports do not require credentials."""
    global _client
    with _client_lock:
        if _client is None:
            _client = anthropic.Anthropic()
        return _client


def answer(building_directory: Path, question_text: str) -> str:
    """Return the starter agent's full reply for one independent question.

    Propagate errors to the evaluator, which owns retry/failure handling.
    Never load question files, expected answers, or oracle inputs here.
    """
    building = BuildingMap.load(building_directory)
    client = _get_client()
    output_directory = OUTPUT_DIRECTORY / uuid4().hex
    output_directory.mkdir(parents=True, exist_ok=False)
    agent = BuildingAgent(building, output_directory, client=client)
    return agent.ask(question_text)
