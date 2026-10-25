"""Community reports, revision events and route-specific notifications for local viewers."""
import asyncio
from copy import deepcopy
from datetime import datetime, timezone
import json
from typing import Literal
from uuid import uuid4
from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from core import Building, MapError
from agent.building_updates import route_action, warning_blocks, TripRequest


class WarningRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    session_id:str=Field(min_length=1,max_length=128)
    element_id:str=Field(min_length=1,max_length=300)
    kind:Literal['lift_outage','blocked_access','hazard','other']='blocked_access'
    message:str=Field(min_length=1,max_length=280)
    reporter:str=Field(default='Visitor',max_length=40)
    blocks_route:bool=True
    planned_trip:TripRequest|None=None

    @field_validator('message')
    @classmethod
    def text_required(cls,value):
        value=value.strip()
        if not value:raise ValueError('Describe what you noticed.')
        return value


class ResolveRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    session_id:str=Field(min_length=1,max_length=128)
    planned_trip:TripRequest|None=None


class SyncRequest(ResolveRequest):
    revision:int=Field(default=0,ge=0)
    planned_trip:TripRequest|None=None


def restore_trip(agent,trip):
    if agent.context.trip is not None or trip is None:return
    building=agent.map
    try:
        agent.context.trip=dict(start=building.resolve_space(trip.start),destination=building.resolve_space(trip.destination),
            via=[building.resolve_space(s) for s in trip.via],step_free=trip.step_free)
        agent.context.step_free=trip.step_free
    except MapError as error:raise HTTPException(422,str(error)) from None


def signature(action):
    if not action:return None
    if action['type']=='route_unavailable':return ('unavailable',action['reason'])
    return (action['type'],action['length_m'],action['segments'],action['element_ids'])


def route_notice(before,after,warnings,previous_revision):
    if after is None:return None
    changed=signature(before)!=signature(after)
    path=set((before or {}).get('element_ids',[]))|set(after.get('element_ids',[]))
    relevant=[w for w in warnings if w.get('revision',0)>previous_revision and w['element_id'] in path]
    # Previously blocked trips can become possible again, without an old polyline.
    if changed and not relevant:
        relevant=[w for w in warnings if w.get('revision',0)>previous_revision and w['blocks_route']]
    if not changed and not relevant:return None
    label=', '.join(dict.fromkeys(w['label'] for w in relevant))
    if after['type']=='route_unavailable':
        title='No alternative route available';message=after['reason']
    elif changed:
        title='Your route has adapted'
        message=(f'Updated after a report at {label}.' if label else 'Your route has been checked against the updated building.')
        message+=' Your destination, stops and accessibility preference are preserved.'
    else:
        title='A heads-up on your route'
        message=' · '.join(w['message'] if w['status']=='active' else f"{w['label']}: warning resolved" for w in relevant)
    return dict(type='route_update',changed=changed,title=title,message=message,
                previous_length_m=(before or {}).get('length_m'),new_length_m=after.get('length_m'),
                warning_ids=[w['id'] for w in relevant])


_UNSET=object()

def sync_actions(updates,agent,before,revision,geometry_changed=False,after=_UNSET):
    if after is _UNSET:after=route_action(agent)
    data=updates.catalog.get(agent.map.data['building']['id'])
    notice=route_notice(before,after,data['building'].get('live_warnings',[]),revision)
    changed=bool(notice and notice['changed'])
    actions=[dict(type='building_state',building=data,preserve_route=not changed,geometry_changed=geometry_changed)]
    if changed:actions.append(after)
    if notice:actions.append(notice)
    return actions


async def revision_events(request,read_state,last_revision):
    """A lightweight SSE notification; full geometry is fetched only on revision changes."""
    heartbeat=0
    while not await request.is_disconnected():
        state=read_state()
        if state['revision']!=last_revision:
            last_revision=state['revision']
            yield 'id: '+str(last_revision)+'\nevent: building-update\ndata: '+json.dumps(dict(revision=last_revision,closed=state['closed']))+'\n\n'
        if heartbeat%30==0:yield ': connected\n\n'
        heartbeat+=1
        await asyncio.sleep(.5)


