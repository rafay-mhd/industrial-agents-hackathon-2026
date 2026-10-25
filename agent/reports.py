"""Reported equipment availability is separate from the building's walkable graph."""
from datetime import datetime, timezone
from uuid import uuid4
import networkx as nx
from core import MapError


def unavailable_assets(building):
    return {w['element_id'] for w in building.data['building'].get('live_warnings',[])
            if w['status']=='active' and w.get('asset_unavailable')}


def resolve_report_target(building,reference):
    items={**building.spaces,**building.openings,**building.connectors,**building.assets}
    if reference in items:return reference
    text=reference.strip().casefold()
    matches=[key for key,item in items.items() if text in {str(item.get('name','')).casefold(),str(item.get('ref','')).casefold()}]
    if len(matches)==1:return matches[0]
    if not matches:
        words=text.replace('_',' ').split()
        matches=[key for key,item in items.items() if words and all(word in f"{item.get('name','')} {item.get('type','')} {item.get('ref','')}".replace('_',' ').casefold() for word in words)]
    if len(matches)==1:return matches[0]
    if matches:raise MapError('Choose which place or item: '+', '.join(f"{items[key].get('name',key)} [{key}]" for key in matches[:8]))
    raise MapError('No mapped place or item matches this report. Select the affected room if the object is not mapped.')


def create_report(building,reference,kind,message,reporter='Visitor',blocks_route=False):
    from agent.building_updates import warning_blocks
    target=resolve_report_target(building,reference)
    asset=building.assets.get(target)
    if kind=='lift_outage':
        lifts=[c for c in building.connectors.values() if c['kind']=='lift' and (target==c['id'] or target in c['space_ids'])]
        if len(lifts)!=1:raise MapError('Choose a lift or one of its mapped landings for a lift outage.')
        target=lifts[0]['id'];blocks_route=True
    if asset and blocks_route:
        raise MapError('Equipment availability does not close a room. Choose the affected room or connection to block access.')
    message=message.strip();reporter=reporter.strip() or 'Visitor'
    if not message or len(message)>280 or len(reporter)>40:raise MapError('Use a description of 1–280 characters and a reporter name under 41 characters.')
    meta=building.data['building'];warnings=meta.setdefault('live_warnings',[])
    if sum(w['status']=='active' for w in warnings)>=100:raise MapError('Resolve older warnings before adding more reports.')
    meta.setdefault('manual_closed_element_ids',sorted(building.closed-warning_blocks(meta)))
    item=asset or building.connectors.get(target) or building.spaces.get(target) or building.openings.get(target)
    now=datetime.now(timezone.utc).isoformat()
    warning=dict(id=uuid4().hex,element_id=target,label=item.get('name') or 'Doorway',kind=kind,message=message,
                 reporter=reporter,blocks_route=blocks_route,asset_unavailable=bool(asset and kind=='equipment_outage'),
                 space_id=asset['space_id'] if asset else target if target in building.spaces else None,
                 status='active',created_at=now,updated_at=now)
    warnings.append(warning)
    meta['live_warnings']=[w for w in warnings if w['status']=='active']+[w for w in warnings if w['status']=='resolved'][-100:]
    building.closed=set(meta['manual_closed_element_ids'])|warning_blocks(meta)
    return warning


def nearest_available_asset(building,start,item,step_free=False,include_start=True):
    start_id=building.resolve_space(start);wanted=building.normalize_asset_type(item)
    unavailable=unavailable_assets(building)
    if not unavailable:
        return {**building.nearest_room_with_asset(start,item,step_free=step_free,include_start=include_start),
                'availability':'No active outage report; operation not independently verified.'}
    matching=[a for a in building.assets.values() if a['type']==wanted and (include_start or a['space_id']!=start_id)]
    candidates=[a for a in matching if a['id'] not in unavailable]
    if matching and not candidates:
        raise MapError(f'All matching {item} items have active equipment-outage reports. Equipment reports do not close their rooms. Choose another item or resolve a report.')
    graph=building.graph(step_free)
    distances=nx.single_source_dijkstra_path_length(graph,start_id,weight='weight') if start_id in graph else {}
    reached=[a for a in candidates if a['space_id'] in distances]
    if not reached:raise MapError(f"No available {item} can be reached with the current {'step-free ' if step_free else ''}route constraints. Reported equipment outages are excluded.")
    asset=min(reached,key=lambda a:(distances[a['space_id']],a['id']));sid=asset['space_id']
    return dict(space_id=sid,name=building.spaces[sid]['name'],asset_id=asset['id'],asset_name=asset['name'],
                floor=building.floor_name(asset['floor_id']),distance_m=round(distances[sid],2),
                candidates=len(reached),availability='No active outage report; operation not independently verified.')


def ensure_equipment_available(building,references):
    unavailable=unavailable_assets(building)
    for reference in references:
        if reference in unavailable:raise MapError(f"{building.assets[reference]['name']} is reported unavailable. Choose another item or resolve its warning.")


def asset_reference(building,reference):
    """Retain an item's identity instead of reducing every equipment request to its room."""
    if reference in building.assets:return reference
    if reference in building.spaces:return reference
    text=reference.strip().casefold()
    if any(text in {s['name'].casefold(),str(s.get('ref','')).casefold()} for s in building.spaces.values()):return reference
    exact=[a['id'] for a in building.assets.values() if a['name'].casefold()==text]
    words=text.replace('_',' ').split()
    matches=exact or [a['id'] for a in building.assets.values() if words and all(w in f"{a['name']} {a['type']}".replace('_',' ').casefold() for w in words)]
    if len(matches)==1:return matches[0]
    if len(matches)>1:raise MapError('Several items match. Choose a specific item or ask for the nearest one: '+', '.join(building.assets[a]['name'] for a in matches[:8]))
    return reference
