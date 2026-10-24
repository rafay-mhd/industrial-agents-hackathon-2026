"""No-route behaviour test: for every warm-up question whose correct answer is "there is no route" (kit 1.1.0:
wings that only meet outside, or no step-free way), the chat agent must say so instead of inventing a route.

  uv run --frozen --env-file .env python tests/live_no_route.py data/train data/dev --out agent_output/livetest/no_route.jsonl"""

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
from core import Building

SAYS_NO = re.compile(r"\b(no|isn't|is not|there is no|not possible|cannot|can't|couldn't|could not|unable|unreachable|no way)\b", re.IGNORECASE)
GIVES_LENGTH = re.compile(r"\b\d+(\.\d+)?\s*(m|metres|meters)\b", re.IGNORECASE)


def unreachable_questions(split: Path):
    for path in sorted(split.glob("*/questions_basic.jsonl")):
        for line in path.open(encoding="utf-8"):
            if line.strip():
                question = json.loads(line)
                if question["answer"].get("reachable") is False:
                    yield path.parent, question


def run_one(client, building_dir, question, model, outdir):
    building = Building.load(building_dir)
    agent = BuildingAgent(building, outdir / question["id"], client=client, mode="chat", model=model)
    started, reply, error = time.perf_counter(), "", None
    try:
        reply = agent.ask(question["question"])
    except Exception as exc:  # noqa: BLE001
        error = f"{type(exc).__name__}: {exc}"
    says_no = bool(SAYS_NO.search(reply)) and "route" in reply.lower()
    invented = building.last_route is not None and not says_no   # a route was computed and presented as the answer
    return {"id": question["id"], "kind": question["kind"], "building": building_dir.name, "question": question["question"],
            "reply": reply, "says_no_route": says_no, "invented_route": invented,
            "tools": [c.get("name") for c in tool_calls(agent.messages)], "elapsed_s": round(time.perf_counter() - started, 2),
            "usage": dict(agent.usage), "error": error}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("splits", nargs="+", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--model", default="claude-sonnet-5-5")
    args = parser.parse_args()
    cases = [(split.name, b, q) for split in args.splits for b, q in unreachable_questions(split)]
    print(f"no-route questions: {len(cases)} ({Counter(s for s, _, _ in cases)})")
    client = anthropic.Anthropic()
    outdir = args.out.parent / (args.out.stem + "_traces"); outdir.mkdir(parents=True, exist_ok=True)
    rows = []
    with args.out.open("w", encoding="utf-8") as log, ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(run_one, client, b, q, args.model, outdir): s for s, b, q in cases}
        for future in as_completed(futures):
            row = future.result(); row["split"] = futures[future]; rows.append(row)
            log.write(json.dumps(row, ensure_ascii=False) + "\n")
    stats = defaultdict(Counter); usage = Counter()
    for row in rows:
        key = (row["split"], row["kind"]); stats[key]["total"] += 1
        stats[key]["said no route"] += row["says_no_route"]; stats[key]["invented"] += row["invented_route"]
        stats[key]["errors"] += bool(row["error"]); usage.update(row["usage"])
    print(f"\n{'split':6s} {'kind':20s} {'said no':>8s} {'invented':>9s} {'errors':>7s} {'total':>6s}")
    for key in sorted(stats):
        s = stats[key]; print(f"{key[0]:6s} {key[1]:20s} {s['said no route']:>8d} {s['invented']:>9d} {s['errors']:>7d} {s['total']:>6d}")
    said = sum(s["said no route"] for s in stats.values())
    print(f"{'all':6s} {'':20s} {said:>8d} {sum(s['invented'] for s in stats.values()):>9d} {sum(s['errors'] for s in stats.values()):>7d} {len(rows):>6d}   ({said / len(rows):.0%} said no route)")
    print("tokens:", dict(usage))
    for row in rows:
        if not row["says_no_route"]:
            print(f"\nDID NOT SAY NO: {row['id']} [{row['kind']}] tools={row['tools']}\n  Q: {row['question'][:150]}\n  A: {row['reply'][:300]!r}")


if __name__ == "__main__":
    main()
