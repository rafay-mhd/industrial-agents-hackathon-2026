import type { BuildingData, Space, VerticalConnector } from "../types";
import {
  boundsOf,
  floorGeometry,
  interiorPoint,
  pointInside,
} from "./model.ts";
export type ConnectorStop = {
  space: Space;
  floorId: string;
  elevation: number;
  point: [number, number];
};
export type CoreFootprint = {
  center: [number, number];
  width: number;
  depth: number;
  angle: number;
  polygon: [number, number][];
};
export type ConnectorSpan = {
  from: ConnectorStop;
  to: ConnectorStop;
  rise: number;
  footprint: CoreFootprint | null;
  terminal?: boolean;
};
export type ConnectorLayout = {
  connector: VerticalConnector;
  stops: ConnectorStop[];
  spans: ConnectorSpan[];
};

/** A conservative shared display envelope, wholly inside both supplied landing polygons. */
export function sharedCoreFootprint(a: Space, b: Space): CoreFootprint | null {
  const ba = boundsOf(a.polygon),
    bb = boundsOf(b.polygon);
  if (
    Math.min(ba.maxX, bb.maxX) <= Math.max(ba.minX, bb.minX) ||
    Math.min(ba.maxY, bb.maxY) <= Math.max(ba.minY, bb.minY)
  )
    return null;
  const candidates: [number, number][] = [
    [
      (Math.max(ba.minX, bb.minX) + Math.min(ba.maxX, bb.maxX)) / 2,
      (Math.max(ba.minY, bb.minY) + Math.min(ba.maxY, bb.maxY)) / 2,
    ],
    interiorPoint(a.polygon),
    interiorPoint(b.polygon),
  ];
  const edge = a.polygon
    .map((p, i) => {
      const q = a.polygon[(i + 1) % a.polygon.length];
      return {
        x: q[0] - p[0],
        y: q[1] - p[1],
        length: Math.hypot(q[0] - p[0], q[1] - p[1]),
      };
    })
    .sort((a, b) => b.length - a.length)[0];
  const angle = Math.atan2(edge.y, edge.x),
    u: [number, number] = [Math.cos(angle), Math.sin(angle)],
    v: [number, number] = [-u[1], u[0]];
  let best: CoreFootprint | null = null;
  for (const center of candidates) {
    if (![a, b].every((s) => pointInside(center, s.polygon))) continue;
    const boxes = [a, b].map((s) =>
      boundsOf(
        s.polygon.map((p) => [
          (p[0] - center[0]) * u[0] + (p[1] - center[1]) * u[1],
          (p[0] - center[0]) * v[0] + (p[1] - center[1]) * v[1],
        ]),
      ),
    );
    let width = Math.min(...boxes.flatMap((b) => [-b.minX, b.maxX])) * 1.82,
      depth = Math.min(...boxes.flatMap((b) => [-b.minY, b.maxY])) * 1.82;
    for (
      let i = 0;
      i < 14 && width > 0.4 && depth > 0.4;
      i++, width *= 0.85, depth *= 0.85
    ) {
      const point = (x: number, y: number): [number, number] => [
        center[0] + u[0] * x + v[0] * y,
        center[1] + u[1] * x + v[1] * y,
      ];
      const samples = [-1, -0.5, 0, 0.5, 1].flatMap((x) =>
        [-1, -0.5, 0, 0.5, 1].map((y) =>
          point((x * width) / 2, (y * depth) / 2),
        ),
      );
      if (!samples.every((p) => [a, b].every((s) => pointInside(p, s.polygon))))
        continue;
      const polygon = [
        point(-width / 2, -depth / 2),
        point(width / 2, -depth / 2),
        point(width / 2, depth / 2),
        point(-width / 2, depth / 2),
      ];
      const cross = (
        a: [number, number],
        b: [number, number],
        c: [number, number],
      ) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const crosses = (
        a: [number, number],
        b: [number, number],
        c: [number, number],
        d: [number, number],
      ) =>
        cross(a, b, c) * cross(a, b, d) < -1e-12 &&
        cross(c, d, a) * cross(c, d, b) < -1e-12;
      if (
        [a, b].some((s) =>
          s.polygon.some((p, i) =>
            polygon.some((q, j) =>
              crosses(
                p,
                s.polygon[(i + 1) % s.polygon.length],
                q,
                polygon[(j + 1) % polygon.length],
              ),
            ),
          ),
        )
      )
        continue;
      const footprint = {
        center,
        width: Math.min(width, depth),
        depth: Math.max(width, depth),
        angle: width <= depth ? angle : angle + Math.PI / 2,
        polygon,
      };
      if (!best || width * depth > best.width * best.depth) best = footprint;
      break;
    }
  }
  return best;
}

export function connectorLayouts(data: BuildingData): ConnectorLayout[] {
  const spaces = new Map(data.spaces.map((s) => [s.id, s])),
    floors = new Map(data.floors.map((f) => [f.id, f]));
  const layouts = (data.vertical_connectors ?? [])
    .map((connector) => {
      const seen = new Set<string>();
      const stops = connector.space_ids
        .flatMap((id) => {
          const space = spaces.get(id),
            floor = space && floors.get(space.floor_id);
          if (
            !space ||
            !floor ||
            !connector.floor_ids.includes(floor.id) ||
            seen.has(floor.id)
          )
            return [];
          seen.add(floor.id);
          return [
            {
              space,
              floorId: floor.id,
              elevation: floorGeometry(floor).elevation,
              point: interiorPoint(space.polygon),
            },
          ];
        })
        .sort((a, b) => a.elevation - b.elevation);
      const spans = stops.slice(1).flatMap((to, i) => {
        const from = stops[i],
          rise = to.elevation - from.elevation;
        return rise > 0
          ? [
              {
                from,
                to,
                rise,
                footprint: ["stairs", "lift"].includes(connector.kind)
                  ? sharedCoreFootprint(from.space, to.space)
                  : null,
              },
            ]
          : [];
      });
      return { connector, stops, spans };
    })
    .filter((c) => c.spans.length);
  // Contradictory source links can put a stair and lift in the same landing room.
  // Keep those as schematic links instead of drawing intersecting physical cores.
  for (let i = 0; i < layouts.length; i++)
    for (let j = i + 1; j < layouts.length; j++) {
      for (const a of layouts[i].spans)
        for (const b of layouts[j].spans) {
          if (
            Math.min(a.to.elevation, b.to.elevation) <=
            Math.max(a.from.elevation, b.from.elevation)
          )
            continue;
          if (
            [a.from.space.id, a.to.space.id].some(
              (id) => id === b.from.space.id || id === b.to.space.id,
            )
          ) {
            a.footprint = null;
            b.footprint = null;
          }
        }
    }
  for (const layout of layouts)
    for (const span of layout.spans)
      (span as ConnectorSpan).terminal = !layouts.some(
        (other) =>
          other.connector.kind === layout.connector.kind &&
          other.spans.some(
            (next) => next.footprint && next.from.space.id === span.to.space.id,
          ),
      );
  return layouts;
}
