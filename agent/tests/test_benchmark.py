"""Runner checks use local fixtures and fake answers, never Claude credits."""

from collections import Counter
from contextlib import redirect_stdout
import csv
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Barrier
import unittest
from unittest.mock import Mock, patch

import anthropic
import httpx2

from agent.benchmark import answer_question, load_questions, run, select_questions


class BenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.split = self.root / "dev"
        # The metadata id need not equal the directory name (e.g. Sunday's input).
        self.building = self.split / "renamed-building"
        self.building.mkdir(parents=True)
        (self.building / "building.json").write_text(json.dumps({"building": {"id": "b1"}}))
        self.source = self.building / "questions.jsonl"
        self.output = self.root / "output" / "answers.csv"
        self.rows = [self.question("q1"), self.question("q2")]
        self.write_questions()

    def question(self, identifier):
        return {"id": identifier, "building_id": "b1", "kind": "floor_area_total",
                "question": identifier,
                "inputs": {"secret_oracle_parameter": "never pass to agent"},
                "answer": {"type": "number", "value": 7,
                           "relative_tolerance": 0, "absolute_tolerance": 0}}

    def write_questions(self):
        self.source.write_text("".join(json.dumps(row) + "\n" for row in self.rows))

    def run_fake(self, fn, **kwargs):
        with redirect_stdout(io.StringIO()):
            return run(self.split, self.source, self.output, answer_fn=fn, retry_delay=0, **kwargs)

    def test_loads_single_building_split_directory_and_test_csv(self):
        for buildings in (self.split, self.building):
            for source in (self.split, self.building, self.source):
                with self.subTest(buildings=buildings, source=source):
                    loaded = load_questions(buildings, source)
                    self.assertEqual([q.id for q in loaded], ["q1", "q2"])
                    self.assertTrue(all(q.directory == self.building for q in loaded))
        csv_path = self.root / "questions.csv"
        with csv_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=["question_id", "building_id", "kind", "question"])
            writer.writeheader()
            for row in self.rows:
                writer.writerow({"question_id": row["id"], **{key: row[key]
                    for key in ("building_id", "kind", "question")}})
        loaded = load_questions(self.split, csv_path)
        self.assertEqual([q.id for q in loaded], ["q1", "q2"])
        self.assertTrue(all(q.expected is None for q in loaded))

    def test_runs_concurrently_and_round_trips_multiline_replies_in_input_order(self):
        barrier = Barrier(2)
        reply = 'Details, "quoted", Größe\nAnswer: 7'

        def answer(directory, question):
            self.assertEqual(directory, self.building)
            self.assertIn(question, ("q1", "q2"))
            barrier.wait(timeout=5)  # Both workers must enter before either can finish.
            return reply

        results = self.run_fake(answer, workers=2)
        self.assertTrue(all(row["correct"] for row in results))
        with self.output.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            rows = list(reader)
            self.assertEqual(reader.fieldnames, ["question_id", "answer"])
        self.assertEqual([row["question_id"] for row in rows], ["q1", "q2"])
        self.assertEqual([row["answer"] for row in rows], [reply, reply])
        sidecar = [json.loads(line) for line in self.output.with_suffix(".jsonl").read_text().splitlines()]
        self.assertEqual(sidecar, results)

    def test_retries_rate_limits_and_connection_errors_with_backoff(self):
        request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
        rate_limit = anthropic.RateLimitError("rate limited", response=httpx2.Response(429, request=request), body=None)
        connection_error = anthropic.APIConnectionError(request=request)
        question = load_questions(self.split, self.source)[0]
        fn = Mock(side_effect=[rate_limit, connection_error, "Answer: 7"])
        with patch("agent.benchmark.time.sleep") as sleep, patch("agent.benchmark.random.uniform", return_value=0):
            result = answer_question(question, fn)
        self.assertTrue(result["correct"])
        self.assertIsNone(result["error"])
        self.assertEqual(result["attempts"], 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [1, 2])

    def test_exhausted_retries_preserve_failed_row_and_other_questions(self):
        calls = Counter()
        request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")

        def answer(directory, question):
            calls[question] += 1
            if question == "q1":
                raise anthropic.APIConnectionError(request=request)
            return "Answer: 7"

        results = self.run_fake(answer)
        self.assertEqual(calls, {"q1": 4, "q2": 1})
        self.assertEqual(results[0]["reply"], "")
        self.assertFalse(results[0]["correct"])
        self.assertEqual(results[0]["error"]["type"], "APIConnectionError")
        self.assertTrue(results[1]["correct"])
        with self.output.open(newline="") as handle:
            self.assertEqual(len(list(csv.DictReader(handle))), 2)

    def test_permanent_api_errors_are_not_retried_or_logged_with_response_bodies(self):
        request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
        error = anthropic.AuthenticationError("sensitive body", response=httpx2.Response(401, request=request), body=None)
        question = load_questions(self.split, self.source)[0]
        fn = Mock(side_effect=error)
        result = answer_question(question, fn, retry_delay=0)
        fn.assert_called_once_with(self.building, "q1")
        self.assertEqual(result["error"]["status_code"], 401)
        self.assertNotIn("sensitive body", json.dumps(result))

    def test_unknown_building_and_local_failure_keep_rows(self):
        self.rows[0]["building_id"] = "../../not-a-building"
        self.write_questions()
        fn = Mock(side_effect=RuntimeError("local failure"))
        results = self.run_fake(fn)
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["error"]["type"], "MissingBuilding")
        self.assertEqual(results[0]["attempts"], 0)
        self.assertEqual(results[1]["error"]["type"], "RuntimeError")
        fn.assert_called_once_with(self.building, "q2")

    def test_unscored_test_questions_and_scoring_errors_preserve_replies(self):
        self.rows[0].pop("answer")
        self.rows[1]["answer"] = {"type": "unknown"}
        self.write_questions()
        results = self.run_fake(lambda directory, question: "Answer: 7")
        self.assertIsNone(results[0]["correct"])
        self.assertIsNone(results[0]["scoring_error"])
        self.assertIsNone(results[1]["correct"])
        self.assertEqual(results[1]["scoring_error"]["type"], "ValueError")
        self.assertTrue(all(row["reply"] == "Answer: 7" for row in results))

    def test_duplicate_ids_invalid_options_and_input_overwrite_fail_before_calls(self):
        fn = Mock()
        for kwargs in ({"workers": 0}, {"retries": -1}, {"limit": 0}, {"per_kind": 0}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.run_fake(fn, **kwargs)
        with self.assertRaisesRegex(ValueError, "outside"):
            run(self.split, self.source, self.building / "answers.csv", answer_fn=fn)
        self.rows[1]["id"] = "q1"
        self.write_questions()
        with self.assertRaisesRegex(ValueError, "Duplicate question"):
            self.run_fake(fn)
        fn.assert_not_called()
        self.assertFalse(self.output.exists())

    def test_filters_are_reproducible(self):
        questions = load_questions(self.split, self.source)
        first = select_questions(questions, ["floor_area_total"], per_kind=1)
        self.assertEqual(first, select_questions(questions, ["floor_area_total"], per_kind=1))
        self.assertEqual(len(first), 1)
        with self.assertRaisesRegex(ValueError, "No questions"):
            select_questions(questions, ["nonexistent"])


if __name__ == "__main__":
    unittest.main()
