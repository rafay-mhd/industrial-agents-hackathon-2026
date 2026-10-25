import Clipper from "clipper-lib";
import type { BuildingData, Opening, Space } from "../types";
import { floorGeometry, pointInside } from "./model.ts";
import type { Point } from "./model";
const SCALE = 10000;
export type Footprint = { outer: Point[]; holes: Point[][] };
export type FacadeEdge = {
  a: Point;
  b: Point;
  normal: Point;
  length: number;
  id: string;
};
export type EnvelopeBand = {
  bottom: number;
  top: number;
  footprints: Footprint[];
  roof: Footprint[];
  edges: FacadeEdge[];
};
export type ExteriorEntrance = {
  isEntrance: boolean;
  opening: Opening;
  label: string;
  elevation: number;
  width: number;
  point: Point;
  normal: Point;
  edge: FacadeEdge | null;
  distance: number;
};
export const isOutdoor = (s: Space) =>
  s.type === "outdoor" ||
  /^(balcony|terrace|roof_terrace|patio|courtyard|garden)$/.test(
    s.room_type ?? s.type,
  );
export const isExteriorEntrance = (d: Opening) =>
  d.kind === "entrance" || d.space_ids.includes("outside");
const path = (p: Point[]): Clipper.Path =>
  p.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
const positive = (p: Point[]) => {
  const v = path(p);
  if (!Clipper.Clipper.Orientation(v)) v.reverse();
  return v;
};
const unpack = (p: Clipper.Path): Point[] =>
  p.map((v) => [v.X / SCALE, v.Y / SCALE]);
const paths = (polys: Footprint[]) =>
  polys.flatMap((p) => [
    positive(p.outer),
    ...p.holes.map((h) => positive(h).reverse()),
  ]);
function operation(
  subject: Clipper.Paths,
  clip: Clipper.Paths = [],
  kind = Clipper.ClipType.ctUnion,
): Footprint[] {
  if (!subject.length) return [];
  const c = new Clipper.Clipper(),
    tree = new Clipper.PolyTree();
  c.StrictlySimple = true;
  c.AddPaths(subject, Clipper.PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip, Clipper.PolyType.ptClip, true);
  c.Execute(
    kind,
    tree,
    Clipper.PolyFillType.pftNonZero,
    Clipper.PolyFillType.pftNonZero,
  );
  return Clipper.JS.PolyTreeToExPolygons(tree).map((p) => ({
    outer: unpack(p.outer),
    holes: p.holes.map(unpack),
  }));
}
export const unionFootprints = (polygons: Point[][]) =>
  operation(polygons.filter((p) => p.length >= 3).map(positive));
export const differenceFootprints = (a: Footprint[], b: Footprint[]) =>
  operation(paths(a), paths(b), Clipper.ClipType.ctDifference);
const intersection = (a: Footprint[], b: Footprint[]) =>
  operation(paths(a), paths(b), Clipper.ClipType.ctIntersection);
export { intersection as intersectFootprints };
const combine = (p: Footprint[]) => operation(paths(p));
function offset(p: Footprint[], distance: number) {
  const o = new Clipper.ClipperOffset(2, 0.01 * SCALE),
    result: Clipper.Paths = [];
  o.AddPaths(
    paths(p),
    Clipper.JoinType.jtMiter,
    Clipper.EndType.etClosedPolygon,
  );
  o.Execute(result, distance * SCALE);
  return operation(result);
}
/** Join sub-wall-width gaps, retaining concavity, disconnected wings and courtyards. */
export function floorEnvelope(indoor: Point[][], outdoor: Point[][] = []) {
  const exact = unionFootprints(indoor);
  if (!exact.length) return [];
  return differenceFootprints(
    offset(offset(exact, 0.16), -0.16),
    unionFootprints(outdoor),
  );
}
export function footprintEdges(polys: Footprint[], prefix = ""): FacadeEdge[] {
  return polys.flatMap((p, i) =>
    [p.outer, ...p.holes].flatMap((ring, j) =>
      ring.flatMap((a, k) => {
        const b = ring[(k + 1) % ring.length],
          dx = b[0] - a[0],
          dy = b[1] - a[1],
          length = Math.hypot(dx, dy);
        return length > 0.005
          ? [
              {
                a,
                b,
                length,
                normal: [dy / length, -dx / length] as Point,
                id: `${prefix}:${i}:${j}:${k}`,
              },
            ]
          : [];
      }),
    ),
  );
}
export const insideFootprints = (p: Point, polys: Footprint[]) =>
  polys.some(
    (f) => pointInside(p, f.outer) && !f.holes.some((h) => pointInside(p, h)),
  );
