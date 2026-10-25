"""Wall-safe paths and shared building updates through the real HTTP/Core boundary."""
from copy import deepcopy
from dataclasses import asdict
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock,patch
from fastapi.testclient import TestClient
from shapely.geometry import Polygon,LineString,Point
from agent.agent import BuildingAgent
from agent.server import create_app
from agent.navigation import display_route,indoor_path
from core import Building


def fixture():
    data=dict(building=dict(id='navigation-house',name='Corner House',source='navigation test',units='m'),
              floors=[dict(id='g',level=0,name='Ground floor',elevation_m=0),dict(id='u',level=1,name='Upper floor',elevation_m=3.4)],spaces=[],openings=[],vertical_connectors=[],assets=[])
    def room(id,name,floor,polygon,kind='room'):
        data['spaces'].append(dict(id=id,name=name,ref=id,floor_id=floor,polygon=polygon,type=kind,room_type=kind))
    def rect(id,name,floor,x,y,w,h,kind='room'):room(id,name,floor,[[x,y],[x+w,y],[x+w,y+h],[x,y+h]],kind)
    rect('A','Reception','g',0,0,4,4)
    room('C','Corner hall','g',[[4,0],[12,0],[12,12],[8,12],[8,4],[4,4]],'corridor')
    rect('B','Studio','g',8,12,4,4)
    rect('S','New store','g',0,4,4,4)
    rect('L0','Lift landing','g',12,0,3,4,'lift')
    rect('T0','Stair landing','g',12,8,3,4,'stair')
    rect('L1','Lift landing','u',12,0,3,4,'lift')
    rect('T1','Stair landing','u',12,8,3,4,'stair')
    rect('U','Upper studio','u',8,0,4,4)
    rect('H','Upper hall','u',8,4,4,8,'corridor')
    for id,floor,spaces,position in [('entrance','g',['A','outside'],[0,2]),('ac','g',['A','C'],[4,2]),('cb','g',['C','B'],[10,12]),('cl','g',['C','L0'],[12,2]),('ct','g',['C','T0'],[12,10]),('lu','u',['L1','U'],[12,2]),('th','u',['T1','H'],[12,10]),('hu','u',['H','U'],[10,4])]:
        data['openings'].append(dict(id=id,floor_id=floor,space_ids=spaces,position=position,kind='entrance' if id=='entrance' else 'door',width_m=.9,step_free=True))
    for id,kind,spaces in [('lift','lift',['L0','L1']),('stairs','stairs',['T0','T1'])]:
        data['vertical_connectors'].append(dict(id=id,kind=kind,name='East '+kind,floor_ids=['g','u'],space_ids=spaces,step_free=kind=='lift'))
    return data


class DisplayPathTests(unittest.TestCase):
    def test_fixture_passes_the_public_import_validator(self):
        from agent.plan_builder import validate_import
        self.assertEqual(validate_import(fixture())[0],fixture())

    def test_concave_room_path_bends_instead_of_crossing_wall(self):
        polygon=tuple(tuple(p) for p in fixture()['spaces'][1]['polygon'])
        start,end=(4.3,2),(10,11.7)
        self.assertFalse(Polygon(polygon).covers(LineString([start,end])))
        path=indoor_path(polygon,start,end)
        self.assertGreater(len(path),2)
        self.assertTrue(Polygon(polygon).covers(LineString(path)))

    def test_route_crosses_room_boundaries_only_at_reported_doorways(self):
        b=Building(fixture());route=b.route('A','B');a=display_route(b,asdict(route))
        self.assertTrue(a['geometry_valid'],a)
        line=LineString(a['segments'][0]['points'])
        for room_id,door_id in [('A','ac'),('B','cb')]:
            intersection=line.intersection(Polygon(b.spaces[room_id]['polygon']).boundary)
            self.assertTrue(intersection.difference(Point(b.openings[door_id]['position']).buffer(.001)).is_empty)
        self.assertEqual(a['length_m'],route.length_m)

    def test_invalid_door_coordinate_disables_walkthrough(self):
        data=fixture();data['openings'][1]['position']=[30,30]
        b=Building(data);a=display_route(b,asdict(b.route('A','B')))
        self.assertFalse(a['geometry_valid']);self.assertEqual(a['segments'],[])
        self.assertIn('doorway',a['geometry_notice'])


class BuildingUpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.source=self.root/'source';self.source.mkdir()
        (self.source/'building.json').write_text(json.dumps(fixture()))
        self.app=create_app(self.source,self.root/'output',client_factory=Mock)
        self.client=TestClient(self.app);self.addCleanup(self.client.close)
        self.url='/buildings/navigation-house'
    def route(self,start='A',destination='U',session='one',step_free=True,via=None):
        response=self.client.post(self.url+'/route',json=dict(session_id=session,start=start,destination=destination,step_free=step_free,via=via or []))
        self.assertEqual(response.status_code,200,response.text)
        return response.json()['actions'][-1]
    def edit(self,**edit):return self.client.post(self.url+'/changes',json=dict(session_id='one',**edit))

    def test_lift_outage_blocks_step_free_trip_and_reopen_restores_it(self):
        initial=self.route();self.assertTrue(initial['geometry_valid']);self.assertEqual(initial['segments'][0]['exit_connector_id'],'lift')
        closed=self.edit(kind='closure',element_id='lift',closed=True)
        self.assertEqual(closed.status_code,200,closed.text)
        self.assertEqual(closed.json()['actions'][-1]['type'],'route_unavailable')
        reopened=self.edit(kind='closure',element_id='lift',closed=False)
        self.assertEqual(reopened.json()['actions'][-1]['type'],'route')
        self.assertTrue(reopened.json()['actions'][-1]['step_free'])
        self.assertIsNone(self.app.state.sessions[('navigation-house','one')].agent.context.position)

    def test_outage_recalculates_other_sessions_and_survives_restart(self):
        self.route(session='other',step_free=False)
        self.edit(kind='closure',element_id='lift',closed=True)
        rerouted=self.route(session='other',step_free=False)
        self.assertEqual(rerouted['segments'][0]['exit_connector_id'],'stairs')
        with TestClient(create_app(self.source,self.root/'output',client_factory=Mock)) as fresh:
            state=fresh.get(self.url+'/changes').json()
            self.assertEqual(state['closed'],['lift']);self.assertEqual(state['revision'],1)
            r=fresh.post(self.url+'/route',json=dict(session_id='fresh',start='A',destination='U',step_free=True))
            self.assertEqual(r.json()['actions'][-1]['type'],'route_unavailable')
        self.assertEqual(json.loads((self.source/'building.json').read_text()),fixture())

    def test_new_door_creates_route_at_middle_of_shared_wall(self):
        self.assertEqual(self.route(destination='S')['type'],'route_unavailable')
        edit=self.edit(kind='door',first='A',second='S',step_free=True)
        self.assertEqual(edit.status_code,200,edit.text)
        actions=edit.json()['actions'];door=next(a['opening'] for a in actions if a['type']=='door_added')
        self.assertEqual(door['position'],[2,4]);self.assertTrue(actions[-1]['geometry_valid'])
        self.assertIn([2,4],actions[-1]['segments'][0]['points'])
        self.assertEqual(self.client.get(self.url+'/changes').json()['changes'][-1]['kind'],'door_added')

    def test_reject_nonadjacent_and_cross_floor_doors_without_mutating(self):
        for second in ['B','U']:
            response=self.edit(kind='door',first='A',second=second)
            self.assertEqual(response.status_code,422,response.text)
        self.assertEqual(self.client.get(self.url+'/changes').json()['revision'],0)
        self.assertEqual(self.client.get(self.url).json(),fixture())

    def test_multistop_order_and_floor_transitions_are_preserved(self):
        a=self.route(destination='B',via=['U'])
        self.assertTrue(a['geometry_valid']);self.assertEqual(a['via_space_ids'],['U'])
        self.assertEqual([s['floor_id'] for s in a['segments']],['g','u','g'])
        self.edit(kind='closure',element_id='lift',closed=True)
        r=self.edit(kind='closure',element_id='lift',closed=False).json()['actions'][-1]
        self.assertEqual(r['via_space_ids'],['U']);self.assertEqual(r['destination_space_id'],'B')

    def test_clearing_trip_prevents_unwanted_reroute_on_edit(self):
        self.route();self.client.delete(self.url+'/trip/one')
        actions=self.edit(kind='closure',element_id='lift',closed=True).json()['actions']
        self.assertFalse(any(a['type'].startswith('route') for a in actions))

    def test_stale_chat_cannot_overwrite_a_newer_building_update(self):
        def ask(agent,message):
            response=self.client.post(self.url+'/changes',json=dict(session_id='editor',kind='closure',element_id='lift',closed=True))
            self.assertEqual(response.status_code,200,response.text)
            tool=next(t for t in agent.tools if t.name=='set_closed');tool.call(dict(element='stairs',closed=True))
            return 'Understood: Close stairs\nDone.'
        with patch.object(BuildingAgent,'ask',ask):
            response=self.client.post(self.url+'/chat',json=dict(session_id='reader',message='Close stairs'))
        self.assertEqual(response.status_code,409,response.text)
        self.assertEqual(self.client.get(self.url+'/changes').json()['closed'],['lift'])
