"""Deterministic checks of conversational state and factual tool output; no model calls."""

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from anthropic.lib.tools import ToolError
from fastapi.testclient import TestClient

from agent.agent import BuildingAgent
from agent.chat_tools import chat_tools, human_steps
from agent.context import ConversationContext
from agent.server import create_app
from core import Building

ROOT=Path(__file__).resolve().parents[2]
FACTORY=ROOT/'data/dev/proc-factory-dev-003'
START='Warehouse zone H-C2'
DEST='Office 1.20'


class ChatContextTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.output=Path(self.temp.name)
        self.building=Building.load(FACTORY)
        self.context=ConversationContext()
        self.actions=[]
        self.tools={t.name:t for t in chat_tools(self.building,self.output,self.actions,context=self.context)}

    def call(self,name,**args):
        return json.loads(self.tools[name].call(args))

    def test_planning_never_moves_the_confirmed_position(self):
        with self.assertRaisesRegex(ToolError,'starting position'):
            self.call('find_route',destination=DEST)
        self.call('remember_context',position=START,step_free=True)
        self.call('find_route',destination=DEST)
        self.assertEqual(self.context.position,self.building.resolve_space(START))
        next_route=self.call('find_route',destination='Toilet 0.22')
        self.assertEqual(next_route['start_space_id'],self.building.resolve_space(START))
        self.call('remember_context',position='Toilet 0.22')
        self.assertTrue(self.context.step_free)
        self.assertEqual(self.call('find_route',destination=DEST)['start_space_id'],self.building.resolve_space('Toilet 0.22'))

    def test_step_free_cannot_be_silently_relaxed_and_can_be_explicitly_cleared(self):
        self.call('remember_context',position=START,step_free=True)
        self.call('set_closed',element='Office lift',closed=True)
        with self.assertRaisesRegex(ToolError,'No step-free route'):
            self.call('find_route',destination=DEST,step_free=False)
        self.assertFalse(any(a['type']=='route' for a in self.actions))
        self.call('remember_context',step_free=False)
        result=self.call('find_route',destination=DEST)
        self.assertFalse(result['step_free'])
        self.assertIn('stairs',' '.join(result['steps']))

    def test_mobility_constraint_applies_to_nearest_assets_too(self):
        self.call('remember_context',step_free=True)
        with patch.object(self.building,'nearest_room_with_asset',return_value={'space_id':'fixture'}) as nearest:
            self.call('nearest_room_with_asset',start=START,item='toilet',step_free=False)
        self.assertTrue(nearest.call_args.kwargs['step_free'])

    def test_multistop_output_has_core_leg_distances_and_one_complete_action(self):
        stops=['Tool cabinet H-A2-A','CNC mill H-A1-A']
        result=self.call('find_route',start=START,destination=DEST,via=stops)
        self.assertEqual(len(result['legs']),3)
        self.assertAlmostEqual(sum(l['length_m'] for l in result['legs']),result['length_m'],places=2)
        route_actions=[a for a in self.actions if a['type']=='route']
        self.assertEqual(len(route_actions),1)
        self.assertEqual(route_actions[0]['length_m'],result['length_m'])
        self.assertEqual(route_actions[0]['floors'],self.building.route_geometry()['floors'])
        self.assertEqual(self.building.last_route.start_space_id,self.building.resolve_space(START))

    def test_edit_impacts_use_core_and_invalidate_old_route_actions(self):
        b=Building.load(ROOT/'data/dev/osm-way27917482')
        actions=[]
        tools={t.name:t for t in chat_tools(b,self.output,actions)}
        first,second='Corridor 02.06.001 (Floor 2)','Corridor 2.402 (Floor 2)'
        before=b.route(first,second).length_m
        tools['find_route'].call(dict(start=first,destination=second))
        result=json.loads(tools['add_door'].call(dict(first_space=first,second_space=second)))
        self.assertEqual(result['impact']['before_m'],before)
        self.assertIsNone(b.last_route)
        after=b.route(first,second).length_m
        self.assertEqual(result['impact']['after_m'],after)
        self.assertAlmostEqual(result['impact']['saved_m'],before-after,places=2)
        self.assertEqual([a['type'] for a in actions],['door_added'])

    def test_unknown_context_reference_is_atomic(self):
        self.call('remember_context',position=START,step_free=True)
        with self.assertRaises(ToolError):
            self.call('remember_context',position='9.99',step_free=False)
        self.assertTrue(self.context.step_free)
        self.assertEqual(self.context.position,self.building.resolve_space(START))
        self.call('remember_context',clear_position=True)
        self.assertIsNone(self.context.position)
        self.assertTrue(self.context.step_free)

    def test_ui_directions_strip_internal_ids_but_keep_human_brackets(self):
        sid=self.building.resolve_space(START)
        steps=[f'Start in Warehouse zone H-C2 [{sid}] on Ground floor.', 'Pass the label [Visitor desk].']
        self.assertEqual(human_steps(self.building,steps),
                         ['Start in Warehouse zone H-C2 on Ground floor.','Pass the label [Visitor desk].'])
        self.call('find_route',start=START,destination=DEST)
        self.assertNotIn('proc-factory-dev-003',' '.join(self.actions[0]['steps']))

    def test_http_error_rolls_back_context_with_building_and_history(self):
        app=create_app(FACTORY,self.output,client_factory=Mock)
        def ask(agent,message):
            tools={t.name:t for t in agent.tools}
            tools['remember_context'].call(dict(position=START,step_free=True))
            raise RuntimeError('failed turn')
        with TestClient(app) as client,patch.object(BuildingAgent,'ask',ask):
            response=client.post('/buildings/proc-factory-dev-003/chat',json=dict(session_id='x',message='hello'))
        self.assertEqual(response.status_code,500)
        context=app.state.sessions[('proc-factory-dev-003','x')].agent.context
        self.assertEqual(context,ConversationContext())


if __name__=='__main__':
    unittest.main()
