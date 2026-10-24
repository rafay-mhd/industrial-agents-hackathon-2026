"""Capture UI actions at successful tool execution, before later calls change state."""

from copy import deepcopy
import json
from pathlib import Path
from typing import Callable

from anthropic import beta_tool
from anthropic.lib.tools import BetaBuiltinFunctionTool, ToolError

from agent.tools import make_tools, as_json
from core import Building


class ActionTool(BetaBuiltinFunctionTool):
    def __init__(self, tool, building: Building, actions: list[dict]):
        self.tool, self.building, self.actions = tool, building, actions

    def to_dict(self):
        return self.tool.to_dict()

    def call(self, input):
        output = self.tool.call(input)
        result = json.loads(output)
        action = None
        if self.name == 'find_route':
            geometry = self.building.route_geometry(self.building.last_route)
            action = dict(type='route', length_m=result['length_m'], steps=result['steps'], floors=geometry['floors'])
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
            self.actions.append(deepcopy(action))
        return output


def chat_tools(building: Building, output: Path, actions: list[dict],
               build: Callable | None = None, register: Callable | None = None,
               upload_root: Path | None = None) -> list:
    tools = [ActionTool(tool, building, actions) for tool in make_tools(building, output)]
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
