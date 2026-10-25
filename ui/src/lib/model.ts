import type {
  BuildingData,
  Floor,
  Space,
  Opening,
  RouteAction,
  ChatAction,
} from "../types";

export type Point = [number, number];
export type Bounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
};
export type Location = { spaceId: string; floorId: string; position: Point };
export type Layers = {
  labels: boolean;
  openings: boolean;
  assets: boolean;
  route: boolean;
};
export type MapState = {
  route: RouteAction | null;
  spaces: string[];
  assets: string[];
  closed: string[];
  doors: Opening[];
};
export const emptyMapState: MapState = {
  route: null,
  spaces: [],
  assets: [],
  closed: [],
  doors: [],
};

export function visibleClosures(data: BuildingData, closed: string[]) {
  const ids = new Set(closed);
  for (const connector of data.vertical_connectors ?? [])
    if (ids.has(connector.id))
      for (const id of connector.space_ids) ids.add(id);
  return ids;
}

export function applyMapActions(
  state: MapState,
  actions: ChatAction[],
): MapState {
  // Edits invalidate old routes, even when an empty closure set reopens a door.
  const next = {
    ...state,
    route: actions.some((a) => a.type === "closed" || a.type === "door_added")
      ? null
      : state.route,
  };
  for (const action of actions) {
    if (action.type === "closed") next.closed = [...action.element_ids];
    if (action.type === "highlight") {
      next.spaces = action.space_ids ?? [];
      next.assets = action.asset_ids ?? [];
    }
    if (action.type === "door_added")
      next.doors = [
        ...next.doors.filter((d) => d.id !== action.opening.id),
        action.opening,
      ];
  }
  // A route calculated in the same response already accounts for its edits.
  for (const action of actions)
    if (action.type === "route") next.route = action;
  return next;
}

export const label = (space: Space) =>
  space.name || (space.ref ? `Room ${space.ref}` : space.id);
export const category = (space: Space) =>
  (space.room_type || space.type || "room").replaceAll("_", " ");
export function palette(space: Space) {
  const type = (
    space.room_type && space.room_type !== "generic_room"
      ? space.room_type
      : space.type
  ).toLowerCase();
  // A production/warehouse zone can have type "hall". Its supplied purpose
  // takes precedence over the generic structural type.
  if (/production|assembly|additive|manufactur|workshop/.test(type))
    return {
      fill: "#c7d5ef",
      solid: "#5277b6",
      ink: "#254478",
      group: "Production",
    };
  if (/warehouse|logistics|storage/.test(type))
    return {
      fill: "#dfc9b7",
      solid: "#ba8560",
      ink: "#765239",
      group: "Storage & logistics",
    };
  if (/lab|quality|server|technical/.test(type))
    return {
      fill: "#c6d9d2",
      solid: "#589381",
      ink: "#38675b",
      group: "Labs & services",
    };
  if (/corridor|^hall$|lobby/.test(type))
    return {
      fill: "#eee3cb",
      solid: "#c1a366",
      ink: "#706044",
      group: "Circulation",
    };
  if (/stair|lift/.test(type))
    return {
      fill: "#c4cdec",
      solid: "#5367aa",
      ink: "#294879",
      group: "Stairs & lifts",
    };
  if (/toilet|bath|wc/.test(type))
    return {
      fill: "#ddd1e5",
      solid: "#9e80b0",
      ink: "#685575",
      group: "Facilities",
    };
  if (
    /kitchen|canteen|living|meeting|seminar|lounge|lecture|classroom|library/.test(
      type,
    )
  )
    return {
      fill: "#eacac1",
      solid: "#bb716a",
      ink: "#874e47",
      group: "Shared spaces",
    };
  if (/outdoor|balcony|terrace|garden/.test(type))
    return {
      fill: "#d6dfc4",
      solid: "#8a9f64",
      ink: "#5a694b",
      group: "Outdoors",
    };
  return {
    fill: "#d0deea",
    solid: "#6c96b8",
    ink: "#304b76",
    group: "Rooms & workspaces",
  };
}

export function boundsOf(points: Point[]): Bounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!points.length) {
    minX = minY = 0;
    maxX = maxY = 10;
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: Math.max(maxX - minX, 0.1),
    height: Math.max(maxY - minY, 0.1),
  };
}

export function polygonArea(points: Point[]) {
  return (
    Math.abs(
      points.reduce((sum, [x, y], i) => {
        const p = points[(i + 1) % points.length];
        return sum + x * p[1] - p[0] * y;
      }, 0),
    ) / 2
  );
}

