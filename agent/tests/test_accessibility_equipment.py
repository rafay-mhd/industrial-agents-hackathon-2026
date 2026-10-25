"""Reachability and equipment warnings share Core paths without altering challenge data."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock,patch
from fastapi.testclient import TestClient
from agent.server import create_app
from agent.tests.test_navigation_updates import fixture
from agent.chat_tools import chat_tools
from agent.context import ConversationContext
from agent.reports import create_report,nearest_available_asset
from agent.accessibility import accessibility_pulse,PulseRequest
from core import Building,MapError


def equipment_fixture():
    data=fixture()
    data['assets']=[dict(id=id,name=name,type=kind,space_id=space,floor_id=floor,position=point) for id,name,kind,space,floor,point in [
        ('coffee-near','Coffee machine · corner','coffee_machine','C','g',[10,2]),
        ('coffee-far','Coffee machine · studio','coffee_machine','B','g',[10,14]),
        ('printer','3D printer','printer_3d','U','u',[10,2])]]
    return data

class EquipmentPulseTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);source=self.root/'source';source.mkdir()
        (source/'building.json').write_text(json.dumps(equipment_fixture()))
        self.app=create_app(source,self.root/'output',client_factory=Mock)
        self.client=TestClient(self.app);self.addCleanup(self.client.close)
        self.url='/buildings/navigation-house'
    def post(self,path,**body):
        r=self.client.post(self.url+path,json=body);self.assertEqual(r.status_code,200,r.text);return r.json()
    def report(self,element='coffee-near',**extra):
        return self.post('/warnings',**(dict(session_id='reporter',element_id=element,message='The machine does not work.',kind='equipment_outage',blocks_route=False)|extra))
    def state(self):return self.client.get(self.url+'/changes').json()
    def plan(self,destination='coffee-near',**extra):
        return self.post('/route',**(dict(session_id='walker',start='A',destination=destination,step_free=True)|extra))['actions']
    def sync(self,revision=0):return self.post('/sync',session_id='walker',revision=revision)['actions']

    def test_pulse_uses_lift_outage_and_resolution_and_width_filters(self):
        pulse=lambda **p:self.post('/accessibility',**(dict(start='A',step_free=True)|p))
        self.assertIn('U',pulse()['reachable_space_ids']);self.assertNotIn('S',pulse()['reachable_space_ids'])
        self.report('lift',kind='lift_outage')
        self.assertNotIn('U',pulse()['reachable_space_ids'])
        self.assertIn('U',pulse(step_free=False)['reachable_space_ids'])
        self.post('/warnings/'+self.state()['warnings'][0]['id']+'/resolve',session_id='reporter')
        self.assertIn('U',pulse()['reachable_space_ids'])
        self.assertEqual(pulse(min_width_m=1.1)['reachable_space_ids'],['A'])
        self.assertEqual(self.state()['revision'],2) # Queries are read-only.

    def test_equipment_outage_does_not_close_room_and_stops_target_trip(self):
        self.plan();self.report()
        self.assertEqual(self.state()['closed'],[])
        self.assertEqual(self.state()['unavailable_assets'],['coffee-near'])
        actions=self.sync();self.assertTrue(any(a['type']=='route_unavailable' for a in actions))
        room_route=self.plan(destination='B');self.assertTrue(any(a['type']=='route' for a in room_route))
        self.assertIn('C',self.post('/accessibility',start='A')['reachable_space_ids'])

    def test_nearest_item_adapts_to_another_available_item(self):
        old=next(a for a in self.plan(destination='nearest:coffee_machine',asset_query='coffee machine') if a['type']=='route')
        self.assertEqual(old['destination_asset_id'],'coffee-near')
        self.report();actions=self.sync()
        new=next(a for a in actions if a['type']=='route')
        self.assertEqual(new['destination_asset_id'],'coffee-far');self.assertTrue(new['step_free'])
        self.assertEqual(new['asset_query'],'coffee machine');self.assertIn('coffee-far',new['element_ids'])
        self.assertTrue(next(a for a in actions if a['type']=='route_update')['changed'])
        self.report('coffee-far');unavailable=next(a for a in self.sync(1) if a['type']=='route_unavailable')
        self.assertIn('active equipment-outage reports',unavailable['reason'])
        self.assertNotIn('No step-free route is available',unavailable['reason'])
        self.assertTrue(any(a['type']=='route' for a in self.plan(destination='B')))

    def test_outage_does_not_interrupt_unrelated_room_route(self):
        self.plan(destination='B');self.report()
        actions=self.sync();self.assertEqual([a['type'] for a in actions],['building_state'])
        self.assertTrue(actions[0]['preserve_route'])

    def test_arbitrary_text_and_wet_stairs_are_cautions_until_explicitly_blocked(self):
        self.report('stairs',kind='hazard',message='Wet stairs after cleaning; please use caution.')
        self.assertEqual(self.state()['closed'],[])
        self.report('A',kind='other',message='A lost scarf was left on the reception desk.')
        self.assertEqual(self.state()['closed'],[])
        self.report('stairs',kind='blocked_access',blocks_route=True,message='Stairs are blocked by scaffolding.')
        self.assertEqual(self.state()['closed'],['stairs'])

    def test_chat_tools_report_and_avoid_unavailable_equipment(self):
        b=Building(equipment_fixture());context=ConversationContext();actions=[]
        tools={t.name:t for t in chat_tools(b,self.root/'tools',actions,context=context)}
        report=json.loads(tools['report_warning'].call(dict(element='coffee-near',message='Out of order',kind='equipment_outage')))
        self.assertTrue(report['posted']);self.assertEqual(b.closed,set())
        nearest=json.loads(tools['nearest_room_with_asset'].call(dict(start='A',item='coffee machine',step_free=True)))
        self.assertEqual(nearest['asset_id'],'coffee-far')
        tools['find_route'].call(dict(start='A',destination=nearest['asset_id'],asset_query='coffee machine',step_free=True))
        self.assertEqual(actions[-1]['destination_asset_id'],'coffee-far')
        self.assertEqual(context.trip['asset_query'],'coffee machine')

    def test_asset_names_cannot_bypass_outage_and_via_identity_survives(self):
        self.report('printer')
        actions=self.plan(destination='3D printer')
        self.assertTrue(any(a['type']=='route_unavailable' for a in actions))
        actions=self.plan(destination='B',via=['Coffee machine · corner'])
        route=next(a for a in actions if a['type']=='route')
        self.assertEqual(route['via_place_ids'],['coffee-near'])
        self.report('coffee-near')
        self.assertTrue(any(a['type']=='route_unavailable' for a in self.sync(1)))

    def test_report_tool_returns_the_automatic_trip_update_for_the_reply(self):
        b=Building(equipment_fixture());context=ConversationContext();actions=[]
        tools={t.name:t for t in chat_tools(b,self.root/'tools',actions,context=context)}
        tools['find_route'].call(dict(start='A',destination='coffee-near',asset_query='coffee machine',step_free=True))
        result=json.loads(tools['report_warning'].call(dict(element='coffee-near',message='Broken',kind='equipment_outage')))
        self.assertEqual(result['active_trip']['destination'],'Coffee machine · studio')
        self.assertTrue(result['active_trip']['automatically_updated'])
        self.assertEqual([a['destination_asset_id'] for a in actions if a['type']=='route'],['coffee-far'])

    def test_chat_report_is_published_and_internal_event_is_not_exposed(self):
        def ask(agent,message):
            tool=next(t for t in agent.tools if t.name=='report_warning')
            tool.call(dict(element='printer',message='Printer jammed',kind='equipment_outage'))
            return 'Understood: The 3D printer is jammed.\nI posted your report.'
        # The runner's HTTP transaction must publish warning_changed just like a door/closure.
        from agent.agent import BuildingAgent
        with patch.object(BuildingAgent,'ask',ask):
            response=self.client.post(self.url+'/chat',json=dict(session_id='speaker',message='The 3D printer is jammed.'))
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(self.state()['unavailable_assets'],['printer'])
        self.assertTrue(any(a['type']=='building_state' for a in response.json()['actions']))
        self.assertFalse(any(a['type']=='warning_changed' for a in response.json()['actions']))

    def test_asset_route_cannot_make_its_room_impassable_and_missing_targets_are_rejected(self):
        for target in ['coffee-near','missing-item']:
            response=self.client.post(self.url+'/warnings',json=dict(session_id='r',element_id=target,kind='blocked_access',blocks_route=True,message='Cannot use it'))
            self.assertEqual(response.status_code,422,response.text)
        self.assertEqual(self.state()['revision'],0)

    def test_report_resolution_reenables_item_but_another_report_keeps_it_unavailable(self):
        self.report();self.report();warnings=self.state()['warnings']
        self.post('/warnings/'+warnings[0]['id']+'/resolve',session_id='r')
        self.assertEqual(self.state()['unavailable_assets'],['coffee-near'])
        self.post('/warnings/'+warnings[1]['id']+'/resolve',session_id='r')
        self.assertEqual(self.state()['unavailable_assets'],[])

    def test_resolve_restores_nearest_trip_when_every_matching_item_is_unavailable(self):
        self.report();self.report('coffee-far')
        warning=self.state()['warnings'][0]
        trip=dict(session_id='fresh',start='A',destination='nearest:coffee_machine',
                  asset_query='coffee machine',via=['C'],step_free=True)
        # Reproduce the browser's failed search followed by Resolve, including after session loss.
        actions=self.post('/route',**trip)['actions']
        self.assertTrue(any(a['type']=='route_unavailable' for a in actions))
        self.post('/sync',session_id='observer',revision=0,planned_trip=trip)
        actions=self.post('/warnings/'+warning['id']+'/resolve',session_id='resolver',planned_trip=trip)['actions']
        route=next(a for a in actions if a['type']=='route')
        self.assertEqual(route['destination_asset_id'],'coffee-near')
        self.assertEqual(route['via_space_ids'],['C']);self.assertTrue(route['step_free'])
        self.assertEqual(self.state()['unavailable_assets'],['coffee-far'])
        self.assertEqual(self.state()['warnings'][0]['status'],'resolved')
        shared=self.post('/sync',session_id='observer',revision=2)['actions']
        self.assertEqual(next(a for a in shared if a['type']=='route')['destination_asset_id'],'coffee-near')
        with TestClient(create_app(self.root/'source',self.root/'output',client_factory=Mock)) as fresh:
            state=fresh.get(self.url+'/changes').json()
            self.assertEqual(state['warnings'][0]['status'],'resolved')
            self.assertEqual(state['unavailable_assets'],['coffee-far'])

    def test_blocked_nearest_search_does_not_prevent_reporting_or_sync(self):
        self.report();self.report('coffee-far')
        trip=dict(session_id='fresh',start='A',destination='nearest:coffee_machine',asset_query='coffee machine')
        actions=self.post('/sync',session_id='fresh',revision=0,planned_trip=trip)['actions']
        self.assertEqual(actions[0]['building']['building']['revision'],2)
        self.post('/warnings',session_id='another',element_id='printer',kind='hazard',message='Please keep clear.',planned_trip=trip)
        self.assertEqual(self.state()['warnings'][-1]['element_id'],'printer')

    def test_repeat_resolution_refreshes_stale_viewer_and_restores_its_route(self):
        self.report('printer')
        warning=self.state()['warnings'][0]
        self.plan('printer')
        self.post('/warnings/'+warning['id']+'/resolve',session_id='other')
        revision=self.state()['revision']
        actions=self.post('/warnings/'+warning['id']+'/resolve',session_id='walker')['actions']
        state=next(a for a in actions if a['type']=='building_state')['building']
        self.assertEqual(state['building']['live_warnings'][0]['status'],'resolved')
        self.assertTrue(any(a['type']=='route' for a in actions))
        self.assertEqual(self.state()['revision'],revision)

    def test_new_door_changes_pulse_without_inventing_missing_connections(self):
        self.assertNotIn('S',self.post('/accessibility',start='A')['reachable_space_ids'])
        self.post('/changes',session_id='r',kind='door',first='A',second='S',step_free=True)
        self.assertIn('S',self.post('/accessibility',start='A')['reachable_space_ids'])
