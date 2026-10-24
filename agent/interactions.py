"""Live conversational regression CLI; invokes the actual server through its ASGI test transport.

uv run --env-file .env python -m agent.interactions --out agent_output/interactions/after.jsonl
These are team checks, not an official interaction score. Requires Claude API credits.
"""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
from uuid import uuid4

from fastapi.testclient import TestClient

from agent.diagnostics import tool_calls
from agent.interaction_cases import CASES
from agent.prompts import CHAT_PROMPT
from agent.server import ROOT, create_app


def check_turn(turn, body, calls, building):
    failures = []
    text = body['reply'] + ' ' + (body['understood'] or '')
    if building.data['building']['id'] in text:
        failures.append('raw building/element ID in user-facing reply')
    if body['needs_clarification'] and body['reply'].count('?') > 1:
        failures.append('more than one clarification question')
    if 'clarify' in turn and body['needs_clarification'] != turn['clarify']:
        failures.append('clarification flag differs from expected')
    routes = [c for c in calls if c['name'] == 'find_route' and c['status'] == 'ok']
    if turn.get('no_route') and routes:
        failures.append('unexpected successful route')
    if 'start' in turn:
        if not routes:
            failures.append('missing successful route')
        else:
            result = routes[-1]['result']
            if result['start_space_id'] != building.resolve_space(turn['start']):
                failures.append('wrong remembered start')
            if result['destination_space_id'] != building.resolve_space(turn['dest']):
                failures.append('wrong destination')
            if turn.get('step_free') and not result['step_free']:
                failures.append('forgot accessibility constraint')
            if turn.get('via'):
                refs = routes[-1]['arguments'].get('via') or []
                if [building.resolve_space(r) for r in refs] != [building.resolve_space(r) for r in turn['via']]:
                    failures.append('missing/reordered tour stops')
                # Per-leg facts need tool evidence, not model arithmetic or guesses.
                if not result.get('legs') and len(routes) < len(turn['via']) + 1:
                    failures.append('no per-leg distance evidence')
    if 'closed' in turn and building.find_element(turn['closed']) not in building.closed:
        failures.append('closure not applied')
    if turn.get('reopened') and building.closed:
        failures.append('reopening not applied')
    if turn.get('door'):
        edits = [c for c in calls if c['name'] == 'add_door' and c['status'] == 'ok']
        if not edits:
            failures.append('missing door edit')
        if not edits or not edits[-1]['result'].get('impact'):
            # Baseline can also prove impact using a route before and after the edit.
            names = [c['name'] for c in calls if c['status'] == 'ok']
            if not ('add_door' in names and 'find_route' in names[:names.index('add_door')]
                    and 'find_route' in names[names.index('add_door')+1:]):
                failures.append('no before/after route impact evidence')
    if 'area' in turn:
        area = building.area_m2(turn['area'])
        numbers = [float(n) for n in re.findall(r'\d+(?:\.\d+)?',body['reply'])]
        if not any(abs(n-area) < .02 for n in numbers):
            failures.append('missing correct area')
    return failures


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--cases', nargs='+', choices=[c['id'] for c in CASES])
    args = parser.parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    app = create_app(ROOT/'data/dev', args.out.parent/'sessions')
    counts = Counter()
    with args.out.open('x', encoding='utf-8') as output, TestClient(app) as client:
        for case in CASES:
            if args.cases and case['id'] not in args.cases:
                continue
            sid = uuid4().hex
            for index, turn in enumerate(case['turns'], 1):
                previous = app.state.sessions.get((case['building'], sid))
                start = len(previous.agent.messages) if previous else 0
                response_start = len(previous.agent.responses) if previous else 0
                response = client.post(f"/buildings/{case['building']}/chat", json=dict(session_id=sid,message=turn['message']))
                body = response.json()
                session = app.state.sessions.get((case['building'], sid))
                calls = tool_calls(session.agent.messages[start:]) if session else []
                failures = check_turn(turn,body,calls,session.agent.map) if response.status_code == 200 else [f'HTTP {response.status_code}']
                record = dict(case=case['id'],turn=index,building_id=case['building'],message=turn['message'],
                              response=body,tool_calls=calls,failures=failures,
                              usage_total=dict(session.agent.usage) if session else {},
                              requested_model=session.agent.model if session else None,
                              responses=session.agent.responses[response_start:] if session else [],
                              prompt_sha256=hashlib.sha256(CHAT_PROMPT.encode()).hexdigest(),
                              context=vars(session.agent.context) if session and hasattr(session.agent,'context') else None)
                output.write(json.dumps(record,ensure_ascii=False)+'\n'); output.flush()
                counts['turns'] += 1; counts['passed'] += not failures
                print(f"{case['id']} {index}: {'PASS' if not failures else failures}",flush=True)
    print(dict(counts))
    if counts['passed'] != counts['turns']:
        raise SystemExit(1)


if __name__=='__main__':
    main()
