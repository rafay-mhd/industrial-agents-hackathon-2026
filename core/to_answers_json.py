"""Convert a benchmark CSV (question_id,answer) into the organizers' answers.json.

The output is a JSON list of {"question_id": ..., "answer": ...}, one entry per CSV row, in CSV order.
Usage: uv run --frozen python -m core.to_answers_json <answers.csv> <answers.json>
"""
import csv
import json
import sys
from pathlib import Path


def convert(csv_path: str, json_path: str) -> list[dict]:
    with Path(csv_path).open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    answers = [{"question_id": row["question_id"], "answer": row["answer"]} for row in rows]
    Path(json_path).write_text(json.dumps(answers, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return answers


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    result = convert(sys.argv[1], sys.argv[2])
    ids = [entry["question_id"] for entry in result]
    print(f"wrote {len(result)} answers ({len(set(ids))} unique ids) to {sys.argv[2]}")
