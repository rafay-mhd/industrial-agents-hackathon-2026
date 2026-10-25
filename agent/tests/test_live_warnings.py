"""Community report lifecycle and route-specific cross-session events, using real Core."""
import asyncio
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock,patch
from fastapi.testclient import TestClient
from agent.server import create_app
from agent.live_warnings import revision_events
from agent.building_updates import set_manual_closure
from agent.tests.test_navigation_updates import fixture

class LiveWarningsTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.source=self.root/'source';self.source.mkdir()
        (self.source/'building.json').write_text(json.dumps(fixture()))
        self.app=create_app(self.source,self.root/'output',client_factory=Mock)
        self.client=TestClient(self.app);self.addCleanup(self.client.close)
        self.url='/buildings/navigation-house'
    def post(self,path,**body):
        response=self.client.post(self.url+path,json=body)
        self.assertEqual(response.status_code,200,response.text)
        return response.json()
    def route(self,session='alice',destination='U',step_free=False,via=None):
        actions=self.post('/route',session_id=session,start='A',destination=destination,step_free=step_free,via=via or [])['actions']
        return next(a for a in actions if a['type']=='route')
    def report(self,target='lift',kind='lift_outage',blocks=True):
        return self.post('/warnings',session_id='bob',element_id=target,kind=kind,blocks_route=blocks,message='Doors won’t open.',reporter='Simran')
    def state(self):return self.client.get(self.url+'/changes').json()
    def sync(self,session='alice',revision=0,**body):return self.post('/sync',session_id=session,revision=revision,**body)['actions']
    def resolve(self,id):return self.post('/warnings/'+id+'/resolve',session_id='bob')

    def test_two_viewers_reroute_only_the_affected_trip(self):
        old=self.route(destination='L1');self.assertIn('lift',old['element_ids'])
        self.route('unaffected',destination='B')
        self.report();actions=self.sync()
        new=next(a for a in actions if a['type']=='route')
        self.assertIn('stairs',new['element_ids']);self.assertNotIn('lift',new['element_ids'])
        self.assertEqual(new['destination_space_id'],'L1');self.assertFalse(new['step_free'])
        notice=next(a for a in actions if a['type']=='route_update')
        self.assertTrue(notice['changed']);self.assertEqual(notice['warning_ids'],[self.state()['warnings'][0]['id']])
        quiet=self.sync('unaffected')
        self.assertEqual([a['type'] for a in quiet],['building_state'])
        self.assertTrue(quiet[0]['preserve_route']);self.assertFalse(quiet[0]['geometry_changed'])

    def test_step_free_is_never_replaced_by_stairs_and_resolution_restores(self):
        self.route(step_free=True);self.report()
        actions=self.sync()
        blocked=next(a for a in actions if a['type']=='route_unavailable')
        self.assertIn('step-free',blocked['reason']);self.assertFalse(any(a['type']=='route' for a in actions))
        self.resolve(self.state()['warnings'][0]['id'])
        restored=self.sync(revision=1)
        route=next(a for a in restored if a['type']=='route')
        self.assertTrue(route['step_free']);self.assertIn('lift',route['element_ids'])

    def test_advisory_on_route_notifies_without_replacing_route(self):
        self.route(destination='B');self.report(target='C',kind='hazard',blocks=False)
        actions=self.sync();self.assertTrue(actions[0]['preserve_route'])
        self.assertEqual([a['type'] for a in actions],['building_state','route_update'])
        self.assertFalse(actions[-1]['changed']);self.assertEqual(self.state()['closed'],[])
        self.resolve(self.state()['warnings'][0]['id'])
        self.assertIn('resolved',self.sync(revision=1)[-1]['message'])

    def test_duplicate_reports_and_manual_closure_do_not_reopen_each_other(self):
        self.report();first=self.state()['warnings'][0]['id'];self.report();second=self.state()['warnings'][1]['id']
        self.resolve(first);self.assertEqual(self.state()['closed'],['lift'])
        self.post('/changes',session_id='operator',kind='closure',element_id='lift',closed=True)
        self.resolve(second);self.assertEqual(self.state()['closed'],['lift'])
        self.post('/changes',session_id='operator',kind='closure',element_id='lift',closed=False)
        self.assertEqual(self.state()['closed'],[])

    def test_manual_reopen_and_chat_helper_cannot_override_active_warning(self):
        self.report()
        self.post('/changes',session_id='operator',kind='closure',element_id='lift',closed=False)
        self.assertEqual(self.state()['closed'],['lift'])
        agent=self.app.state.sessions[('navigation-house','operator')].agent
        set_manual_closure(agent.map,'lift',False)
        self.assertIn('lift',agent.map.closed)

    def test_warning_survives_restart_and_restores_missing_session_trip(self):
        self.report();warning=self.state()['warnings'][0]
        with TestClient(create_app(self.source,self.root/'output',client_factory=Mock)) as fresh:
            self.assertEqual(fresh.get(self.url+'/changes').json()['warnings'][0],warning)
            response=fresh.post(self.url+'/sync',json=dict(session_id='new',revision=0,planned_trip=dict(session_id='new',start='A',destination='U',via=[],step_free=True)))
            self.assertEqual(response.status_code,200,response.text)
            self.assertTrue(any(a['type']=='route_unavailable' for a in response.json()['actions']))
            self.assertTrue(fresh.app.state.sessions[('navigation-house','new')].agent.context.step_free)

    def test_landing_report_closes_entire_lift_even_if_client_requests_advisory(self):
        self.report(target='L0',blocks=False)
        self.assertEqual(self.state()['closed'],['lift']);self.assertTrue(self.state()['warnings'][0]['blocks_route'])

    def test_own_report_restores_trip_after_session_loss(self):
        trip=dict(session_id='fresh',start='A',destination='U',via=[],step_free=True)
        result=self.post('/warnings',session_id='fresh',element_id='lift',kind='lift_outage',message='Broken',planned_trip=trip)
        self.assertTrue(any(a['type']=='route_unavailable' for a in result['actions']))
        self.assertTrue(next(a for a in result['actions'] if a['type']=='route_update')['changed'])

    def test_invalid_report_does_not_change_revision(self):
        for body in [dict(element_id='missing'),dict(message='   '),dict(element_id='C',kind='lift_outage')]:
            response=self.client.post(self.url+'/warnings',json=dict(session_id='bob',**(dict(element_id='lift',kind='lift_outage',message='Broken')|body)))
            self.assertEqual(response.status_code,422,response.text)
        self.assertEqual(self.state()['revision'],0)
        self.assertEqual(self.client.post(self.url+'/warnings/missing/resolve',json=dict(session_id='bob')).status_code,404)

    def test_same_revision_is_noop_and_repeat_resolution_is_idempotent(self):
        self.report();id=self.state()['warnings'][0]['id'];self.resolve(id);revision=self.state()['revision']
        self.resolve(id);self.assertEqual(self.state()['revision'],revision)
        self.assertEqual(self.sync(revision=revision),[])

    def test_failed_persistence_rolls_back_without_broadcast(self):
        with patch('pathlib.Path.replace',side_effect=OSError('disk full')):
            with TestClient(self.app,raise_server_exceptions=False) as client:
                response=client.post(self.url+'/warnings',json=dict(session_id='bob',element_id='lift',message='Broken'))
                self.assertEqual(response.status_code,500)
        self.assertEqual(self.state()['revision'],0)
        self.assertEqual(self.app.state.sessions[('navigation-house','bob')].agent.map.closed,set())

    def test_added_door_and_stops_are_included_in_revision_sync(self):
        self.route(via=['B'])
        self.post('/changes',session_id='bob',kind='door',first='A',second='S',step_free=True)
        actions=self.sync();self.assertTrue(actions[0]['geometry_changed']);self.assertTrue(actions[0]['preserve_route'])
        self.report(target='stairs',kind='blocked_access');actions=self.sync(revision=1)
        new=next(a for a in actions if a['type']=='route')
        self.assertEqual(new['via_space_ids'],['B'])

class RevisionStreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_stream_only_sends_current_revision_and_resumes_after_last_seen(self):
        class Request:
            async def is_disconnected(self):return False
        state=dict(revision=3,closed=['lift'])
        events=revision_events(Request(),lambda:state,2)
        try:
            event=await anext(events)
            self.assertIn('id: 3',event);self.assertIn('"closed": ["lift"]',event)
            self.assertNotIn('spaces',event)
        finally:await events.aclose()
        resumed=revision_events(Request(),lambda:state,3)
        try:self.assertEqual(await anext(resumed),': connected\n\n')
        finally:await resumed.aclose()
