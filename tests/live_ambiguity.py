"""Ambiguity behaviour test: when a question names a room that exists several times on the same floor, the chat
agent must ask which one is meant instead of guessing. Costs credits (one chat turn per ambiguous question).

  uv run --frozen --env-file .env python tests/live_ambiguity.py data/train data/dev --out agent_output/livetest/ambiguity.jsonl

Step 1 (free): scan every question in the given splits; a question is ambiguous when the core's resolver says
"matches several places" for one of its 'Room (Floor n)' mentions. Step 2 (live): send only those questions to
the chat agent. Success = the reply asks a clarifying question and does not commit to a route or an answer."""

from __future__ import annotations

import argparse
import json
import re
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import anthropic

from agent.agent import BuildingAgent
from agent.diagnostics import tool_calls
from core import Building, MapError
from core.check_questions import MENTION, resolve_mention

ASKS = re.compile(r"\b(which|clarif|do you mean|can you tell me|could you tell me|please (tell|specify|pick))", re.IGNORECASE)
COMMITS = re.compile(r"(Answer:|\d+(\.\d+)?\s*m\b|\d+(\.\d+)?\s*metres)", re.IGNORECASE)


def find_ambiguous(split: Path) -> list[tuple[Path, dict, list[str]]]:
    found = []
    for building_dir in sorted(p for p in split.iterdir() if p.is_dir()):
        building = None
        for filename in ("questions.jsonl", "questions_basic.jsonl"):
            path = building_dir / filename
            if not path.exists():
                continue
            for line in path.open(encoding="utf-8"):
                if not line.strip():
                    continue
                question = json.loads(line)
                ambiguous = []
                for match in MENTION.finditer(question["question"]):
                    building = building or Building.load(building_dir)
                    resolved, error = resolve_mention(building, match.group(1).split(), match.group(2))
                    if resolved is None and "several" in error:
                        ambiguous.append(match.group(0))
                if ambiguous:
                    found.append((building_dir, question, ambiguous))
    return found


def run_one(client, building_dir: Path, question: dict, mentions: list[str], model: str, outdir: Path) -> dict:
    building = Building.load(building_dir)
    agent = BuildingAgent(building, outdir / question["id"], client=client, mode="chat", model=model)
    started, reply, error = time.perf_counter(), "", None
    try:
        reply = agent.ask(question["question"])
    except Exception as exc:  # noqa: BLE001
        error = f"{type(exc).__name__}: {exc}"
    asked = bool(ASKS.search(reply)) and "?" in reply
    committed = bool(COMMITS.search(reply)) and not asked
    return {"id": question["id"], "kind": question["kind"], "building": building_dir.name, "ambiguous_mentions": mentions,
            "question": question["question"], "reply": reply, "asked": asked, "committed_anyway": committed,
            "tools": [c.get("name") for c in tool_calls(agent.messages)], "elapsed_s": round(time.perf_counter() - started, 2),
            "usage": dict(agent.usage), "error": error}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("splits", nargs="+", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--model", default="claude-sonnet-5-5")
    parser.add_argument("--dry-run", action="store_true", help="only list the ambiguous questions, no API calls")
    args = parser.parse_args()
    cases = [(split.name, *item) for split in args.splits for item in find_ambiguous(split)]
    print(f"ambiguous questions found: {len(cases)}")
    for split, building_dir, question, mentions in cases:
        print(f"  {split:5s} {question['id']:30s} {question['kind']:20s} {mentions}")
    if args.dry_run or not cases:
        return
    client = anthropic.Anthropic()
    outdir = args.out.parent / (args.out.stem + "_traces")
    outdir.mkdir(parents=True, exist_ok=True)
    rows = []
    with args.out.open("w", encoding="utf-8") as log, ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(run_one, client, b, q, m, args.model, outdir): s for s, b, q, m in cases}
        for future in as_completed(futures):
            row = future.result()
            row["split"] = futures[future]
            rows.append(row)
            log.write(json.dumps(row, ensure_ascii=False) + "\n")
    stats = defaultdict(Counter)
    usage = Counter()
    for row in rows:
        key = (row["split"], row["kind"])
        stats[key]["total"] += 1
        stats[key]["asked"] += row["asked"]
        stats[key]["guessed"] += row["committed_anyway"]
        usage.update(row["usage"])
    print(f"\n{'split':6s} {'kind':20s} {'asked':>6s} {'guessed':>8s} {'total':>6s}")
    for (split, kind) in sorted(stats):
        s = stats[(split, kind)]
        print(f"{split:6s} {kind:20s} {s['asked']:>6d} {s['guessed']:>8d} {s['total']:>6d}")
    asked = sum(s["asked"] for s in stats.values())
    print(f"{'all':6s} {'':20s} {asked:>6d} {sum(s['guessed'] for s in stats.values()):>8d} {len(rows):>6d}   ({asked / len(rows):.0%} asked)")
    print("tokens:", dict(usage))
    for row in rows:
        if not row["asked"]:
            print(f"\nDID NOT ASK: {row['id']} [{row['kind']}] tools={row['tools']}\n  Q: {row['question'][:150]}\n  A: {row['reply'][:300]!r}")


if __name__ == "__main__":
    main()
