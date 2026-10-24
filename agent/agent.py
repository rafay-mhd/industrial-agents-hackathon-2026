"""Reuse the starter conversation loop with the team's Core-backed tools."""

import json
from pathlib import Path
from typing import Literal

import anthropic

from core import Building
from starter_agent.agent import BuildingAgent as StarterBuildingAgent

from agent.tools import make_tools
from agent.prompts import BENCHMARK_PROMPT, CHAT_PROMPT


class BuildingAgent(StarterBuildingAgent):
    def __init__(
        self, building_map: Building, output_directory: Path,
        client: anthropic.Anthropic | None = None,
        *, mode: Literal["chat", "benchmark"] = "chat",
    ) -> None:
        if mode not in {"chat", "benchmark"}:
            raise ValueError(f"Unknown agent mode: {mode}")
        super().__init__(building_map, output_directory, client=client)
        self.mode = mode
        self.responses: list[dict] = []
        self.tools = make_tools(building_map, output_directory)
        prompt = BENCHMARK_PROMPT if mode == "benchmark" else CHAT_PROMPT
        self.system = [{
            "type": "text",
            "text": prompt.format(overview=json.dumps(building_map.overview(), ensure_ascii=False)),
            "cache_control": {"type": "ephemeral"},
        }]

    def track_usage(self, message: object) -> None:
        super().track_usage(message)
        self.responses.append({"id": getattr(message, "id", None),
                               "model": getattr(message, "model", None),
                               "stop_reason": getattr(message, "stop_reason", None)})
