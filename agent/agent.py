"""Starter-pattern conversation loop with Core tools and per-agent model selection."""

import json
import os
from pathlib import Path
from typing import Literal

import anthropic

from core import Building
from starter_agent.agent import BuildingAgent as StarterBuildingAgent
from starter_agent.agent import MAX_TOKENS, MAX_TOOL_ITERATIONS, EFFORT, FALLBACK_BETA

from agent.tools import make_tools
from agent.prompts import BENCHMARK_PROMPT, CHAT_PROMPT
from agent.context import ConversationContext
from agent.chat_tools import chat_tools

# Step 7: equal 24/24 dev comparison accuracy at lower published token prices.
DEFAULT_MODEL = "claude-sonnet-5-5"


class BuildingAgent(StarterBuildingAgent):
    def __init__(
        self, building_map: Building, output_directory: Path,
        client: anthropic.Anthropic | None = None,
        *, mode: Literal["chat", "benchmark"] = "chat",
        model: str | None = None,
    ) -> None:
        if mode not in {"chat", "benchmark"}:
            raise ValueError(f"Unknown agent mode: {mode}")
        super().__init__(building_map, output_directory, client=client)
        self.mode = mode
        self.model = model or os.environ.get("AGENT_MODEL") or DEFAULT_MODEL
        self.responses: list[dict] = []
        self.context = ConversationContext()
        self.actions: list[dict] = []
        self.tools = (chat_tools(building_map, output_directory, self.actions, context=self.context)
                      if mode == 'chat' else make_tools(building_map, output_directory))
        prompt = BENCHMARK_PROMPT if mode == "benchmark" else CHAT_PROMPT
        self.system = [{
            "type": "text",
            "text": prompt.format(overview=json.dumps(building_map.overview(), ensure_ascii=False)),
            "cache_control": {"type": "ephemeral"},
        }]

    def ask(self, user_text: str) -> str:
        """Keep model selection local; benchmark comparisons must not silently fall back."""
        self.messages.append({"role": "user", "content": user_text})
        system = list(self.system)
        if self.mode == 'chat' and (self.context.position is not None or self.context.step_free or self.context.trip):
            system.append({'type': 'text', 'text': 'Remembered user-confirmed context (a planned route does not move the user): '
                           + json.dumps(vars(self.context))})
        fallback = {"betas": [FALLBACK_BETA], "fallbacks": "default"} if self.mode == "chat" else {}
        runner = self.client.beta.messages.tool_runner(
            model=self.model, max_tokens=MAX_TOKENS, max_iterations=MAX_TOOL_ITERATIONS,
            system=system, tools=self.tools, messages=list(self.messages),
            output_config={"effort": EFFORT}, **fallback,
        )
        final = None
        for message in runner:
            final = message
            self.track_usage(message)
            self.messages.append({"role": "assistant", "content": message.content})
            tool_response = runner.generate_tool_call_response()
            if tool_response is not None:
                self.messages.append(tool_response)
        if final is None:
            return "(no response)"
        if final.stop_reason == "refusal":
            return "Sorry, I can't help with that request."
        return "\n".join(block.text for block in final.content if block.type == "text").strip()

    def track_usage(self, message: object) -> None:
        super().track_usage(message)
        self.responses.append({"id": getattr(message, "id", None),
                               "model": getattr(message, "model", None),
                               "stop_reason": getattr(message, "stop_reason", None)})