def install_warnings(app,updates,get_session):
    @app.get('/buildings/{identifier}/events')
    async def events(identifier:str,request:Request,since:int=0):
        updates.catalog.get(identifier)
        try:last=int(request.headers.get('last-event-id',since))
        except ValueError:last=since
        return StreamingResponse(revision_events(request,lambda:updates.state(identifier),last),
            media_type='text/event-stream',headers={'Cache-Control':'no-cache','X-Accel-Buffering':'no'})

    @app.post('/buildings/{identifier}/sync')
    def sync(identifier:str,request:SyncRequest):
        session=get_session(identifier,request.session_id)
        with session.lock,updates.lock(identifier):
            if updates.state(identifier)['revision']==request.revision:
                return dict(actions=[],reply='Up to date.')
            before=route_action(session.agent)
            old_data=session.agent.map.data
            updates.sync(session)
            restore_trip(session.agent,request.planned_trip)
            geometry_changed=any(old_data.get(key)!=session.agent.map.data.get(key) for key in ('floors','spaces','openings','vertical_connectors','assets'))
            return dict(actions=sync_actions(updates,session.agent,before,request.revision,geometry_changed),reply='Building updates checked.')

    @app.post('/buildings/{identifier}/warnings')
    def report(identifier:str,request:WarningRequest):
        session=get_session(identifier,request.session_id)
        with session.lock,updates.lock(identifier):
            updates.sync(session);agent=session.agent
            restore_trip(agent,request.planned_trip)
            before=route_action(agent);revision=updates.state(identifier)['revision'];original=agent.map
            agent.map=Building(deepcopy(original.data));agent.map.closed=set(original.closed)
            try:
                target=agent.map.find_element(request.element_id)
                if request.kind=='lift_outage':
                    connectors=[c for c in agent.map.connectors.values() if c['kind']=='lift' and (target==c['id'] or target in c['space_ids'])]
                    if len(connectors)!=1:raise MapError('Choose a lift or one of its mapped landings for a lift outage.')
                    target=connectors[0]['id']
                item=agent.map.connectors.get(target) or agent.map.spaces.get(target) or agent.map.openings.get(target)
                meta=agent.map.data['building'];warnings=meta.setdefault('live_warnings',[])
                if sum(w['status']=='active' for w in warnings)>=100:raise HTTPException(409,'Resolve older warnings before adding more reports.')
                meta.setdefault('manual_closed_element_ids',sorted(original.closed-warning_blocks(meta)))
                now=datetime.now(timezone.utc).isoformat()
                warning=dict(id=uuid4().hex,element_id=target,label=item.get('name') or 'Doorway',
                    kind=request.kind,message=request.message,reporter=request.reporter.strip() or 'Visitor',
                    blocks_route=request.blocks_route or request.kind=='lift_outage',status='active',created_at=now,updated_at=now)
                warnings.append(warning)
                meta['live_warnings']=[w for w in warnings if w['status']=='active']+[w for w in warnings if w['status']=='resolved'][-100:]
                agent.map.closed=set(meta['manual_closed_element_ids'])|warning_blocks(meta)
                after=route_action(agent)
                updates.publish(agent,[dict(type='warning_changed',warning=warning)])
                return dict(actions=sync_actions(updates,agent,before,revision,after=after),reply='Warning posted. Affected routes are being checked.')
            except MapError as error:
                agent.map=original;raise HTTPException(422,str(error)) from None
            except Exception:
                agent.map=original;raise

    @app.post('/buildings/{identifier}/warnings/{warning_id}/resolve')
    def resolve(identifier:str,warning_id:str,request:ResolveRequest):
        session=get_session(identifier,request.session_id)
        with session.lock,updates.lock(identifier):
            updates.sync(session);agent=session.agent
            restore_trip(agent,request.planned_trip)
            original=agent.map;before=route_action(agent);revision=updates.state(identifier)['revision']
            agent.map=Building(deepcopy(original.data));agent.map.closed=set(original.closed)
            try:
                meta=agent.map.data['building'];warning=next((w for w in meta.get('live_warnings',[]) if w['id']==warning_id),None)
                if warning is None:raise HTTPException(404,'Warning not found in this building.')
                if warning['status']=='resolved':return dict(actions=[],reply='This warning is already resolved.')
                warning.update(status='resolved',updated_at=datetime.now(timezone.utc).isoformat())
                agent.map.closed=set(meta.get('manual_closed_element_ids',[]))|warning_blocks(meta)
                after=route_action(agent)
                updates.publish(agent,[dict(type='warning_changed',warning=warning)])
                return dict(actions=sync_actions(updates,agent,before,revision,after=after),reply='Warning resolved. Other active reports and direct closures remain in effect.')
            except Exception:
                agent.map=original;raise
