"""Read benchmark JSONL without API calls: accuracy, extraction checks and failure evidence.

    python -m agent.report agent_output/benchmark/step5_dev_areas.jsonl

Old logs remain readable; missing traces or reference inputs are reported as unknown.
Diagnoses are evidence-based triage, not proof that a particular component is faulty.
"""

import argparse
from collections import Counter
import json
import math
from pathlib import Path

from benchmark.score import score_reply
from core import Building


TASK_TOOLS = {
    "floor_area_total": "total_area", "largest_room": "largest_room",
    "straight_line_3d": "straight_line_3d", "shared_walls_count": "shared_wall_rooms",
    "room_stacked": "stacked_room", "wide_delivery_count": "reachable_rooms",
    "step_free_reachable_count": "reachable_rooms", "errand": "errand", "what_if_door": "what_if_door",
}


def check_extraction(kind: str, args: dict, inputs: dict, building: Building) -> dict:
    """Normalize model arguments with Core's resolvers, without executing calculations."""
    if kind not in TASK_TOOLS:
        return {"correct": None, "details": [f"No extraction checker for {kind}"]}
    differences = []

    def compare(field, actual, expected):
        if isinstance(actual, float) and isinstance(expected, (int, float)):
            equal = math.isclose(actual, expected, rel_tol=0, abs_tol=1e-9)
        else:
            equal = actual == expected
        if not equal:
            differences.append(f"{field}: got {actual!r}, expected {expected!r}")

    try:
        if kind in {"floor_area_total", "largest_room", "wide_delivery_count",
                    "step_free_reachable_count", "errand", "what_if_door"}:
            compare("floor", building.resolve_floor(args["floor"]), inputs["floor_id"])
        if kind in {"floor_area_total", "largest_room", "errand"}:
            compare("room_type", building.normalize_room_type(args.get("room_type", "")), inputs["room_type"])
        if kind in {"wide_delivery_count", "step_free_reachable_count", "errand"}:
            compare("start", building.resolve_space(args["start"]), inputs["start"])
            compare("step_free", args.get("step_free", kind != "errand"), kind != "errand")
        if kind in {"wide_delivery_count", "step_free_reachable_count"}:
            compare("min_width_m", args.get("min_width_m"), inputs.get("min_width"))
            expected_closed = [inputs["closed"]] if "closed" in inputs else []
            compare("closed", sorted({building.find_element(item) for item in args.get("closed") or []}),
                    sorted(expected_closed))
        if kind == "errand":
            compare("item", building.normalize_asset_type(args["item"]), inputs["asset_type"])
        if kind in {"shared_walls_count", "room_stacked"}:
            compare("room", building.resolve_space(args["room"]), inputs["start"])
        if kind == "room_stacked":
            compare("direction", args["direction"], inputs["direction"])
        if kind in {"straight_line_3d", "what_if_door"}:
            # Endpoints are symmetric: reversing the two rooms is still correct.
            compare("rooms", sorted([building.resolve_space(args["first_room"]),
                                      building.resolve_space(args["second_room"])]),
                    sorted([inputs["first"], inputs["second"]]))
        if kind == "what_if_door":
            compare("threshold_m", args.get("threshold_m", 1.0), 1.0)
    except (ValueError, KeyError, TypeError) as exc:
        differences.append(f"Could not resolve arguments: {type(exc).__name__}: {exc}")
    return {"correct": not differences, "details": differences}


def result_answer(kind: str, result: dict) -> str:
    """Render the recorded tool output for the official scorer; do not recompute facts."""
    if kind == "largest_room":
        return f"Answer: {result['label']}, {result['area_m2']} m²"
    if kind == "room_stacked":
        return f"Answer: {result['label']}"
    field = {"floor_area_total": "total_m2", "straight_line_3d": "distance_m", "errand": "total_m"}.get(kind, "count")
    return f"Answer: {result[field]}"


def diagnose(row: dict, building: Building | None = None) -> dict:
    expected, kind = row.get("answer"), row["kind"]
    correct, scoring_error = None, row.get("scoring_error")
    if expected is not None:
        try:
            correct = score_reply(expected, row.get("reply", ""))
        except (ValueError, KeyError, TypeError) as exc:
            scoring_error = str(exc)
    attempt = row.get("attempts", 1)
    calls = [call for call in row.get("tool_calls", []) if call.get("attempt", attempt) == attempt]
    candidates = [call for call in calls if call.get("name") == TASK_TOOLS.get(kind)]
    call = candidates[-1] if candidates else None
    extraction = {"correct": None, "details": ["Tool trace or oracle inputs unavailable"]}
    final_responses = any(detail.get("responses") for detail in row.get("attempt_details", [])
                          if detail.get("attempt", attempt) == attempt)
    traced = bool(calls or final_responses)
    if kind in TASK_TOOLS and traced and call is None:
        extraction = {"correct": False, "details": [f"No {TASK_TOOLS[kind]} call in the final attempt"]}
    elif call is not None and row.get("inputs") is not None:
        if building is not None:
            extraction = check_extraction(kind, call.get("arguments", {}), row["inputs"], building)
        else:
            extraction = {"correct": None, "details": ["Building unavailable for reference resolution"]}

    tool_correct = None
    if call is not None and call.get("status") == "ok" and expected is not None:
        try:
            tool_correct = score_reply(expected, result_answer(kind, call["result"]))
        except (ValueError, KeyError, TypeError):
            pass

    changed_state = any(item.get("name") in {"set_closed", "add_door"} for item in calls)
    if row.get("error"):
        category = "execution"
    elif scoring_error:
        category = "scoring"
    elif correct is None:
        category = "unscored"
    elif extraction["correct"] is False:
        category = "extraction"  # Also flag lucky correct answers from mismatched inputs.
    elif correct:
        category = "correct"
    elif changed_state:
        category = "state_change"
    elif call is not None and call.get("status") == "error":
        category = "tool_error"
    elif tool_correct is True:
        category = "answer_format"
    elif extraction["correct"] is True and tool_correct is False:
        category = "tool_result"
    else:
        category = "unknown"
    return {"correct": correct, "extraction": extraction, "tool_result_correct": tool_correct,
            "category": category, "scoring_error": scoring_error}


