"""Capture UI actions at successful tool execution, before later calls change state."""

from copy import deepcopy
from dataclasses import asdict
import json
import re
from pathlib import Path
from typing import Callable

from anthropic import beta_tool
from anthropic.lib.tools import BetaBuiltinFunctionTool, ToolError

from agent.tools import make_tools, as_json
from core import Building, MapError
from agent.context import ConversationContext
from agent.navigation import display_route
from agent.building_updates import door_position, set_manual_closure


def human_steps(building: Building, steps: list[str]) -> list[str]:
    """Strip Core's bracketed internal references from directions displayed by the UI."""
    def replace(match):
        ref = match.group(1)
        if ref in building.spaces or ref in building.assets or ref in building.openings or ref in building.connectors:
            return ''
        return match.group(0)
    return [re.sub(r'\s*\[([^\]]+)\]', replace, step) for step in steps]


class ActionTool(BetaBuiltinFunctionTool):
    def __init__(self, tool, building: Building, actions: list[dict], context: ConversationContext):
        self.tool, self.building, self.actions = tool, building, actions
        self.context = context

    def to_dict(self):
        return self.tool.to_dict()

    def call(self, input):
        if self.context.step_free and self.name in {
            'find_route', 'nearest_room_with_asset', 'errand', 'distance_to_exit', 'reachable_rooms'
        }:
            input = {**input, 'step_free': True}
        output = self.tool.call(input)
        result = json.loads(output)
        action = None
        if self.name == 'find_route':
            action=display_route(self.building,result,self.context.trip)
            action['steps']=human_steps(self.building,result['steps'])
        elif self.name == 'search_building':
            spaces = {r['id'] for r in result['results'] if r['kind'] == 'space'}
            assets = {r['id'] for r in result['results'] if r['kind'] == 'asset'}
            spaces.update(self.building.assets[item]['space_id'] for item in assets)
            action = dict(type='highlight', space_ids=sorted(spaces), asset_ids=sorted(assets))
        elif self.name == 'set_closed':
            # Complete current set: reopening is represented by removing its ID.
            action = dict(type='closed', element_ids=result['all_closed'])
        elif self.name == 'add_door':
            action = dict(type='door_added', opening=result['added'])
        if action is not None:
            if self.name in {'set_closed', 'add_door'}:
                self.actions[:] = [a for a in self.actions if a['type'] != 'route']
                self.building.last_route = None
            self.actions.append(deepcopy(action))
        return output


