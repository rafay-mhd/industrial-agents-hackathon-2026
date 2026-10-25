"""Read-only reachability for the accessibility lens, using Core's exact graph."""
import networkx as nx
from fastapi import HTTPException
from pydantic import BaseModel,ConfigDict,Field
from core import Building,MapError

class PulseRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    start:str=Field(min_length=1,max_length=300)
    step_free:bool=True
    min_width_m:float|None=Field(default=None,ge=.3,le=5)


def accessibility_pulse(building,request):
    start=building.resolve_space(request.start)
    graph=building.cached_graph(request.step_free,request.min_width_m,frozenset(building.closed))
    reached=nx.node_connected_component(graph,start) if start in graph else set()
    reachable=[s for s in building.spaces if s in reached]
    floors=[dict(floor_id=f['id'],name=f['name'],reachable=sum(s['id'] in reached for s in building.spaces.values() if s['floor_id']==f['id']),
                 total=sum(s['floor_id']==f['id'] for s in building.spaces.values())) for f in building.floors.values()]
    return dict(revision=building.data['building'].get('revision',0),start_space_id=start,step_free=request.step_free,min_width_m=request.min_width_m,
                reachable_space_ids=reachable,unreachable_space_ids=[s for s in building.spaces if s not in reached],floors=floors,
                notice='Mapped access only. Room permissions, temporary obstacles and unreported faults may not be known.')


def install_accessibility(app,updates):
    @app.post('/buildings/{identifier}/accessibility')
    def pulse(identifier:str,request:PulseRequest):
        data=updates.catalog.get(identifier);building=Building(data)
        building.closed=set(data['building'].get('closed_element_ids',[]))
        try:return accessibility_pulse(building,request)
        except MapError as error:raise HTTPException(422,str(error)) from None