export function pointInside([x, y]: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i],
      [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

export function projectToSegment(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = Math.hypot(dx, dy);
  const t = length
    ? Math.max(
        0,
        Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length ** 2),
      )
    : 0;
  const point: Point = [a[0] + dx * t, a[1] + dy * t];
  return {
    point,
    t,
    length,
    distance: Math.hypot(point[0] - p[0], point[1] - p[1]),
  };
}

// An interior label point, including concave rooms whose centroid lies outside.
export function interiorPoint(polygon: Point[]): Point {
  const b = boundsOf(polygon);
  const candidates: Point[] = [[(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]];
  const ys = [...new Set(polygon.map((p) => p[1]))].sort((a, z) => a - z);
  for (let k = 1; k < ys.length; k++) {
    const y = (ys[k - 1] + ys[k]) / 2,
      intersections: number[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        c = polygon[(i + 1) % polygon.length];
      if (a[1] > y !== c[1] > y)
        intersections.push(a[0] + ((y - a[1]) * (c[0] - a[0])) / (c[1] - a[1]));
    }
    intersections.sort((a, z) => a - z);
    for (let i = 0; i + 1 < intersections.length; i += 2)
      candidates.push([(intersections[i] + intersections[i + 1]) / 2, y]);
  }
  let result = polygon[0],
    clearance = -1;
  for (const p of candidates) {
    if (!pointInside(p, polygon)) continue;
    let d = Infinity;
    for (let i = 0; i < polygon.length; i++)
      d = Math.min(
        d,
        projectToSegment(p, polygon[i], polygon[(i + 1) % polygon.length])
          .distance,
      );
    if (d > clearance) {
      result = p;
      clearance = d;
    }
  }
  return result;
}

export function floorGeometry(floor: Floor) {
  return {
    elevation: floor.elevation_m ?? floor.level * 3,
    height: floor.height_m ?? 3,
    estimated: floor.elevation_m == null || floor.height_m == null,
  };
}

export function routeOnFloor(route: RouteAction | null, floor: Floor): Point[] {
  return route?.floors[String(floor.level)] ?? [];
}

export function pointAlong(
  points: Point[],
  progress: number,
): Point | undefined {
  if (!points.length) return undefined;
  const lengths = points
    .slice(1)
    .map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  let remaining =
    lengths.reduce((s, n) => s + n, 0) * Math.max(0, Math.min(1, progress));
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] && lengths[i] > 0) {
      const t = remaining / lengths[i];
      return [
        points[i][0] + (points[i + 1][0] - points[i][0]) * t,
        points[i][1] + (points[i + 1][1] - points[i][1]) * t,
      ];
    }
    remaining -= lengths[i];
  }
  return points.at(-1);
}

type WallSegment = { a: Point; b: Point };
// Preserve actual polygon boundaries; cut door gaps only on their closest edge.
export function wallSegments(space: Space, openings: Opening[]): WallSegment[] {
  const polygon = space.polygon,
    cuts = new Map<number, [number, number][]>();
  for (const door of openings.filter((d) => d.space_ids.includes(space.id))) {
    let nearest = { edge: -1, distance: Infinity, t: 0, length: 0 };
    for (let i = 0; i < polygon.length; i++) {
      const p = projectToSegment(
        door.position,
        polygon[i],
        polygon[(i + 1) % polygon.length],
      );
      if (p.distance < nearest.distance) nearest = { edge: i, ...p };
    }
    if (nearest.distance > 0.35 || !nearest.length || !door.width_m) continue;
    const half = door.width_m / nearest.length / 2;
    cuts.set(nearest.edge, [
      ...(cuts.get(nearest.edge) ?? []),
      [Math.max(0, nearest.t - half), Math.min(1, nearest.t + half)],
    ]);
  }
  const walls: WallSegment[] = [];
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    const lerp = (t: number): Point => [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
    ];
    let start = 0;
    for (const [from, to] of (cuts.get(i) ?? []).sort((a, b) => a[0] - b[0])) {
      if (from > start) walls.push({ a: lerp(start), b: lerp(from) });
      start = Math.max(start, to);
    }
    if (start < 1) walls.push({ a: lerp(start), b });
  });
  return walls;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function position(value: unknown): value is Point {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(
      (n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e8,
    )
  );
}

