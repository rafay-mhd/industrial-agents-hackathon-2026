"""Offline checks of question isolation and evaluator error handling."""

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import agent.answer as entrypoint


BUILDING = Path(__file__).resolve().parents[2] / "data/dev/proc-factory-dev-003"


class AnswerTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.output = Path(self.directory.name) / "answers"
        self.patches = [
            patch.object(entrypoint, "OUTPUT_DIRECTORY", self.output),
            patch.object(entrypoint, "_client", None),
        ]
        for patcher in self.patches:
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_questions_do_not_share_mutations_history_or_output_files(self):
        agents = []

        def ask(agent, question):
            self.assertEqual(agent.messages, [])
            self.assertEqual(agent.map.closed, set())
            self.assertNotIn("test_edit", agent.map.data)
            agent.messages.append({"role": "user", "content": question})
            agent.map.closed.add(next(iter(agent.map.spaces)))
            agent.map.data["test_edit"] = True
            agents.append(agent)
            return "Example explanation\nAnswer: 1"

        with patch.object(entrypoint.anthropic, "Anthropic") as constructor:
            with patch.object(entrypoint.BuildingAgent, "ask", ask):
                first = entrypoint.answer(BUILDING, "First question")
                second = entrypoint.answer(BUILDING, "Second question")
            constructor.assert_called_once_with()

        self.assertEqual(first, "Example explanation\nAnswer: 1")
        self.assertEqual(second, first)
        self.assertIs(agents[0].client, agents[1].client)
        # Real tool creation writes into an existing per-question directory.
        outputs = list(self.output.iterdir())
        self.assertEqual(len(outputs), 2)
        self.assertTrue(all(path.is_dir() for path in outputs))

    def test_agent_errors_reach_evaluator_instead_of_becoming_fake_answers(self):
        with patch.object(entrypoint.anthropic, "Anthropic"):
            with patch.object(entrypoint.BuildingAgent, "ask", side_effect=RuntimeError("test failure")):
                with self.assertRaisesRegex(RuntimeError, "test failure"):
                    entrypoint.answer(BUILDING, "Question")

    def test_invalid_building_fails_before_client_creation(self):
        with patch.object(entrypoint.anthropic, "Anthropic") as constructor:
            with self.assertRaises(FileNotFoundError):
                entrypoint.answer(Path(self.directory.name) / "missing", "Question")
            constructor.assert_not_called()


if __name__ == "__main__":
    unittest.main()