def load_results(path: Path) -> list[dict]:
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or not all(key in row for key in ("id", "kind", "question", "reply")):
            raise ValueError("Each result needs id, kind, question, and reply")
        if row["id"] in seen:
            raise ValueError(f"Duplicate result id: {row['id']}")
        seen.add(row["id"])
    if not rows:
        raise ValueError("No result records found")
    return rows


def analyze(rows: list[dict], data: Path | None = None) -> list[dict]:
    buildings = {}
    analyzed = []
    for row in rows:
        building = None
        if row.get("tool_calls") and row.get("inputs") is not None:
            directory = Path(row["building_directory"]) if row.get("building_directory") else None
            if data is not None:
                directory = data if (data / "building.json").is_file() else data / row.get("building_id", "")
            if directory is not None:
                if directory not in buildings:
                    try:
                        buildings[directory] = Building.load(directory)
                    except (OSError, ValueError, KeyError, TypeError):
                        buildings[directory] = None
                building = buildings[directory]
        analyzed.append({**row, "diagnosis": diagnose(row, building)})
    return analyzed


def render(rows: list[dict], failure_limit: int | None = None) -> None:
    print("kind                      answers correct/scored    extraction correct/checked    unknown")
    for kind in sorted({row["kind"] for row in rows}):
        diagnoses = [row["diagnosis"] for row in rows if row["kind"] == kind]
        scored = [d["correct"] for d in diagnoses if d["correct"] is not None]
        extracted = [d["extraction"]["correct"] for d in diagnoses if d["extraction"]["correct"] is not None]
        answer_score = f"{sum(scored)}/{len(scored)} ({sum(scored)/len(scored):.1%})" if scored else "unscored"
        print(f"{kind:25s} {answer_score:>22s} {str(sum(extracted)) + '/' + str(len(extracted)):>29s} "
              f"{len(diagnoses)-len(extracted):10d}")
    scored = [row["diagnosis"]["correct"] for row in rows if row["diagnosis"]["correct"] is not None]
    if scored:
        print(f"Total: {sum(scored)}/{len(scored)} correct ({sum(scored)/len(scored):.1%})")
    print("Categories:", dict(Counter(row["diagnosis"]["category"] for row in rows)))
    usage = Counter()
    recorded = 0
    for row in rows:
        if row.get("usage"):
            recorded += 1
            usage.update(row["usage"])
    print(f"Token usage recorded for {recorded}/{len(rows)} questions (including retries): {dict(usage)}")
    print("Missing traces/usage are unknown, not zero. Tokens are not a billing estimate.")

    failures = [row for row in rows if row["diagnosis"]["category"] not in {"correct", "unscored"}]
    for row in failures if failure_limit is None else failures[:failure_limit]:
        diagnosis = row["diagnosis"]
        print(f"\n{row['id']} [{row['kind']}] — {diagnosis['category']}")
        print("Question:", row["question"])
        print("Extraction:", json.dumps(diagnosis["extraction"], ensure_ascii=False))
        for call in row.get("tool_calls", []):
            print(f"Tool (attempt {call.get('attempt', '?')}):", call.get("name"),
                  json.dumps(call.get("arguments"), ensure_ascii=False))
            print("Tool result:", call.get("status"), json.dumps(call.get("result"), ensure_ascii=False))
        if not row.get("tool_calls"):
            print("Tool calls: unavailable in this log")
        print("Reply:", row["reply"])
        print("Expected:", json.dumps(row.get("answer"), ensure_ascii=False))
        if row.get("error") or diagnosis["scoring_error"]:
            print("Error:", row.get("error") or diagnosis["scoring_error"])
    if failure_limit is not None and len(failures) > failure_limit:
        print(f"\nShowing {failure_limit}/{len(failures)} failures; omit --failures to show all.")
    if any(row["diagnosis"]["category"] == "tool_result" for row in rows):
        print("\nTool-result mismatch with matching arguments: review Core/tool output; this is a triage signal.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("results", type=Path)
    parser.add_argument("--data", type=Path, help="Override building root if logs came from another checkout")
    parser.add_argument("--failures", type=int, help="Limit printed failures (default: all)")
    args = parser.parse_args()
    if args.failures is not None and args.failures < 0:
        parser.error("--failures must be nonnegative")
    try:
        rows = analyze(load_results(args.results), args.data)
        render(rows, args.failures)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
