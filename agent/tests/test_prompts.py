"""Verify prompt selection reaches the SDK without changing replies or user text."""

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from agent.agent import BuildingAgent
from agent.prompts import BENCHMARK_PROMPT, CHAT_PROMPT
from core import Building


BUILDING = Path(__file__).resolve().parents[2] / "data/dev/proc-factory-dev-003"


class PromptTests(unittest.TestCase):
    def test_selected_prompt_is_sent_to_sdk_with_cached_building_context(self):
        for mode, prompt in (("benchmark", BENCHMARK_PROMPT), ("chat", CHAT_PROMPT)):
            with self.subTest(mode=mode), TemporaryDirectory() as output:
                building = Building.load(BUILDING)
                final = SimpleNamespace(
                    content=[SimpleNamespace(type="text", text="Answer: Example room 1.02, 42.1 m²")],
                    stop_reason="end_turn",
                    usage=SimpleNamespace(input_tokens=10, output_tokens=5,
                                          cache_read_input_tokens=0, cache_creation_input_tokens=0),
                )

                class Runner:
                    def __iter__(self):
                        return iter([final])

                    def generate_tool_call_response(self):
                        return None

                client = Mock()
                client.beta.messages.tool_runner.return_value = Runner()
                agent = BuildingAgent(building, Path(output), client=client, mode=mode)
                reply = agent.ask("Which is the largest office on Floor 1?")
                kwargs = client.beta.messages.tool_runner.call_args.kwargs
                expected = prompt.format(overview=json.dumps(building.overview(), ensure_ascii=False))
                self.assertEqual(kwargs["system"], [{"type": "text", "text": expected,
                                                   "cache_control": {"type": "ephemeral"}}])
                self.assertEqual(kwargs["messages"], [{"role": "user", "content": "Which is the largest office on Floor 1?"}])
                self.assertEqual(reply, "Answer: Example room 1.02, 42.1 m²")
                self.assertEqual(agent.usage["output_tokens"], 5)

    def test_interactive_agent_defaults_to_chat_and_rejects_unknown_mode(self):
        with TemporaryDirectory() as output:
            building = Building.load(BUILDING)
            agent = BuildingAgent(building, Path(output), client=Mock())
            self.assertEqual(agent.mode, "chat")
            self.assertNotIn("Return only the final Answer line", agent.system[0]["text"])
            with self.assertRaisesRegex(ValueError, "Unknown agent mode"):
                BuildingAgent(building, Path(output), client=Mock(), mode="typo")


if __name__ == "__main__":
    unittest.main()