export function projectToEdge(p: Point, edge: FacadeEdge) {
  const [x, y] = edge.a,
    dx = edge.b[0] - x,
    dy = edge.b[1] - y,
    t = Math.max(
      0,
      Math.min(1, ((p[0] - x) * dx + (p[1] - y) * dy) / edge.length ** 2),
    );
  const point: Point = [x + dx * t, y + dy * t];
  return { point, t, distance: Math.hypot(p[0] - point[0], p[1] - point[1]) };
}
export function buildEnvelope(
  data: BuildingData,
  doors: Opening[] = data.openings ?? [],
) {
  const floors = [...data.floors].sort(
    (a, b) => floorGeometry(a).elevation - floorGeometry(b).elevation,
  );
  const ground = floorGeometry(
    floors.find((f) => f.level === 0) ??
      floors.find((f) => f.level >= 0) ??
      floors[0],
  ).elevation;
  const plans = floors.map((f) => {
    const spaces = data.spaces.filter((s) => s.floor_id === f.id),
      outdoor = spaces.filter(isOutdoor),
      indoor = spaces.filter((s) => !isOutdoor(s));
    const footprint = floorEnvelope(
      indoor.map((s) => s.polygon),
      outdoor.map((s) => s.polygon),
    );
    return {
      floor: f,
      ...floorGeometry(f),
      footprint,
      all: combine([
        ...footprint,
        ...unionFootprints(outdoor.map((s) => s.polygon)),
      ]),
    };
  });
  // A higher storey caps the rooms underneath it. A double-height hall beside it
  // retains its declared height: an upper office floor must not become a floating block.
  const volumes: { bottom: number; top: number; footprints: Footprint[] }[] =
    [];
  for (const p of plans) {
    let remaining = p.footprint;
    const end = p.elevation + p.height;
    for (const next of plans.filter(
      (n) => n.elevation > p.elevation + 0.01 && n.elevation < end - 0.01,
    )) {
      const covered = intersection(remaining, next.all);
      if (covered.length)
        volumes.push({
          bottom: p.elevation,
          top: next.elevation,
          footprints: covered,
        });
      remaining = differenceFootprints(remaining, next.all);
    }
    if (remaining.length)
      volumes.push({ bottom: p.elevation, top: end, footprints: remaining });
  }
  const levels = [...new Set(volumes.flatMap((v) => [v.bottom, v.top]))].sort(
    (a, b) => a - b,
  );
  const bands: EnvelopeBand[] = levels.slice(0, -1).flatMap((bottom, i) => {
    const top = levels[i + 1],
      mid = (bottom + top) / 2;
    const footprints = combine(
      volumes
        .filter((v) => v.bottom < mid && v.top > mid)
        .flatMap((v) => v.footprints),
    );
    return footprints.length
      ? [
          {
            bottom,
            top,
            footprints,
            roof: [],
            edges: footprintEdges(footprints, `band-${i}`),
          },
        ]
      : [];
  });
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i],
      next = bands[i + 1];
    b.roof = differenceFootprints(
      b.footprints,
      next && Math.abs(next.bottom - b.top) < 0.01 ? next.footprints : [],
    );
    const decks = data.spaces.filter(
      (s) =>
        isOutdoor(s) &&
        Math.abs(
          (plans.find((p) => p.floor.id === s.floor_id)?.elevation ??
            Infinity) - b.top,
        ) < 0.1,
    );
    b.roof = differenceFootprints(
      b.roof,
      unionFootprints(decks.map((s) => s.polygon)),
    );
  }
  const entryDoors = doors.filter(isExteriorEntrance);
  const outdoorIds = new Set(data.spaces.filter(isOutdoor).map((s) => s.id));
  const accesses: ExteriorEntrance[] = doors
    .filter(
      (d) =>
        isExteriorEntrance(d) || d.space_ids.some((id) => outdoorIds.has(id)),
    )
    .map((opening) => {
      const isEntrance = isExteriorEntrance(opening),
        i = entryDoors.findIndex((d) => d.id === opening.id);
      const outdoor = data.spaces.find(
        (s) => outdoorIds.has(s.id) && opening.space_ids.includes(s.id),
      );
      const elevation =
        plans.find((f) => f.floor.id === opening.floor_id)?.elevation ?? ground;
      const edges =
        bands.find(
          (b) => b.bottom <= elevation + 0.1 && b.top > elevation + 0.1,
        )?.edges ?? [];
      const nearest = edges
        .map((edge) => ({ edge, ...projectToEdge(opening.position, edge) }))
        .sort((a, b) => a.distance - b.distance)[0];
      const aligned = nearest && nearest.distance <= 0.65;
      return {
        opening,
        isEntrance,
        label:
          opening.name ||
          (isEntrance
            ? `Entrance ${String(i + 1).padStart(2, "0")}`
            : `Access to ${outdoor?.name || "outdoors"}`),
        elevation,
        width: opening.width_m && opening.width_m > 0 ? opening.width_m : 1,
        point: aligned ? nearest.point : opening.position,
        normal: aligned ? nearest.edge.normal : [0, -1],
        edge: aligned ? nearest.edge : null,
        distance: nearest?.distance ?? Infinity,
      };
    });
  const entrances = accesses.filter((e) => e.isEntrance);
  const outdoors = data.spaces.filter(isOutdoor).map((space) => {
    const f = plans.find((p) => p.floor.id === space.floor_id)!;
    const edges = footprintEdges(
      unionFootprints([space.polygon]),
      space.id,
    ).filter((e) => {
      const mid: Point = [
        (e.a[0] + e.b[0]) / 2 + e.normal[0] * 0.23,
        (e.a[1] + e.b[1]) / 2 + e.normal[1] * 0.23,
      ];
      return !insideFootprints(mid, f.footprint);
    });
    return {
      space,
      elevation: f.elevation,
      edges,
      railing:
        /balcony|terrace/.test(space.room_type ?? space.type) ||
        f.elevation > ground + 0.5,
    };
  });
  return { bands, entrances, accesses, outdoors, ground, plans };
}
export type BuildingEnvelope = ReturnType<typeof buildEnvelope>;
