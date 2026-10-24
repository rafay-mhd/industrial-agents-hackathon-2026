"""Claude tools: delegate facts to Core, preserve labels, and bound supporting lists."""

from dataclasses import asdict, is_dataclass
import json
import math
from pathlib import Path
from typing import Literal

from anthropic import beta_tool
from anthropic.lib.tools import ToolError

from core import Building, MapError
from starter_agent.tools import make_tools as make_starter_tools

MAX_SUPPORTING_ROWS = 20
SUPPORTING_LISTS = {"rooms", "rooms_improved", "assets", "results"}
SUMMARY_KEYS = ("label", "total_m2", "total_m", "distance_m", "area_m2", "count", "name")


def compact_result(value: object) -> object:
    """Limit supporting lists, never totals, route points, directions or vocabularies."""
    if is_dataclass(value):
        value = asdict(value)
    if isinstance(value, dict):
        ordered = [key for key in SUMMARY_KEYS if key in value]
        ordered += [key for key in value if key not in ordered]
        result = {}
        for key in ordered:
            item = value[key]
            if key in SUPPORTING_LISTS and isinstance(item, list):
                result[key] = [compact_result(row) for row in item[:MAX_SUPPORTING_ROWS]]
                if len(item) > MAX_SUPPORTING_ROWS:
                    result[f"{key}_total"] = len(item)
                    result[f"{key}_shown"] = MAX_SUPPORTING_ROWS
                    result[f"{key}_truncated"] = True
            else:
                result[key] = compact_result(item)
        return result
    if isinstance(value, (list, tuple)):
        return [compact_result(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        # Hypothetical routes can have an infinite 'before' distance. Preserve the
        # distinction as a string instead of emitting invalid JSON numeric tokens.
        return str(value)
    return value


def as_json(value: object) -> str:
    return json.dumps(compact_result(value), ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def make_tools(building: Building, output_directory: Path = Path("agent_output")) -> list:
    """Keep the six starter tools and expose Core's computation/lookup methods."""
    output_directory.mkdir(parents=True, exist_ok=True)

    def call(method: str, *args, **kwargs):
        function = getattr(building, method, None)
        if not callable(function):
            raise ToolError(f"{method} is not available yet in this building implementation.")
        try:
            return function(*args, **kwargs)
        except MapError as error:
            raise ToolError(str(error)) from error
        except NotImplementedError as error:
            raise ToolError(f"{method} is not available yet in this building implementation.") from error

    @beta_tool
    def total_area(floor: str | int, room_type: str) -> str:
        """Total square metres of all rooms of one type on one floor; use for floor_area_total.

        Args:
            floor: Copy floor words exactly, e.g. 'ground floor', 'Floor 2', 'Basement 1'; levels also work.
            room_type: Copy type words from the question, e.g. 'office', 'meeting room', 'generic room'.
        """
        return as_json(call("total_area", floor, room_type))

    @beta_tool
    def largest_room(floor: str | int, room_type: str | None = None) -> str:
        """Largest room and its area on a floor. Use the returned label, including its room number.

        Args:
            floor: Copy floor words exactly, e.g. 'ground floor', 'Floor 2', 'Basement 1'.
            room_type: Copy type words exactly, e.g. 'kitchen', 'meeting room', 'generic room'. Omit for any type.
        """
        return as_json(call("largest_room", floor, room_type))

    @beta_tool
    def straight_line_3d(first_room: str, second_room: str) -> str:
        """3D distance between polygon centroids at floor elevations, not walking distance.

        Args:
            first_room: Copy the first room exactly, including any '(Floor 1)' part.
            second_room: Copy the second room exactly, including any '(Floor 1)' part.
        """
        return as_json(call("straight_line_3d", first_room, second_room))

    @beta_tool
    def shared_wall_rooms(room: str) -> str:
        """Count other rooms sharing at least 1 m of wall, with or without a door; excludes corridors/stairs/lifts.

        Args:
            room: Copy the room exactly as written, including any '(Floor 1)' part.
        """
        return as_json(call("shared_wall_rooms", room))

    @beta_tool
    def stacked_room(room: str, direction: Literal["above", "below"]) -> str:
        """Room directly above or below by greatest polygon overlap; use its returned label in the answer.

        Args:
            room: Copy the room exactly as written, including any '(Floor 1)' part.
            direction: 'above' for a ceiling leak source, 'below' for water leaking through this room's floor.
        """
        return as_json(call("stacked_room", room, direction))

    @beta_tool
    def reachable_rooms(start: str, floor: str | int, step_free: bool = True,
                        min_width_m: float | None = None, closed: list[str] | None = None) -> str:
        """Count reachable rooms for wide deliveries or lift-closure accessibility questions.

        Args:
            start: Copy the starting room exactly, including any '(Floor 1)' part.
            floor: Copy the floor to COUNT rooms on, e.g. 'Floor 2'; it can differ from the start floor.
            step_free: True for wheelchairs or trolleys: lifts allowed, stairs and steps excluded.
            min_width_m: Required minimum door width in metres, e.g. 1.1 for a 1.1 m trolley.
            closed: Names/ids of closed lifts, doors or rooms. Applies to this calculation without editing session closures.
        """
        return as_json(call("reachable_rooms", start, floor, step_free=step_free,
                            min_width_m=min_width_m, closed=closed or []))

    @beta_tool
    def errand(start: str, item: str, floor: str | int, room_type: str, step_free: bool = False) -> str:
        """Total walk: start → nearest room with the item → largest room of the requested type and floor.

        Args:
            start: Copy the starting room exactly, including any '(Floor 1)' part.
            item: Copy item type words, e.g. 'stove', 'ups unit', 'office chair'.
            floor: Copy destination floor words exactly, e.g. 'ground floor', 'Floor 2'.
            room_type: Copy destination type words, e.g. 'kitchen', 'meeting room'.
            step_free: False when the person can carry it on stairs; true only if stairs/steps are forbidden.
        """
        return as_json(call("errand", start, item, floor, room_type, step_free=step_free))

    @beta_tool
    def what_if_door(first_room: str, second_room: str, floor: str | int, threshold_m: float = 1.0) -> str:
        """Simulate a shared-wall door; count rooms whose walk to an exit improves by more than threshold_m.

        This is a hypothetical calculation, not a persistent edit. Use add_door to actually add a door.

        Args:
            first_room: Copy the first room/corridor exactly, including any '(Floor 1)' part.
            second_room: Copy the second room/corridor exactly, including any '(Floor 1)' part.
            floor: Copy the floor to COUNT improved rooms on; often different from the door's floor.
            threshold_m: Strict improvement threshold in metres; default 'more than 1 m'.
        """
        return as_json(call("what_if_door", first_room, second_room, floor, threshold_m=threshold_m))

    @beta_tool
    def rooms(floor: str | int, room_type: str | None = None) -> str:
        """List rooms largest first with labels and areas; count is complete, supporting rows limited to 20.

        Args:
            floor: Copy floor words exactly, e.g. 'ground floor', 'Floor 2', 'Basement 1'.
            room_type: Optional type words, e.g. 'office' or 'generic room'.
        """
        rows = call("rooms", floor, room_type)
        return as_json({"count": len(rows), "rooms": rows})

    @beta_tool
    def nearest_room_with_asset(start: str, item: str, step_free: bool = False, include_start: bool = False) -> str:
        """Find the room holding an item nearest by walking distance (not straight-line distance).

        Args:
            start: Copy starting room exactly, including any '(Floor 1)' part.
            item: Item type words as written, e.g. 'coffee machine'.
            step_free: True to forbid stairs and steps.
            include_start: Whether an item already in the starting room counts; false for benchmark errands.
        """
        return as_json(call("nearest_room_with_asset", start, item,
                            step_free=step_free, include_start=include_start))

    @beta_tool
    def distance_to_exit(room: str, step_free: bool = False) -> str:
        """Shortest walking distance from a room to its nearest building entrance/exit.

        Args:
            room: Copy room exactly, including any '(Floor 1)' part.
            step_free: True to forbid stairs and steps.
        """
        return as_json({"distance_m": call("distance_to_exit", room, step_free=step_free)})

    @beta_tool
    def area_m2(room: str) -> str:
        """Area of one room in square metres, computed by Core from its polygon.

        Args:
            room: Copy room exactly, including any '(Floor 1)' part.
        """
        return as_json({"area_m2": call("area_m2", room)})

    @beta_tool
    def centroid_3d(room: str) -> str:
        """Room polygon centroid x/y and floor elevation z, in metres.

        Args:
            room: Copy room exactly, including any '(Floor 1)' part.
        """
        return as_json(call("centroid_3d", room))

    @beta_tool
    def resolve_space(room: str, floor: str | int | None = None) -> str:
        """Resolve a room or item to a space id; ambiguous references return candidates as a tool error.

        Args:
            room: Exact room/item name, number or id; preserve any '(Floor 1)' suffix from the question.
            floor: Optional floor words/level to disambiguate repeated room names.
        """
        return as_json({"space_id": call("resolve_space", room, floor=floor)})

    @beta_tool
    def resolve_floor(floor: str | int) -> str:
        """Resolve floor words or a level to a floor id.

        Args:
            floor: Copy floor words exactly, e.g. 'ground floor', 'Floor 2', 'Basement 1'.
        """
        return as_json({"floor_id": call("resolve_floor", floor)})

    @beta_tool
    def room_types(floor: str | int | None = None) -> str:
        """List all valid room type words, optionally on one floor; use to recover from a type error.

        Args:
            floor: Optional floor words/level, e.g. 'ground floor'.
        """
        return as_json({"room_types": call("room_types", floor)})

    @beta_tool
    def asset_types(floor: str | int | None = None) -> str:
        """List all valid item type words, optionally on one floor.

        Args:
            floor: Optional floor words/level, e.g. 'ground floor'.
        """
        return as_json({"asset_types": call("asset_types", floor)})

    @beta_tool
    def assets_of_type(item: str, floor: str | int | None = None) -> str:
        """Count/list items of a type and their locations; count is complete even if the list is truncated.

        Args:
            item: Copy item type words, e.g. 'office chair', 'cnc mill'.
            floor: Optional floor words/level; omit to count throughout the building.
        """
        rows = call("assets_of_type", item, floor)
        return as_json({"count": len(rows), "assets": rows})

    @beta_tool
    def route_geometry() -> str:
        """Return the last route's full per-floor points for display; call find_route first."""
        return as_json(call("route_geometry"))

    return make_starter_tools(building, output_directory) + [
        total_area, largest_room, straight_line_3d, shared_wall_rooms, stacked_room,
        reachable_rooms, errand, what_if_door, rooms, nearest_room_with_asset,
        distance_to_exit, area_m2, centroid_3d, resolve_space, resolve_floor,
        room_types, asset_types, assets_of_type, route_geometry,
    ]
