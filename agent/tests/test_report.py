"""Failure diagnoses use controlled local fixtures, not invented live results."""

from contextlib import redirect_stdout
from copy import deepcopy
import io
import json
from pathlib import Path
import unittest

from agent.report import analyze, check_extraction, diagnose, render
from core import Building
from agent.tests.test_tools import benchmark_call


ROOT = Path(__file__).resolve().parents[2]
FACTORY = ROOT / "data/dev/proc-factory-dev-003"


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.building = Building.load(FACTORY)
        q = next(json.loads(line) for line in (FACTORY / "questions.jsonl").read_text().splitlines()
                 if json.loads(line)["kind"] == "floor_area_total")
        result = self.building.total_area(q["inputs"]["floor_id"], q["inputs"]["room_type"])
        self.row = {**q, "building_directory": str(FACTORY), "reply": f"Answer: {result['total_m2']}",
                    "attempts": 1, "tool_calls": [{"name": "total_area", "arguments": {
                        "floor": "ground floor", "room_type": "meeting rooms"},
                        "result": result, "status": "ok", "attempt": 1}]}

    def test_correct_extraction_and_correct_answer(self):
        result = diagnose(self.row, self.building)
        self.assertTrue(result["correct"])
        self.assertTrue(result["extraction"]["correct"])
        self.assertTrue(result["tool_result_correct"])
        self.assertEqual(result["category"], "correct")

    def test_wrong_floor_is_extraction_even_if_answer_happens_to_be_correct(self):
        self.row["tool_calls"][0]["arguments"]["floor"] = "Floor 1"
        result = diagnose(self.row, self.building)
        self.assertTrue(result["correct"])
        self.assertFalse(result["extraction"]["correct"])
        self.assertEqual(result["category"], "extraction")

    def test_correct_tool_result_but_wrong_answer_is_rendering_not_core(self):
        self.row["reply"] = f"Answer: {self.row['tool_calls'][0]['result']['total_m2']} (7 rooms)"
        result = diagnose(self.row, self.building)
        self.assertEqual(result["category"], "answer_format")
        self.assertTrue(result["tool_result_correct"])

    def test_wrong_recorded_result_with_matching_args_is_tool_result_signal(self):
        self.row["tool_calls"][0]["result"]["total_m2"] = 99999
        self.row["reply"] = "Answer: 99999"
        result = diagnose(self.row, self.building)
        self.assertTrue(result["extraction"]["correct"])
        self.assertEqual(result["category"], "tool_result")

    def test_missing_old_traces_do_not_become_extraction_failures(self):
        self.row.pop("tool_calls")
        self.row["reply"] = "Answer: unavailable"
        result = diagnose(self.row, self.building)
        self.assertIsNone(result["extraction"]["correct"])
        self.assertEqual(result["category"], "unknown")
        self.row["answer"] = None
        self.assertEqual(diagnose(self.row)["category"], "unscored")

    def test_missing_building_and_retried_calls_are_not_misattributed(self):
        self.row["attempts"] = 2
        self.row["tool_calls"].append({**deepcopy(self.row["tool_calls"][0]), "attempt": 2})
        self.row["tool_calls"][0]["arguments"]["floor"] = "Floor 1"
        self.assertTrue(diagnose(self.row, self.building)["extraction"]["correct"])
        self.assertIsNone(diagnose(self.row)["extraction"]["correct"])

    def test_errors_and_prior_mutations_are_not_reported_as_core_math_errors(self):
        self.row["reply"] = "Answer: unavailable"
        self.row["tool_calls"][0].update(status="error", result="No room matches")
        self.assertEqual(diagnose(self.row, self.building)["category"], "tool_error")
        self.row["error"] = {"type": "APIConnectionError"}
        self.assertEqual(diagnose(self.row, self.building)["category"], "execution")
        self.row.pop("error")
        self.row["tool_calls"].insert(0, {"name": "set_closed", "attempt": 1})
        self.assertEqual(diagnose(self.row, self.building)["category"], "state_change")

    def test_api_failure_before_final_response_leaves_extraction_unknown(self):
        self.row.update(attempts=2, error={"type": "APIConnectionError"}, attempt_details=[
            {"attempt": 1, "responses": [{"stop_reason": "tool_use"}]},
            {"attempt": 2, "responses": []},
        ])
        result = diagnose(self.row, self.building)
        self.assertEqual(result["category"], "execution")
        self.assertIsNone(result["extraction"]["correct"])

    def test_all_nine_kind_argument_mappings_and_semantic_constraints(self):
        seen = set()
        for path in sorted((ROOT / "data/dev").glob("*/questions.jsonl")):
            b = Building.load(path.parent)
            for line in path.read_text().splitlines():
                q = json.loads(line)
                if q["kind"] in seen:
                    continue
                _, args = benchmark_call(q)
                with self.subTest(kind=q["kind"]):
                    self.assertTrue(check_extraction(q["kind"], args, q["inputs"], b)["correct"])
                    if q["kind"] in {"what_if_door", "straight_line_3d"}:
                        args["first_room"], args["second_room"] = args["second_room"], args["first_room"]
                        self.assertTrue(check_extraction(q["kind"], args, q["inputs"], b)["correct"])
                    if q["kind"] in {"errand", "wide_delivery_count", "step_free_reachable_count"}:
                        args["step_free"] = q["kind"] == "errand"
                        self.assertFalse(check_extraction(q["kind"], args, q["inputs"], b)["correct"])
                seen.add(q["kind"])
        self.assertEqual(len(seen), 9)

    def test_report_prints_failure_evidence_and_usage_coverage(self):
        self.row["reply"] = "Answer: unavailable"
        self.row["usage"] = {"input_tokens": 10, "output_tokens": 2}
        output = io.StringIO()
        with redirect_stdout(output):
            render(analyze([self.row]))
        text = output.getvalue()
        for term in ("answer_format", "Question:", "Tool (attempt 1):", "Expected:", "Reply:", "1/1 questions"):
            self.assertIn(term, text)


if __name__ == "__main__":
    unittest.main()
