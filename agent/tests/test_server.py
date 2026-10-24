"""Exercise the HTTP contract with actual Core tools; model calls are controlled fixtures."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Barrier, Lock
import time
import unittest
from unittest.mock import Mock, patch

import anthropic
import httpx2
from fastapi.testclient import TestClient

from agent.agent import BuildingAgent
from agent.server import create_app, parse_reply

ROOT = Path(__file__).resolve().parents[2]
ID = 'proc-factory-dev-003'
BUILDING = ROOT / 'data/dev' / ID
START = 'Warehouse zone H-C2'
DEST = 'CNC mill H-A1-A'


def call(agent, tool_name, **kwargs):
    return json.loads(next(t for t in agent.tools if t.name == tool_name).call(kwargs))


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name)
        self.app = create_app(BUILDING, self.output / 'sessions', client_factory=Mock)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)

    def post(self, message, session='one', client=None):
        return (client or self.client).post(f'/buildings/{ID}/chat', json={'session_id': session, 'message': message})

    def test_catalog_validation_and_cors_require_no_model(self):
        listing = self.client.get('/buildings').json()
        self.assertEqual(listing[0]['id'], ID)
        self.assertEqual(set(listing[0]), {'id', 'name', 'source', 'floors'})
        self.assertEqual(self.client.get(f'/buildings/{ID}').json(), json.loads((BUILDING/'building.json').read_text()))
        self.assertEqual(self.client.get('/buildings/missing').status_code, 404)
        self.assertEqual(self.client.post('/buildings/missing/chat', json={'session_id':'x','message':'hello'}).status_code,404)
        self.assertEqual(self.post('  ').status_code,422)
        self.assertEqual(self.post('hello',session='').status_code,422)
        response = self.client.options(f'/buildings/{ID}/chat',headers={'Origin':'http://localhost:5173','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'})
        self.assertEqual(response.headers['access-control-allow-origin'],'http://localhost:5173')
        self.assertEqual(len(self.app.state.sessions),0)

    def test_route_and_search_actions_come_from_real_tools_and_do_not_repeat(self):
        def ask(agent, message):
            if message == 'route':
                self.assertNotIn('build_building',[t.name for t in agent.tools])
                call(agent,'search_building',query=DEST)
                call(agent,'find_route',start=START,destination=DEST)
                return 'Understood: Warehouse to CNC mill\nFollow the route.'
            return 'You are welcome.'
        with patch.object(BuildingAgent,'ask',ask):
            response = self.post('route')
            self.assertEqual(response.status_code,200,response.text)
            data = response.json()
            self.assertEqual(data['understood'],'Warehouse to CNC mill')
            self.assertEqual(data['reply'],'Follow the route.')
            self.assertEqual([a['type'] for a in data['actions']],['highlight','route'])
            route = data['actions'][-1]
            b = self.app.state.sessions[(ID,'one')].agent.map
            self.assertEqual(route['floors'],b.route_geometry()['floors'])
            self.assertEqual(route['length_m'],b.last_route.length_m)
            self.assertTrue(data['actions'][0]['asset_ids'])
            self.assertEqual(self.post('thanks').json()['actions'],[])

    def test_each_route_action_captures_its_own_geometry(self):
        def ask(agent,message):
            call(agent,'find_route',start=START,destination=DEST)
            call(agent,'find_route',start=DEST,destination=START)
            return 'Understood: Both directions\nDone.'
        with patch.object(BuildingAgent,'ask',ask):
            routes = self.post('route').json()['actions']
        self.assertNotEqual(routes[0]['floors'],routes[1]['floors'])
        self.assertEqual(routes[0]['length_m'],routes[1]['length_m'])

    def test_closures_reopen_and_history_persist_only_in_their_session(self):
        def ask(agent,message):
            agent.messages.append({'role':'user','content':message})
            if message in {'close','open'}:
                call(agent,'set_closed',element='Lift 1',closed=message=='close')
            return f'Understood: {message}\nClosed count {len(agent.map.closed)}; turns {len(agent.messages)}'
        with patch.object(BuildingAgent,'ask',ask):
            closed = self.post('close').json()
            self.assertTrue(closed['actions'][0]['element_ids'])
            self.assertIn('Closed count 1; turns 2',self.post('status').json()['reply'])
            self.assertIn('Closed count 0; turns 1',self.post('status','other').json()['reply'])
            self.assertEqual(self.post('open').json()['actions'],[{'type':'closed','element_ids':[]}])
        self.assertEqual(self.client.get(f'/buildings/{ID}').json(),json.loads((BUILDING/'building.json').read_text()))

    def test_door_action_and_failed_turn_rollback(self):
        def ask(agent,message):
            agent.messages.append({'role':'user','content':message})
            first,second=next(o['space_ids'] for o in agent.map.openings.values() if len(o['space_ids'])==2)
            call(agent,'add_door',first_space=first,second_space=second)
            if message=='fail':
                call(agent,'set_closed',element='Lift 1',closed=True)
                raise RuntimeError('private failure details')
            return 'Understood: Add door\nDoor added.'
        with patch.object(BuildingAgent,'ask',ask):
            response = self.post('add').json()
            self.assertEqual(response['actions'][0]['type'],'door_added')
            session = self.app.state.sessions[(ID,'one')]
            before = deepcopy(session.agent.map.data)
            count = len(session.agent.messages)
            response = self.post('fail')
            self.assertEqual(response.status_code,500)
            self.assertNotIn('private failure',response.text)
            self.assertEqual(session.agent.map.data,before)
            self.assertFalse(session.agent.map.closed)
            self.assertEqual(len(session.agent.messages),count)

    def test_api_failure_is_safe_to_retry_and_does_not_expose_request(self):
        request=httpx2.Request('POST','https://api.anthropic.com',headers={'x-api-key':'secret-fixture'})
        def ask(agent,message):
            call(agent,'set_closed',element='Lift 1',closed=True)
            raise anthropic.APIConnectionError(request=request)
        with patch.object(BuildingAgent,'ask',ask):
            response=self.post('fail')
        self.assertEqual(response.status_code,502)
        self.assertNotIn('secret-fixture',response.text)
        self.assertFalse(self.app.state.sessions[(ID,'one')].agent.map.closed)

    def test_clarification_marker_is_removed_without_question_mark_guessing(self):
        with patch.object(BuildingAgent,'ask',return_value='Clarification: Which entrance?'):
            response=self.post('route').json()
        self.assertEqual(response,dict(reply='Which entrance?',understood=None,needs_clarification=True,actions=[]))
        self.assertEqual(parse_reply('The sign says "Where next?"'),('The sign says "Where next?"',None,False))

    def test_concurrent_same_session_turns_are_serialized(self):
        lock=Lock()
        active=0
        peak=0
        def ask(agent,message):
            nonlocal active,peak
            with lock:
                active+=1; peak=max(peak,active)
            time.sleep(.03)
            agent.messages.append({'role':'user','content':message})
            with lock:
                active-=1
            return 'Done.'
        with patch.object(BuildingAgent,'ask',ask),ThreadPoolExecutor(max_workers=2) as pool:
            responses=list(pool.map(self.post,['first','second']))
        self.assertTrue(all(r.status_code==200 for r in responses))
        self.assertEqual(peak,1)
        self.assertEqual(len(self.app.state.sessions[(ID,'one')].agent.messages),2)

    def test_session_id_cannot_choose_artifact_path_and_capacity_is_bounded(self):
        app=create_app(BUILDING,self.output/'bounded',client_factory=Mock,max_sessions=1)
        with TestClient(app) as client,patch.object(BuildingAgent,'ask',return_value='Hello.'):
            self.assertEqual(self.post('hi','../../outside',client).status_code,200)
            session=app.state.sessions[(ID,'../../outside')]
            self.assertTrue(session.output.is_relative_to(self.output/'bounded'))
            self.assertEqual(self.post('hi','new',client).status_code,503)

    def test_same_session_id_is_isolated_between_buildings(self):
        other='proc-campus-dev-000'
        self.app.state.catalog.add_data(json.loads((ROOT/'data/dev'/other/'building.json').read_text()))
        def ask(agent,message):
            agent.messages.append({'role':'user','content':message})
            return str(len(agent.messages))
        with patch.object(BuildingAgent,'ask',ask):
            self.assertEqual(self.post('first').json()['reply'],'1')
            response=self.client.post(f'/buildings/{other}/chat',json={'session_id':'one','message':'first'})
            self.assertEqual(response.json()['reply'],'1')
            self.assertEqual(self.post('again').json()['reply'],'2')
        self.assertIsNot(self.app.state.sessions[(ID,'one')].agent.map,
                         self.app.state.sessions[(other,'one')].agent.map)

    def test_distinct_sessions_can_run_concurrently(self):
        barrier=Barrier(2)
        def ask(agent,message):
            barrier.wait(timeout=3)
            return 'Hello.'
        with patch.object(BuildingAgent,'ask',ask),ThreadPoolExecutor(max_workers=2) as pool:
            responses=list(pool.map(lambda sid:self.post('hi',sid),['first','second']))
        self.assertTrue(all(r.status_code==200 for r in responses))

    def test_builder_hook_registers_real_output_and_rejects_external_image_paths(self):
        upload=self.output/'uploads'; upload.mkdir()
        image=upload/'floor.png'; image.write_bytes(b'test image: fake builder does not decode')
        data=json.loads((BUILDING/'building.json').read_text()); data['building']['id']='new-building'
        generated=self.output/'generated'; generated.mkdir()
        (generated/'building.json').write_text(json.dumps(data))
        builder=Mock(return_value=dict(building_id='new-building',path=str(generated),report={}))
        app=create_app(BUILDING,self.output/'built',client_factory=Mock,build_function=builder,upload_root=upload)
        def ask(agent,message):
            call(agent,'build_building',name='New building',image_paths=[str(image)])
            if message=='fail':
                raise RuntimeError('failure after building')
            return 'Understood: Build\nCreated.'
        with TestClient(app) as client,patch.object(BuildingAgent,'ask',ask):
            self.assertEqual(self.post('fail',client=client).status_code,500)
            self.assertEqual(client.get('/buildings/new-building').status_code,404)
            response=self.post('build',client=client)
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(response.json()['actions'],[{'type':'building_created','building_id':'new-building'}])
            self.assertEqual(client.get('/buildings/new-building').status_code,200)
            session=app.state.sessions[(ID,'one')]
            with self.assertRaisesRegex(Exception,'upload directory'):
                call(session.agent,'build_building',name='Bad',image_paths=[str(ROOT/'.env')])
            self.assertEqual(builder.call_count,2)


if __name__=='__main__':
    unittest.main()
