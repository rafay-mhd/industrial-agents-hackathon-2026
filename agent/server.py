"""Local demo API. Run with one worker: uv run --env-file .env uvicorn agent.server:app --port 8000."""

from copy import deepcopy
from dataclasses import dataclass, field
from importlib import import_module
import json
import logging
import os
from pathlib import Path
from threading import Lock
from uuid import uuid4

import anthropic
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator

from agent.agent import BuildingAgent
from agent.answer import _get_client
from agent.chat_tools import chat_tools
from core import Building

ROOT = Path(__file__).resolve().parents[1]
log = logging.getLogger(__name__)


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    session_id: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=12000)

    @field_validator('session_id', 'message')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('Must not be blank')
        return value


class ChatResponse(BaseModel):
    reply: str
    understood: str | None
    needs_clarification: bool
    actions: list[dict]


def parse_reply(text: str) -> tuple[str, str | None, bool]:
    lines = text.strip().splitlines()
    if not lines:
        return '', None, False
    prefix, separator, value = lines[0].partition(':')
    if separator and prefix.strip().lower() == 'understood':
        return '\n'.join(lines[1:]).strip(), value.strip() or None, False
    if separator and prefix.strip().lower() == 'clarification':
        return '\n'.join([value.strip(), *lines[1:]]).strip(), None, True
    return text.strip(), None, False


class Catalog:
    def __init__(self, directory: Path):
        self.lock = Lock()
        self.data = {}
        files = ([directory / 'building.json'] if (directory / 'building.json').is_file()
                 else sorted(set(directory.glob('*/building.json')) | set(directory.glob('*/*/building.json'))))
        if not files:
            raise ValueError(f'No building files in {directory}')
        for path in files:
            data = json.loads(path.read_text(encoding='utf-8'))
            self.add_data(data)

    def add_data(self, data: dict):
        identifier = data['building']['id']
        with self.lock:
            if identifier in self.data:
                raise ValueError(f'Building ID already registered: {identifier}')
            self.data[identifier] = deepcopy(data)

    def get(self, identifier: str) -> dict:
        with self.lock:
            if identifier not in self.data:
                raise HTTPException(404, 'Unknown building')
            return deepcopy(self.data[identifier])

    def listing(self):
        with self.lock:
            return [dict(id=b['building']['id'], name=b['building']['name'], source=b['building']['source'],
                         floors=[dict(level=f['level'], name=f['name']) for f in b['floors']])
                    for _, b in sorted(self.data.items())]


@dataclass
class Session:
    agent: BuildingAgent
    output: Path
    lock: object = field(default_factory=Lock)
    actions: list[dict] = field(default_factory=list)


def create_app(data_root: Path | None = None, output_root: Path | None = None,
               client_factory=None, build_function=None, upload_root: Path | None = None,
               max_sessions: int = 256) -> FastAPI:
    catalog = Catalog(data_root or Path(os.environ.get('AGENT_DATA_DIR', ROOT / 'data')))
    output_root = output_root or ROOT / 'agent_output' / 'sessions'
    upload_root = upload_root or Path(os.environ.get('AGENT_UPLOAD_DIR', ROOT / 'agent_output' / 'uploads'))
    if build_function is None and os.environ.get('AGENT_BUILDER'):
        module, function = os.environ['AGENT_BUILDER'].split(':', 1)
        build_function = getattr(import_module(module), function)
        if not callable(build_function):
            raise ValueError('AGENT_BUILDER must reference a callable')
    client_factory = client_factory or _get_client
    app = FastAPI(title='Team Simran building agent')
    app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:5173'],
                       allow_methods=['GET', 'POST'], allow_headers=['Content-Type'])
    sessions: dict[tuple[str, str], Session] = {}
    sessions_lock = Lock()
    app.state.sessions, app.state.catalog = sessions, catalog

    def configure(session, register):
        session.agent.tools = chat_tools(session.agent.map, session.output, session.actions,
                                         build_function, register, upload_root, session.agent.context)

    def get_session(identifier, session_id):
        key = (identifier, session_id)
        with sessions_lock:
            if key not in sessions:
                data = catalog.get(identifier)
                if len(sessions) >= max_sessions:
                    raise HTTPException(503, 'Session capacity reached; restart the demo server to reset sessions.')
                output = output_root / uuid4().hex
                agent = BuildingAgent(Building(data), output, client=client_factory(), mode='chat')
                sessions[key] = Session(agent, output)
            return sessions[key]

    @app.get('/buildings')
    def buildings():
        return catalog.listing()

    @app.get('/buildings/{building_id}')
    def building(building_id: str):
        return catalog.get(building_id)

    @app.post('/buildings/{building_id}/chat', response_model=ChatResponse)
    def chat(building_id: str, request: ChatRequest):
        try:
            session = get_session(building_id, request.session_id)
            with session.lock:
                agent = session.agent
                snapshot = (deepcopy(agent.map.data), set(agent.map.closed), deepcopy(agent.map.last_route),
                            len(agent.messages), dict(agent.usage), len(agent.responses), deepcopy(agent.context))
                pending = []
                session.actions.clear()

                def register(created):
                    # Publish only when the entire turn succeeds; reject collisions before the action.
                    identifier = created.data['building']['id']
                    with catalog.lock:
                        if identifier in catalog.data or any(b.data['building']['id'] == identifier for b in pending):
                            raise ValueError(f'Building ID already registered: {identifier}')
                    pending.append(created)

                configure(session, register)
                try:
                    raw_reply = agent.ask(request.message)
                    if not raw_reply.strip() or raw_reply == '(no response)':
                        raise RuntimeError('No final response from agent')
                    reply, understood, clarification = parse_reply(raw_reply)
                    if not reply:
                        reply = understood or ''
                    # Commit newly built buildings together, with a collision check under the same lock.
                    with catalog.lock:
                        if any(b.data['building']['id'] in catalog.data for b in pending):
                            raise RuntimeError('A generated building ID was registered by another session')
                        for created in pending:
                            catalog.data[created.data['building']['id']] = deepcopy(created.data)
                    return ChatResponse(reply=reply, understood=understood,
                                        needs_clarification=clarification, actions=deepcopy(session.actions))
                except Exception:
                    data, closed, route, message_count, usage, response_count, context = snapshot
                    agent.map = Building(data)
                    agent.map.closed, agent.map.last_route = closed, route
                    del agent.messages[message_count:]
                    agent.usage = usage
                    agent.context = context
                    del agent.responses[response_count:]
                    session.actions.clear()
                    raise
        except HTTPException:
            raise
        except anthropic.RateLimitError:
            raise HTTPException(429, 'Model temporarily rate limited. Retry this message.') from None
        except (anthropic.APIError, ValueError) as exc:
            log.warning('Chat request failed: %s', type(exc).__name__)
            raise HTTPException(502, 'Model request failed. Session changes were not applied; retry this message.') from None
        except Exception as exc:
            log.warning('Chat request failed: %s', type(exc).__name__)
            raise HTTPException(500, 'Chat failed. Session changes were not applied.') from None

    return app


app = create_app()
