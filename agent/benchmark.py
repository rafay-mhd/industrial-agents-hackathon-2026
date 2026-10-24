"""Run independent building questions concurrently and save every result.

Examples (load API credentials with uv's --env-file .env):
    python -m agent.benchmark data/dev data/dev --out agent_output/dev.csv
    python -m agent.benchmark data/test data/test/questions.csv --out submissions/test.csv

The JSONL sidecar uses the official evaluator's id/kind/question/answer/reply/
correct fields, plus attempts, elapsed time, building id, and error details.
"""

import argparse
from collections import defaultdict
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
import csv
from dataclasses import dataclass
import json
from pathlib import Path
import random
import time

import anthropic

from benchmark.score import score_reply

AnswerFunction = Callable[[Path, str], str]


@dataclass(frozen=True)
class Question:
    id: str
    building_id: str
    kind: str
    text: str
    directory: Path | None
    expected: dict | None = None


def load_questions(buildings: Path, source: Path) -> list[Question]:
    """Validate question identities before calls; resolve buildings by metadata id."""
    if not buildings.is_dir():
        raise ValueError(f"Building/split directory does not exist: {buildings}")
    maps = [buildings / "building.json"] if (buildings / "building.json").is_file() else sorted(
        buildings.glob("*/building.json")
    )
    if not maps:
        raise ValueError(f"No building.json files found in {buildings}")
    index: dict[str, Path] = {}
    for path in maps:
        identifier = json.loads(path.read_text(encoding="utf-8"))["building"]["id"]
        if identifier in index:
            raise ValueError(f"Duplicate building id: {identifier}")
        index[identifier] = path.parent

    if source.is_dir():
        files = [source / "questions.jsonl"] if (source / "questions.jsonl").is_file() else sorted(
            source.glob("*/questions.jsonl")
        )
    else:
        files = [source]
    questions = []
    seen = set()
    for path in files:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            if path.suffix.lower() == ".csv":
                records = list(csv.DictReader(handle))
            elif path.suffix.lower() == ".jsonl":
                records = [json.loads(line) for line in handle if line.strip()]
            else:
                raise ValueError(f"Expected JSONL or CSV questions: {path}")
        for row in records:
            if not isinstance(row, dict):
                raise ValueError(f"Question must be an object in {path}")
            identifier = row.get("id") or row.get("question_id")
            values = (identifier, row.get("building_id"), row.get("kind"), row.get("question"))
            if not all(isinstance(value, str) and value.strip() for value in values):
                raise ValueError(f"Question requires id, building_id, kind, and question in {path}")
            if identifier in seen:
                raise ValueError(f"Duplicate question id: {identifier}")
            seen.add(identifier)
            expected = row.get("answer")
            if isinstance(expected, str):
                expected = json.loads(expected) if expected.strip() else None
            if expected is not None and not isinstance(expected, dict):
                raise ValueError(f"Expected answer must be a JSON object: {identifier}")
            questions.append(Question(
                identifier, row["building_id"], row["kind"], row["question"],
                index.get(row["building_id"]), expected,
            ))
    if not questions:
        raise ValueError(f"No questions found in {source}")
    return questions


def select_questions(
    questions: list[Question], kinds: list[str] | None = None,
    per_kind: int | None = None, limit: int | None = None,
) -> list[Question]:
    selected = [q for q in questions if not kinds or q.kind in kinds]
    if per_kind is not None:
        groups = defaultdict(list)
        for question in selected:
            groups[question.kind].append(question)
        rng = random.Random(7)
        selected = [q for kind in sorted(groups)
                    for q in rng.sample(groups[kind], min(per_kind, len(groups[kind])))]
    if limit is not None:
        selected = selected[:limit]
    if not selected:
        raise ValueError("No questions match the requested filters")
    return selected


def _retryable(error: Exception) -> bool:
    if isinstance(error, anthropic.APIStatusError):
        return error.status_code in {408, 409, 429} or error.status_code >= 500
    return isinstance(error, anthropic.APIError)


def _error_details(error: Exception) -> dict:
    # API error bodies are not needed in saved diagnostics (nor are request headers).
    if isinstance(error, anthropic.APIError):
        details = {"type": type(error).__name__, "message": "Anthropic request failed"}
        if isinstance(error, anthropic.APIStatusError):
            details["status_code"] = error.status_code
        return details
    return {"type": type(error).__name__, "message": str(error)[:500]}


