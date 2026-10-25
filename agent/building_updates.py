"""Persistent building edits and deterministic routes shared by planner and conversation."""
from copy import deepcopy
from dataclasses import asdict
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
from threading import Lock, RLock
from uuid import uuid4

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from shapely.geometry import Polygon
from shapely.ops import nearest_points
from core import Building, MapError
from agent.navigation import display_route


def warning_blocks(meta):
    return {w['element_id'] for w in meta.get('live_warnings',[]) if w['status']=='active' and w['blocks_route']}


def set_manual_closure(building,reference,closed):
    identifier=building.find_element(reference)
    meta=building.data['building']
    manual=set(meta.get('manual_closed_element_ids',meta.get('closed_element_ids',building.closed)))
    if closed:manual.add(identifier)
    else:manual.discard(identifier)
    meta['manual_closed_element_ids']=sorted(manual)
    building.closed=manual|warning_blocks(meta)
    return identifier


def door_position(building,first,second):
    a,b=building.resolve_space(first),building.resolve_space(second)
    if a==b or building.spaces[a]['floor_id']!=building.spaces[b]['floor_id']:
        raise MapError('Choose two different rooms on the same floor.')
    pa,pb=(Polygon(building.spaces[s]['polygon']) for s in (a,b))
    shared=pa.boundary.intersection(pb.boundary.buffer(.35,cap_style=2))
    lines=list(shared.geoms) if hasattr(shared,'geoms') else [shared]
    lines=[line for line in lines if line.geom_type=='LineString' and line.length>=1]
    if not lines:raise MapError('These rooms do not share enough wall for a door. Choose adjacent rooms.')
    middle=max(lines,key=lambda x:x.length).interpolate(.5,normalized=True)
    other=nearest_points(pb.boundary,middle)[0]
    return ((middle.x+other.x)/2,(middle.y+other.y)/2)


def route_action(agent):
    trip=agent.context.trip
    if not trip:return None
    try:
        route=agent.map.route(trip['start'],trip['destination'],trip['step_free'],trip.get('via'))
        from agent.chat_tools import human_steps
        result=asdict(route);action=display_route(agent.map,result,trip)
        action['steps']=human_steps(agent.map,result['steps'])
        return action
    except MapError as error:
        agent.map.last_route=None
        agent.map.last_route_points=[]
        reason=str(error)
        if reason.startswith(('No route','No step-free route')):
            unavailable=[]
            for identifier in sorted(agent.map.closed):
                item=agent.map.connectors.get(identifier) or agent.map.spaces.get(identifier) or agent.map.openings.get(identifier) or {}
                unavailable.append(item.get('name') or 'a doorway')
            start=agent.map.spaces.get(trip['start'],{}).get('name','your start')
            end=agent.map.spaces.get(trip['destination'],{}).get('name','your destination')
            reason=f"No {'step-free ' if trip['step_free'] else ''}route is available from {start} to {end}."
            if unavailable:reason+=' Unavailable: '+', '.join(unavailable)+'.'
            else:reason+=' Check that the rooms have a mapped connection.'
        return dict(type='route_unavailable',reason=reason)


class BuildingUpdates:
    def __init__(self,catalog,storage:Path):
        self.catalog,self.storage=catalog,storage
        self.locks={};self.guard=Lock();storage.mkdir(parents=True,exist_ok=True)
        for path in storage.glob('*.json'):
            try:
                value=json.loads(path.read_text());identifier=value['building']['id']
                if identifier in catalog.data:catalog.data[identifier]=value
            except (ValueError,KeyError,TypeError,OSError):continue
    def lock(self,identifier):
        with self.guard:return self.locks.setdefault(identifier,RLock())
    def sync(self,session):
        data=self.catalog.get(session.agent.map.data['building']['id'])
        if data['building'].get('revision',0)==session.agent.map.data['building'].get('revision',0):return False
        session.agent.map=Building(data)
        session.agent.map.closed=set(data['building'].get('closed_element_ids',[]))
        from agent.prompts import CHAT_PROMPT
        session.agent.system[0]['text']=CHAT_PROMPT.format(overview=json.dumps(session.agent.map.overview(),ensure_ascii=False))
        return True
    def state(self,identifier):
        with self.catalog.lock:
            if identifier not in self.catalog.data:raise HTTPException(404,'Building not found.')
            meta=self.catalog.data[identifier]['building']
            return deepcopy(dict(revision=meta.get('revision',0),closed=meta.get('closed_element_ids',[]),changes=meta.get('changes',[]),warnings=meta.get('live_warnings',[])))
    def publish(self,agent,actions):
        edits=[a for a in actions if a['type'] in {'closed','door_added','warning_changed'}]
        if not edits:return None
        data=deepcopy(agent.map.data);meta=data['building'];identifier=meta['id']
        current=self.catalog.get(identifier)['building'];revision=current.get('revision',0)+1
        events=list(current.get('changes',[]));now=datetime.now(timezone.utc).isoformat()
        old=set(current.get('closed_element_ids',[]));new=set(agent.map.closed)
        for element in sorted(old^new):
            item=agent.map.connectors.get(element) or agent.map.spaces.get(element) or agent.map.openings.get(element) or {}
            events.append(dict(id=uuid4().hex,kind='closure',element_id=element,closed=element in new,
                label=item.get('name') or item.get('ref') or ('Door '+element),at=now))
        for edit in edits:
            if edit['type']=='door_added':
                door=edit['opening'];names=[agent.map.spaces[s]['name'] for s in door['space_ids']]
                events.append(dict(id=uuid4().hex,kind='door_added',element_id=door['id'],label=' ↔ '.join(names),at=now))
        for edit in edits:
            if edit['type']=='warning_changed':
                warning=edit['warning']
                events.append(dict(id=uuid4().hex,kind='warning',warning_id=warning['id'],element_id=warning['element_id'],label=warning['label'],
                    status=warning['status'],at=now))
        for warning in meta.get('live_warnings',[]):
            if any(e['type']=='warning_changed' and e['warning']['id']==warning['id'] for e in edits):
                warning['revision']=revision
        meta.update(revision=revision,closed_element_ids=sorted(new),changes=events[-100:])
        destination=self.storage/(sha256(identifier.encode()).hexdigest()+'.json')
        temporary=destination.with_suffix('.'+uuid4().hex+'.tmp')
        temporary.write_text(json.dumps(data,ensure_ascii=False,allow_nan=False));temporary.replace(destination)
        with self.catalog.lock:self.catalog.data[identifier]=deepcopy(data)
        agent.map.data['building']=deepcopy(meta)
        return dict(type='building_state',building=data)


class TripRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    session_id:str=Field(min_length=1,max_length=128)
    start:str=Field(min_length=1,max_length=300)
    destination:str=Field(min_length=1,max_length=300)
    via:list[str]=Field(default_factory=list,max_length=12)
    step_free:bool=False


class EditRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    session_id:str=Field(min_length=1,max_length=128)
    kind:str=Field(pattern='^(closure|door)$')
    element_id:str|None=Field(default=None,max_length=300)
    closed:bool=True
    first:str|None=Field(default=None,max_length=300)
    second:str|None=Field(default=None,max_length=300)
    step_free:bool=False


def install_updates(app,updates,get_session):
    @app.get('/buildings/{identifier}/changes')
    def changes(identifier:str):return updates.state(identifier)

    @app.delete('/buildings/{identifier}/trip/{session_id}')
    def clear_trip(identifier:str,session_id:str):
        session=get_session(identifier,session_id)
        with session.lock:
            session.agent.context.trip=None;session.agent.map.last_route=None
        return dict(cleared=True)

    @app.post('/buildings/{identifier}/route')
    def route(identifier:str,request:TripRequest):
        session=get_session(identifier,request.session_id)
        with session.lock,updates.lock(identifier):
            updates.sync(session);agent=session.agent
            try:
                agent.context.trip=dict(start=agent.map.resolve_space(request.start),destination=agent.map.resolve_space(request.destination),
                    via=[agent.map.resolve_space(s) for s in request.via],step_free=request.step_free)
                agent.context.step_free=request.step_free
                action=route_action(agent)
                return dict(actions=[dict(type='building_state',building=updates.catalog.get(identifier)),action],
                            reply=action.get('reason') or 'Your route is ready.')
            except MapError as error:raise HTTPException(422,str(error)) from None

    @app.post('/buildings/{identifier}/changes')
    def edit(identifier:str,request:EditRequest):
        session=get_session(identifier,request.session_id)
        with session.lock,updates.lock(identifier):
            updates.sync(session);agent=session.agent
            original=agent.map;agent.map=Building(deepcopy(original.data));agent.map.closed=set(original.closed)
            try:
                if request.kind=='closure':
                    if not request.element_id:raise MapError('Choose the door, room, stairs or lift to update.')
                    target=set_manual_closure(agent.map,request.element_id,request.closed)
                    actions=[dict(type='closed',element_ids=sorted(agent.map.closed))]
                    reply='Marked unavailable.' if request.closed else ('Direct closure removed. An active Live Warn report still blocks this connection.' if target in agent.map.closed else 'Reopened.')
                else:
                    if not request.first or not request.second:raise MapError('Choose both adjoining rooms.')
                    position=door_position(agent.map,request.first,request.second)
                    opening=agent.map.add_door(request.first,request.second,request.step_free,position)
                    actions=[dict(type='door_added',opening=opening)];reply='Door added to the building.'
                recalculated=route_action(agent)
                if recalculated:
                    actions.append(recalculated)
                    reply+=' '+('Your route has been updated.' if recalculated['type']=='route' else recalculated['reason'])
                state=updates.publish(agent,actions)
                return dict(actions=[state,*actions],reply=reply)
            except MapError as error:
                agent.map=original;raise HTTPException(422,str(error)) from None
            except Exception:
                agent.map=original;raise