export function parseBuilding(value: unknown): BuildingData {
  if (
    !record(value) ||
    !record(value.building) ||
    typeof value.building.id !== "string" ||
    !value.building.id.trim() ||
    typeof value.building.name !== "string"
  )
    throw new Error(
      "The file needs building.id and building.name. Choose an organizers-format building.json.",
    );
  if (value.building.units != null && value.building.units !== "m")
    throw new Error(
      "This map format uses metre coordinates. Convert the plan to metres before importing.",
    );
  const textFields = (item: Record<string, unknown>, keys: string[]) => {
    for (const key of keys)
      if (item[key] != null && typeof item[key] !== "string")
        throw new Error(`${key} must be text when supplied.`);
  };
  textFields(value.building, ["source", "license", "attribution"]);
  if (
    !Array.isArray(value.floors) ||
    !value.floors.length ||
    !Array.isArray(value.spaces) ||
    !value.spaces.length
  )
    throw new Error("A building needs at least one floor and one space.");
  const ids = new Set<string>(),
    levels = new Set<number>();
  const checkId = (v: Record<string, unknown>) => {
    if (typeof v.id !== "string" || !v.id || ids.has(v.id))
      throw new Error("Every element needs a unique, non-empty id.");
    ids.add(v.id);
  };
  for (const floor of value.floors) {
    if (
      !record(floor) ||
      !Number.isFinite(floor.level) ||
      levels.has(floor.level as number) ||
      typeof floor.name !== "string"
    )
      throw new Error("Each floor needs a name and a unique numeric level.");
    checkId(floor);
    levels.add(floor.level as number);
    for (const key of ["elevation_m", "height_m"])
      if (floor[key] != null && !Number.isFinite(floor[key]))
        throw new Error(`Invalid ${key} on ${floor.name}.`);
    if (floor.height_m != null && (floor.height_m as number) <= 0)
      throw new Error("Floor heights must be positive.");
  }
  const floors = new Set(value.floors.map((f) => f.id));
  for (const space of value.spaces) {
    if (
      !record(space) ||
      !floors.has(space.floor_id) ||
      !Array.isArray(space.polygon) ||
      space.polygon.length < 3 ||
      !space.polygon.every(position) ||
      polygonArea(space.polygon) < 1e-8
    )
      throw new Error(
        "Every space needs a valid floor and a non-zero polygon with finite [x, y] coordinates.",
      );
    checkId(space);
    textFields(space, ["name", "ref", "type", "room_type"]);
  }
  const spaces = new Set(value.spaces.map((s) => s.id));
  for (const key of ["openings", "assets", "vertical_connectors"]) {
    if (value[key] != null && !Array.isArray(value[key]))
      throw new Error(`${key} must be an array.`);
    for (const item of (value[key] ?? []) as unknown[]) {
      if (!record(item)) throw new Error(`Invalid ${key} entry.`);
      checkId(item);
      textFields(item, ["name", "kind", "category", "type"]);
      if (
        item.width_m != null &&
        (!Number.isFinite(item.width_m) || (item.width_m as number) <= 0)
      )
        throw new Error("Opening widths must be positive numbers.");
      if (item.footprint != null) {
        const fp = item.footprint;
        const dimensions = Array.isArray(fp)
          ? fp.slice(0, 2)
          : record(fp)
            ? [fp.width_m, fp.depth_m]
            : [];
        const rotation = Array.isArray(fp)
          ? fp[2]
          : record(fp)
            ? fp.rotation_deg
            : undefined;
        if (
          dimensions.length !== 2 ||
          dimensions.some(
            (n) => typeof n !== "number" || !Number.isFinite(n) || n <= 0,
          ) ||
          (rotation != null && !Number.isFinite(rotation))
        )
          throw new Error(
            "Asset footprints need positive widths and depths, and a finite rotation.",
          );
      }
      if (
        key !== "vertical_connectors" &&
        (!floors.has(item.floor_id) || !position(item.position))
      )
        throw new Error(`${key} entry has an invalid floor or position.`);
      if (key === "assets" && !spaces.has(item.space_id))
        throw new Error("An asset refers to an unknown room.");
      if (
        key !== "assets" &&
        (!Array.isArray(item.space_ids) ||
          item.space_ids.some((s) => s !== "outside" && !spaces.has(s)))
      )
        throw new Error(`${key} refers to an unknown space.`);
      if (
        key === "vertical_connectors" &&
        (!Array.isArray(item.floor_ids) ||
          item.floor_ids.some((f) => !floors.has(f)))
      )
        throw new Error("A connector refers to an unknown floor.");
    }
  }
  // Retain the complete object: source metadata and optional fields are never stripped.
  return value as unknown as BuildingData;
}
