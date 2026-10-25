"""Verified display paths around walls, without changing Core's scored route costs."""
from functools import lru_cache
import math
import networkx as nx
import numpy as np
from shapely.geometry import LineString, Point, Polygon
from starter_agent.building_map import DOOR_PREFIX, door_landing, visibility_matrix
from core import MapError


@lru_cache(maxsize=2048)
def indoor_path(outline, start, end):
    polygon=Polygon(outline)
    if not polygon.is_valid:raise ValueError('Invalid room outline.')
    if math.dist(start,end)<1e-8:return [start]
    area=polygon.buffer(-.16,join_style=2)
    if area.is_empty or area.geom_type!='Polygon' or not all(area.buffer(.002).covers(Point(p)) for p in (start,end)):
        area=polygon.buffer(-.055,join_style=2)
    if area.is_empty or area.geom_type!='Polygon' or not all(area.buffer(.002).covers(Point(p)) for p in (start,end)):
        raise ValueError('The mapped passage is too narrow or disconnected for a verified walkthrough.')
    allowed=area.buffer(.002)
    if allowed.covers(LineString([start,end])):return [start,end]
    corners=[tuple(p) for ring in [area.exterior,*area.interiors] for p in list(ring.coords)[:-1]]
    points=list(dict.fromkeys([start,end,*corners]))
    if len(points)>1500:raise ValueError('This outline is too detailed to verify a walkthrough.')
    matrix=visibility_matrix(allowed,points)
    graph=nx.from_numpy_array(np.where(np.isfinite(matrix),matrix,0.0))
    try:return [points[i] for i in nx.shortest_path(graph,0,1,weight='weight')]
    except nx.NetworkXNoPath:raise ValueError('There is no continuous walkable path inside this mapped room.') from None


def display_route(building,result,trip=None):
    """Follow Core's exact graph route, then reconstruct the interior bends it prices."""
    trip=trip or dict(start=result['start_space_id'],destination=result['destination_space_id'],via=[],step_free=result['step_free'])
    action=dict(type='route',length_m=result['length_m'],steps=result['steps'],floors={},segments=[],
                start_space_id=result['start_space_id'],destination_space_id=result['destination_space_id'],
                via_space_ids=list(trip.get('via',[])),step_free=result['step_free'],geometry_valid=False,element_ids=list(result['space_path']))
    graph=building.graph(result['step_free'])
    stops=[result['start_space_id'],*[building.resolve_space(s) for s in trip.get('via',[])],result['destination_space_id']]
    segments=[]
    def add(floor,points):
        if not segments or segments[-1]['floor_id']!=floor:segments.append(dict(floor_id=floor,points=[]))
        for p in points:
            point=[round(float(p[0]),5),round(float(p[1]),5)]
            if not segments[-1]['points'] or point!=segments[-1]['points'][-1]:segments[-1]['points'].append(point)
    def landing(node,space,polygon):
        _,position=building.node_point(node)
        if not node.startswith(DOOR_PREFIX):return tuple(position)
        door=building.openings[node.removeprefix(DOOR_PREFIX)]
        if space not in door['space_ids'] or Point(position).distance(polygon)>.65:
            raise ValueError('A mapped doorway does not align with its room. Review the plan before walking.')
        inside=tuple(door_landing(polygon,position))
        portal=Point(position).buffer(max(.15,min(1,float(door.get('width_m',.9))*.5))+.05)
        if not polygon.buffer(.002).union(portal).covers(LineString([position,inside])):
            raise ValueError('A doorway landing crosses an unverified wall.')
        return inside
    try:
        for first,last in zip(stops,stops[1:]):
            _,nodes=nx.single_source_dijkstra(graph,first,last,weight='weight')
            elements=set(action['element_ids'])|{node.removeprefix(DOOR_PREFIX) for node in nodes}
            elements.update(building.cheapest(graph,a,b)['via'] for a,b in zip(nodes,nodes[1:]) if 'via' in building.cheapest(graph,a,b))
            action['element_ids']=sorted(elements)
            if len(nodes)==1:
                floor,point=building.node_point(nodes[0]);add(floor,[point])
            for a,b in zip(nodes,nodes[1:]):
                edge=building.cheapest(graph,a,b)
                fa,pa=building.node_point(a);fb,pb=building.node_point(b)
                if 'via' in edge:
                    action['distance_note']='Equivalent walking distance, including the lift waiting or stair-climbing allowance.'
                    if fa==fb:raise ValueError('This connection needs a mapped walkway before it can be previewed.')
                    add(fa,[pa]);segments[-1]['exit_connector_id']=edge['via'];add(fb,[pb]);continue
                space=edge['space'];polygon=Polygon(building.spaces[space]['polygon'])
                start,end=landing(a,space,polygon),landing(b,space,polygon)
                path=indoor_path(tuple(tuple(p) for p in building.spaces[space]['polygon']),start,end)
                add(fa,[pa,*path,pb])
        for segment in segments:
            level=str(building.floors[segment['floor_id']]['level'])
            action['floors'].setdefault(level,[]).extend(segment['points'])
        action.update(segments=segments,geometry_valid=True)
    except (ValueError,nx.NetworkXException,MapError) as error:
        action['geometry_notice']='Walkthrough unavailable: '+str(error)
    return action
