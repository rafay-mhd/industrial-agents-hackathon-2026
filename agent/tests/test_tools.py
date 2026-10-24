"""Check tool argument mapping, truthful summaries, errors and real building mutations."""

from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from anthropic.lib.tools import ToolError

from agent.tools import as_json, make_tools
from benchmark.score import score_reply
from core import Building


ROOT = Path(__file__).resolve().parents[2]
FACTORY = ROOT / "data/dev/proc-factory-dev-003"


def benchmark_call(question):
    """Ground-truth inputs are used only in these offline wrapper checks."""
    i, kind = question["inputs"], question["kind"]
    if kind in {"floor_area_total", "largest_room"}:
        return ("total_area" if kind == "floor_area_total" else kind,
                {"floor": i["floor_id"], "room_type": i["room_type"]})
    if kind == "straight_line_3d":
        return kind, {"first_room": i["first"], "second_room": i["second"]}
    if kind == "shared_walls_count":
        return "shared_wall_rooms", {"room": i["start"]}
    if kind == "room_stacked":
        return "stacked_room", {"room": i["start"], "direction": i["direction"]}
    if kind in {"wide_delivery_count", "step_free_reachable_count"}:
        args = {"start": i["start"], "floor": i["floor_id"]}
        args.update({"min_width_m": i["min_width"]} if kind == "wide_delivery_count" else {"closed": [i["closed"]]})
        return "reachable_rooms", args
    if kind == "errand":
        return kind, {"start": i["start"], "item": i["asset_type"], "floor": i["floor_id"], "room_type": i["room_type"]}
    if kind == "what_if_door":
        return kind, {"first_room": i["first"], "second_room": i["second"], "floor": i["floor_id"]}
    raise AssertionError(kind)


def answer_line(kind, result):
    if kind == "largest_room":
        return f"Answer: {result['label']}, {result['area_m2']} m²"
    if kind == "room_stacked":
        return f"Answer: {result['label']}"
    field = {"floor_area_total": "total_m2", "straight_line_3d": "distance_m", "errand": "total_m"}.get(kind, "count")
    return f"Answer: {result[field]}"


class ToolTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name)
        self.building = Building.load(FACTORY)
        self.tools = {tool.name: tool for tool in make_tools(self.building, self.output)}

    def call(self, name, **args):
        return json.loads(self.tools[name].call(args))

    def test_registered_schemas_and_human_floor_and_type_words(self):
        self.assertEqual(len(self.tools), 25)
        for tool in self.tools.values():
            schema = tool.to_dict()
            self.assertEqual(schema["name"], tool.name)
            self.assertTrue(schema["description"])
            self.assertEqual(schema["input_schema"]["type"], "object")
        result = self.call("total_area", floor="ground floor", room_type="meeting rooms")
        self.assertEqual(result["total_m2"], self.building.total_area(0, "meeting_room")["total_m2"])
        self.assertEqual(next(iter(result)), "total_m2")
        floor = self.call("resolve_floor", floor=0)
        self.assertEqual(floor["floor_id"], self.building.resolve_floor("ground floor"))

    def test_all_dev_benchmark_kinds_through_serialized_tool_boundary(self):
        tested = 0
        for path in sorted((ROOT / "data/dev").glob("*/questions.jsonl")):
            b = Building.load(path.parent)
            tools = {tool.name: tool for tool in make_tools(b, self.output)}
            for line in path.read_text().splitlines():
                q = json.loads(line)
                name, args = benchmark_call(q)
                before = set(b.closed)
                with self.subTest(question=q["id"]):
                    result = json.loads(tools[name].call(args))
                    self.assertTrue(score_reply(q["answer"], answer_line(q["kind"], result)))
                    self.assertEqual(b.closed, before)
                tested += 1
        self.assertEqual(tested, 138)

    def test_large_lists_keep_full_totals_and_do_not_mutate_core_results(self):
        data = {"total_m2": 1234.5, "count": 45, "rooms": [{"name": str(i)} for i in range(45)]}
        original = deepcopy(data)
        with patch.object(self.building, "total_area", return_value=data):
            result = self.call("total_area", floor=0, room_type="office")
        self.assertEqual(data, original)
        self.assertEqual(result["total_m2"], 1234.5)
        self.assertEqual(result["count"], 45)
        self.assertEqual(len(result["rooms"]), 20)
        self.assertEqual(result["rooms_total"], 45)
        self.assertTrue(result["rooms_truncated"])
        # A shortened path would be misleading; directions, coordinates and vocabularies stay whole.
        long = {"floors": {"0": [[i, i] for i in range(30)]}, "steps": [str(i) for i in range(30)],
                "room_types": [str(i) for i in range(30)]}
        self.assertEqual(json.loads(as_json(long)), long)
        self.assertEqual(json.loads(as_json({"before_m": float("inf")}))["before_m"], "inf")

    def test_errors_include_core_candidates_and_unavailable_methods(self):
        with self.assertRaisesRegex(ToolError, "No place"):
            self.call("area_m2", room="nonexistent room 9999")
        for replacement in (None,):
            with patch.object(self.building, "total_area", replacement):
                with self.assertRaisesRegex(ToolError, "not available yet"):
                    self.call("total_area", floor=0, room_type="office")
        with patch.object(self.building, "total_area", side_effect=NotImplementedError):
            with self.assertRaisesRegex(ToolError, "not available yet"):
                self.call("total_area", floor=0, room_type="office")

    def test_starter_search_routes_closures_and_full_geometry_still_work(self):
        self.assertTrue(self.call("search_building", query="cnc")["results"])
        q = next(json.loads(line) for line in (FACTORY / "questions_basic.jsonl").read_text().splitlines()
                 if json.loads(line)["kind"] == "route")
        expected = q["answer"]
        result = self.call("find_route", start=expected["from_space_id"], destination=expected["to_space_id"])
        self.assertAlmostEqual(result["length_m"], expected["optimal_length_m"], delta=0.02)
        self.assertEqual(self.call("route_geometry"), self.building.route_geometry())
        connector = next(iter(self.building.connectors))
        self.call("set_closed", element=connector, closed=True)
        self.assertIn(connector, self.building.closed)
        self.call("set_closed", element=connector, closed=False)
        self.assertNotIn(connector, self.building.closed)

    def test_hypothetical_door_is_not_persistent_but_add_door_is(self):
        q = next(json.loads(line) for path in sorted((ROOT / "data/dev").glob("*/questions.jsonl"))
                 for line in path.read_text().splitlines() if json.loads(line)["kind"] == "what_if_door")
        b = Building.load(ROOT / "data/dev" / q["building_id"])
        tools = {tool.name: tool for tool in make_tools(b, self.output)}
        data = deepcopy(b.data)
        name, args = benchmark_call(q)
        tools[name].call(args)
        self.assertEqual(b.data, data)
        result = json.loads(tools["add_door"].call({"first_space": args["first_room"], "second_space": args["second_room"]}))
        self.assertEqual(len(b.openings), len(data["openings"]) + 1)
        self.assertIn(result["added"]["id"], b.openings)
        self.assertTrue((self.output / "building_edited.json").is_file())


if __name__ == "__main__":
    unittest.main()
