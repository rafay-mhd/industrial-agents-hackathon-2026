"""Reuse the starter conversation loop with the team's Core-backed tools."""

from pathlib import Path

import anthropic

from core import Building
from starter_agent.agent import BuildingAgent as StarterBuildingAgent

from agent.tools import make_tools


class BuildingAgent(StarterBuildingAgent):
    def __init__(
        self, building_map: Building, output_directory: Path,
        client: anthropic.Anthropic | None = None,
    ) -> None:
        super().__init__(building_map, output_directory, client=client)
        self.tools = make_tools(building_map, output_directory)