def answer_question(
    question: Question, answer_fn: AnswerFunction, retries: int = 3, retry_delay: float = 1.0,
) -> dict:
    """Keep one result even on failure; never pass reference answers to the agent."""
    started = time.monotonic()
    reply, error, attempts = "", None, 0
    if question.directory is None:
        error = {"type": "MissingBuilding", "message": f"Unknown building id: {question.building_id}"}
    else:
        for attempt in range(retries + 1):
            attempts += 1
            try:
                response = answer_fn(question.directory, question.text)
                if not isinstance(response, str):
                    raise TypeError("answer() must return a string")
                reply = response
                if not reply.strip():
                    raise ValueError("answer() returned an empty reply")
                error = None
                break
            except Exception as exc:
                error = _error_details(exc)
                if attempt >= retries or not _retryable(exc):
                    break
                delay = min(30.0, retry_delay * 2 ** attempt)
                if delay:
                    delay += random.uniform(0, min(0.25, delay))
                time.sleep(delay)

    correct, scoring_error = None, None
    if question.expected is not None:
        try:
            correct = score_reply(question.expected, reply)
        except Exception as exc:
            scoring_error = _error_details(exc)
    return {
        "id": question.id, "building_id": question.building_id, "kind": question.kind,
        "question": question.text, "answer": question.expected, "reply": reply,
        "correct": correct, "attempts": attempts,
        "elapsed_s": round(time.monotonic() - started, 3),
        "error": error, "scoring_error": scoring_error,
    }


def report(results: list[dict]) -> None:
    print("\nkind                      correct / scored    saved    errors")
    for kind in sorted({row["kind"] for row in results}):
        rows = [row for row in results if row["kind"] == kind]
        scored = [row for row in rows if row["correct"] is not None]
        errors = sum(bool(row["error"] or row["scoring_error"]) for row in rows)
        score = f"{sum(row['correct'] for row in scored)} / {len(scored)}" if scored else "unscored"
        print(f"{kind:25s} {score:>16s} {len(rows):8d} {errors:9d}")
    scored = [row for row in results if row["correct"] is not None]
    if scored:
        correct = sum(row["correct"] for row in scored)
        print(f"Total scored: {correct}/{len(scored)} ({correct / len(scored):.1%})")
    else:
        print("No reference answers available; replies saved without accuracy scoring.")


def run(
    buildings: Path, source: Path, output: Path, *, workers: int = 4, retries: int = 3,
    retry_delay: float = 1.0, kinds: list[str] | None = None,
    per_kind: int | None = None, limit: int | None = None,
    answer_fn: AnswerFunction | None = None,
) -> list[dict]:
    if workers < 1 or retries < 0 or retry_delay < 0:
        raise ValueError("workers must be positive; retries and retry_delay must be nonnegative")
    if any(value is not None and value < 1 for value in (per_kind, limit)):
        raise ValueError("per_kind and limit must be positive")
    if output.suffix.lower() != ".csv":
        raise ValueError("Output filename must end in .csv")
    sidecar = output.with_suffix(".jsonl")
    for target in (output, sidecar):
        resolved = target.resolve()
        if resolved == source.resolve() or resolved.is_relative_to(buildings.resolve()) or (
            source.is_dir() and resolved.is_relative_to(source.resolve())
        ):
            raise ValueError("Output must be outside the input building/question data")
    questions = select_questions(load_questions(buildings, source), kinds, per_kind, limit)
    if answer_fn is None:
        from agent.answer import answer
        answer_fn = answer

    output.parent.mkdir(parents=True, exist_ok=True)
    results = []
    with output.open("w", encoding="utf-8", newline="") as csv_file, sidecar.open(
        "w", encoding="utf-8"
    ) as jsonl_file, ThreadPoolExecutor(max_workers=workers) as pool:
        writer = csv.writer(csv_file)
        writer.writerow(["question_id", "answer"])
        csv_file.flush()

        def solve(question: Question) -> dict:
            return answer_question(question, answer_fn, retries, retry_delay)

        # map computes concurrently but yields in input order for reproducible files.
        for result in pool.map(solve, questions):
            results.append(result)
            writer.writerow([result["id"], result["reply"]])
            jsonl_file.write(json.dumps(result, ensure_ascii=False) + "\n")
            csv_file.flush()
            jsonl_file.flush()
            status = "ERROR" if result["error"] or result["scoring_error"] else {
                True: "OK", False: "BAD", None: "saved",
            }[result["correct"]]
            print(f"[{len(results)}/{len(questions)}] {result['id']} {status} "
                  f"({result['attempts']} attempts)", flush=True)

    report(results)
    print(f"Saved {len(results)} answers to {output}; diagnostics: {sidecar}")
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("buildings", type=Path, help="One building directory or a split directory")
    parser.add_argument("questions", type=Path, help="JSONL/CSV file or directory containing questions.jsonl files")
    parser.add_argument("--out", required=True, type=Path, help="Submission CSV; a .jsonl sidecar is also written")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--retries", type=int, default=3, help="Retries after the initial attempt (default: 3)")
    parser.add_argument("--kinds", nargs="+")
    parser.add_argument("--per-kind", type=int)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    try:
        results = run(args.buildings, args.questions, args.out, workers=args.workers, retries=args.retries,
                      kinds=args.kinds, per_kind=args.per_kind, limit=args.limit)
    except (OSError, ValueError, KeyError) as exc:
        parser.error(str(exc))
    if any(row["error"] or row["scoring_error"] for row in results):
        raise SystemExit(1)  # Files still contain every selected question.


if __name__ == "__main__":
    main()