def chat_tools(building: Building, output: Path, actions: list[dict],
               build: Callable | None = None, register: Callable | None = None,
               upload_root: Path | None = None, context: ConversationContext | None = None) -> list:
    context = context if context is not None else ConversationContext()
    originals = {tool.name: tool for tool in make_tools(building, output)}

    @beta_tool
    def remember_context(position: str | None = None, step_free: bool | None = None,
                         clear_position: bool = False) -> str:
        """Remember only the user's explicitly stated location and mobility needs for this session.

        Args:
            position: User-confirmed current room/item, explicit route start or arrival. Never a planned destination.
            step_free: True for wheelchair/no-stairs needs; false ONLY when the user explicitly withdraws that need.
            clear_position: True if the user says their current location is unknown; cannot accompany position.
        """
        if clear_position and position is not None:
            raise ToolError('Choose a confirmed position or clear the position, not both.')
        try:
            resolved = building.resolve_space(position) if position is not None else None
        except MapError as exc:
            raise ToolError(str(exc)) from exc
        if clear_position:
            context.position = None
        elif position is not None:
            context.position = resolved
        if step_free is not None:
            context.step_free = step_free
        return as_json(asdict(context))

    @beta_tool
    def find_route(destination: str, start: str | None = None, step_free: bool = False,
                   via: list[str] | None = None) -> str:
        """Core walking route, including each ordered leg's distance for a multi-stop trip.

        Args:
            destination: Final room/item; preserve the user's exact name or use a resolved ID.
            start: Explicit starting room/item; omit to use the remembered user-confirmed position.
            step_free: True to forbid steps; a remembered accessibility requirement always stays active.
            via: Intermediate room/item references in visit order, excluding the final destination.
        """
        start = start or context.position
        if start is None:
            raise ToolError('The starting position is unknown. Ask the user where they are.')
        try:
            route = building.route(start, destination, step_free or context.step_free, via)
            result = asdict(route)
            result["distance_note"]="Total distance is walking-equivalent metres: stairs cost 2 m per metre of height; a lift costs 15 m for waiting/doors plus 1 m per metre of height. Individual walking instructions omit these transfer allowances; do not add them again."
            context.trip=dict(start=route.start_space_id,destination=route.destination_space_id,
                              via=[building.resolve_space(s) for s in via or []],step_free=route.step_free)
            if via:
                route_points = deepcopy(building.last_route_points)
                stops = [start, *via, destination]
                legs = []
                try:
                    for first, second in zip(stops, stops[1:]):
                        leg = building.route(first, second, step_free or context.step_free)
                        legs.append(dict(start=first, destination=second, length_m=leg.length_m, steps=leg.steps))
                finally:
                    building.last_route = route
                    building.last_route_points = route_points
                result['legs'] = legs
            return as_json(result)
        except MapError as exc:
            raise ToolError(str(exc)) from exc

    @beta_tool
    def add_door(first_space: str, second_space: str, step_free: bool = False) -> str:
        """Add a real building door and report Core's before/after walk between its two rooms.

        Args:
            first_space: First adjacent room or corridor, exactly named by the user.
            second_space: Second adjacent room or corridor, exactly named by the user.
            step_free: Whether the user confirmed this door has no step; defaults false until confirmed.
        """
        previous_route = building.last_route
        previous_points = deepcopy(building.last_route_points)
        def distance():
            try:
                return building.route(first_space, second_space, context.step_free).length_m
            except MapError:
                return None
        try:
            before = distance()
            result = dict(added=building.add_door(first_space,second_space,step_free,door_position(building,first_space,second_space)))
            after = distance()
            result['impact'] = dict(before_m=before, after_m=after,
                                    saved_m=round(before-after, 2) if before is not None and after is not None else None,
                                    step_free=context.step_free)
            return as_json(result)
        finally:
            # Internal comparisons do not invent a new user route or position.
            building.last_route = previous_route
            building.last_route_points = previous_points

    @beta_tool
    def set_closed(element:str,closed:bool)->str:
        """Close/reopen a direct closure. Active community warnings remain until resolved.

        Args:
            element: Named lift, stairs, room or door to update.
            closed: True to close, False to remove its direct closure.
        """
        try:
            identifier=set_manual_closure(building,element,closed)
            return as_json(dict(element_id=identifier,closed=identifier in building.closed,
                all_closed=sorted(building.closed),active_warning_blocks=not closed and identifier in building.closed))
        except MapError as error:raise ToolError(str(error)) from error

    originals['find_route'], originals['add_door'] = find_route, add_door
    originals['set_closed']=set_closed
    tools = [ActionTool(tool, building, actions, context) for tool in originals.values()]
    tools.append(remember_context)
    if build is None:
        return tools

    @beta_tool
    def build_building(name: str, image_paths: list[str]) -> str:
        """Create a building from supplied floor-plan images. Only use image paths supplied by the user.

        Args:
            name: Name for the new building.
            image_paths: User-supplied floor-plan image paths in the configured upload directory.
        """
        if not name.strip() or len(name) > 200 or not 1 <= len(image_paths) <= 20:
            raise ToolError('Provide a building name and 1–20 floor-plan images.')
        paths = []
        for value in image_paths:
            path = Path(value).resolve()
            if (upload_root is None or not path.is_relative_to(upload_root.resolve())
                    or path.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp'} or not path.is_file()):
                raise ToolError('Use existing floor-plan images from the configured upload directory.')
            paths.append(str(path))
        result = build(name=name, image_paths=paths)
        try:
            created = Building.load(Path(result['path']))
            identifier = created.data['building']['id']
            if identifier != result['building_id']:
                raise ValueError('Builder output ID does not match the generated building.')
            register(created)
        except (KeyError, TypeError, ValueError, OSError) as exc:
            raise ToolError(f'Builder output could not be registered: {exc}') from exc
        actions.append(dict(type='building_created', building_id=identifier))
        return as_json(result)

    return tools + [build_building]
