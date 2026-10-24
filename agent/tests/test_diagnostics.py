"""Tracing preserves real call/result pairs, retries, and isolation between workers."""

from collections import Counter
from contextlib import redirect_stdout
import io
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Barrier
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import anthropic
import httpx2

import agent.answer as entrypoint
from agent.benchmark import run
from agent.diagnostics import publish_trace, take_trace, tool_calls


FACTORY = Path(__file__).resolve().parents[2] / "data/dev/proc-factory-dev-003"


class DiagnosticTests(unittest.TestCase):
    def tearDown(self):
        take_trace()

    def test_trace_pairs_unknown_failed_and_pending_calls_without_reexecuting(self):
        messages = [
            {"role": "assistant", "content": [
                SimpleNamespace(type="thinking", thinking="private reasoning omitted"),
                SimpleNamespace(type="tool_use", id="a", name="total_area", input={"floor": 0}),
                SimpleNamespace(type="tool_use", id="b", name="unknown_tool", input={}),
                SimpleNamespace(type="tool_use", id="c", name="rooms", input={}),
            ]},
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "a", "content": '{"total_m2": 7}'},
                {"type": "tool_result", "tool_use_id": "b", "is_error": True,
                 "content": [{"type": "text", "text": "Unknown tool"}]},
            ]},
        ]
        calls = tool_calls(messages)
        self.assertEqual([call["status"] for call in calls], ["ok", "error", "pending"])
        self.assertEqual(calls[0]["result"], {"total_m2": 7})
        self.assertEqual(calls[1]["result"], "Unknown tool")
        self.assertNotIn("private reasoning", str(calls))

    def test_answer_records_partial_trace_on_error_and_disk_error_does_not_mask_it(self):
        def ask(agent, question):
            agent.messages.append({"role": "assistant", "content": [
                {"type": "tool_use", "id": "a", "name": "total_area", "input": {"floor": 0}}]})
            agent.usage["input_tokens"] = 12
            raise RuntimeError("original failure")

        with TemporaryDirectory() as output, patch.object(entrypoint, "OUTPUT_DIRECTORY", Path(output)), \
                patch.object(entrypoint, "_client", None), patch.object(entrypoint.anthropic, "Anthropic"), \
                patch.object(entrypoint.BuildingAgent, "ask", ask), \
                patch.object(Path, "write_text", side_effect=OSError("disk unavailable")):
            with self.assertRaisesRegex(RuntimeError, "original failure"):
                entrypoint.answer(FACTORY, "Question")
        trace = take_trace()
        self.assertEqual(trace["error"]["type"], "RuntimeError")
        self.assertEqual(trace["trace_write_error"]["type"], "OSError")
        self.assertEqual(trace["tool_calls"][0]["status"], "pending")
        self.assertEqual(trace["usage"]["input_tokens"], 12)

    def test_concurrent_retries_keep_separate_calls_and_sum_observed_usage(self):
        barrier = Barrier(2)
        counts = Counter()
        request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")

        def fake_answer(directory, question):
            counts[question] += 1
            attempt = counts[question]
            if attempt == 1:
                barrier.wait(timeout=5)
            publish_trace({"path": "fake-local-trace", "usage": {"input_tokens": 10, "output_tokens": 1},
                           "tool_calls": [{"name": "total_area", "arguments": {"question": question},
                                           "result": None, "status": "pending"}]})
            if "total floor area" in question and attempt == 1:
                raise anthropic.APIConnectionError(request=request)
            return "Answer: 0"

        with TemporaryDirectory() as output, redirect_stdout(io.StringIO()):
            rows = run(FACTORY, FACTORY / "questions.jsonl", Path(output) / "results.csv", workers=2,
                       limit=2, answer_fn=fake_answer, kind_hints=False, retry_delay=0)
        self.assertEqual([row["attempts"] for row in rows], [1, 2])
        for row in rows:
            self.assertEqual(row["usage"]["input_tokens"], row["attempts"] * 10)
            self.assertEqual(len(row["attempt_details"]), row["attempts"])
            self.assertTrue(all(call["arguments"]["question"] == row["question"] for call in row["tool_calls"]))


if __name__ == "__main__":
    unittest.main()
