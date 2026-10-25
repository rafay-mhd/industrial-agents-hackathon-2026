import type { BuildingData, RouteAction, VerticalConnector } from "../types";
import type { Location, Point } from "./model";
import { floorGeometry, label, pointInside } from "./model.ts";
import { connectorLayouts } from "./connectorLayout.ts";
import type { LivePosition } from "./walking";
export type RoutePoint = [number, number, number]; // x, elevation, negative source y
export type TravelLeg = {
  kind: "walk" | "connector";
  floorId: string;
  toFloorId: string;
  name: string;
  points: RoutePoint[];
  distance: number;
  start: number;
  connectorId?: string;
  illustrative?: boolean;
};
export type RoutePlan = {
  legs: TravelLeg[];
  distance: number;
  complete: boolean;
  verified?: boolean;
  notice: string;
  startLabel: string;
  endLabel: string;
  floorNames: Record<string, string>;
};
export const pathDistance = (points: RoutePoint[]) =>
  points
    .slice(1)
    .reduce(
      (n, p, i) => n + Math.hypot(...p.map((v, k) => v - points[i][k])),
      0,
    );
const closeTo = (p: Point, polygon: Point[]) =>
  pointInside(p, polygon) ||
  polygon.some((a, i) => {
    const b = polygon[(i + 1) % polygon.length],
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      t = Math.max(
        0,
        Math.min(
          1,
          ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1),
        ),
      );
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) < 0.2;
  });
export function buildRoutePlan(
  data: BuildingData | null,
  route: RouteAction | null,
  location: Location | null,
): RoutePlan {
  const plan: RoutePlan = {
    legs: [],
    distance: 0,
    complete: false,
    notice: "",
    startLabel: "Start",
    endLabel: "Destination",
    floorNames: Object.fromEntries(
      (data?.floors ?? []).map((f) => [f.id, f.name]),
    ),
  };
  if (!data || !route) return plan;
  plan.verified = route.geometry_valid === true;
  if (route.geometry_valid === false) {
    plan.notice =
      route.geometry_notice ??
      "This route cannot be drawn without crossing an unverified wall.";
    return plan;
  }
  const explicit = !!route.segments?.length;
  const entries = explicit
    ? route.segments!.flatMap((s) => {
        const floor = data.floors.find((f) => f.id === s.floor_id);
        return floor &&
          s.points.length &&
          s.points.every((p) => p.length === 2 && p.every(Number.isFinite))
          ? [
              {
                floor,
                points: s.points,
                exit_connector_id: s.exit_connector_id,
              },
            ]
          : [];
      })
    : data.floors.flatMap((f) => {
        const supplied = route.floors[String(f.level)] ?? [];
        const points = supplied.every(
          (p) => p.length === 2 && p.every(Number.isFinite),
        )
          ? supplied
          : [];
        return points.length
          ? [
              {
                floor: f,
                points,
                exit_connector_id: undefined as string | undefined,
              },
            ]
          : [];
      });
  if (!entries.length) {
    plan.notice = "The agent supplied directions without route geometry.";
    return plan;
  }
  const spaces = new Map(data.spaces.map((s) => [s.id, s]));
  const sourceText = route.steps.join(" ").toLowerCase();
  const connectors = (
    a: (typeof entries)[number],
    b: (typeof entries)[number],
  ) => {
    const matches = (data.vertical_connectors ?? []).filter(
      (c) =>
        (!a.exit_connector_id || c.id === a.exit_connector_id) &&
        c.floor_ids.includes(a.floor.id) &&
        c.floor_ids.includes(b.floor.id) &&
        c.space_ids.some((id) => {
          const s = spaces.get(id);
          return (
            s?.floor_id === a.floor.id && closeTo(a.points.at(-1)!, s.polygon)
          );
        }) &&
        c.space_ids.some((id) => {
          const s = spaces.get(id);
          return s?.floor_id === b.floor.id && closeTo(b.points[0], s.polygon);
        }),
    );
    const named = matches.filter(
      (c) => c.name && sourceText.includes(c.name.toLowerCase()),
    );
    return named.length === 1 ? named : matches;
  };
  const links = entries.map((a, i) =>
    entries.flatMap((b, j) => {
      if (i === j) return [];
      const c = connectors(a, b);
      return c.length === 1 ? [{ next: j, connector: c[0] }] : [];
    }),
  );
  const currentSpace = location && spaces.get(location.spaceId);
  const locationStart = entries.findIndex(
    (e) =>
      e.floor.id === location?.floorId &&
      currentSpace &&
      closeTo(e.points[0], currentSpace.polygon),
  );
  const beginnings = entries
    .map((_, i) => i)
    .filter((i) => !links.some((list) => list.some((l) => l.next === i)));
  const firstInstruction = (route.steps[0] ?? "").toLowerCase();
  const textStarts = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) =>
      data.spaces.some(
        (s) =>
          s.floor_id === e.floor.id &&
          label(s).length > 2 &&
          firstInstruction.includes(label(s).toLowerCase()) &&
          closeTo(e.points[0], s.polygon),
      ),
    );
  const start = explicit
    ? 0
    : locationStart >= 0
      ? locationStart
      : beginnings.length === 1
        ? beginnings[0]
        : textStarts.length === 1
          ? textStarts[0].i
          : 0;
  const ordered: { index: number; connector?: VerticalConnector }[] = [
      { index: start },
    ],
    visited = new Set([start]);
  let current = start;
  while (visited.size < entries.length) {
    const next = links[current].filter((l) =>
      explicit ? l.next === current + 1 : !visited.has(l.next),
    );
    if (next.length !== 1) break;
    ordered.at(-1)!.connector = next[0].connector;
    current = next[0].next;
    visited.add(current);
    ordered.push({ index: current });
  }
  const missingGeometry =
    (explicit && entries.length !== route.segments!.length) ||
    Object.entries(route.floors).some(
      ([level, points]) =>
        points.length &&
        (!data.floors.some((f) => String(f.level) === level) ||
          !points.every((p) => p.length === 2 && p.every(Number.isFinite))),
    );
  const outside = route.steps.some((s) =>
    /\b(outside|outdoor|re.enter)\b/i.test(s),
  );
  const ambiguous =
    entries.length > 1 &&
    (visited.size !== entries.length ||
      (!explicit &&
        locationStart < 0 &&
        beginnings.length !== 1 &&
        textStarts.length !== 1));
  if (ambiguous || outside || missingGeometry) {
    ordered.splice(1);
    ordered[0].connector = undefined;
    plan.notice = missingGeometry
      ? "Partial preview: some supplied route coordinates or floors cannot be displayed safely."
      : outside
        ? "Partial preview: outdoor or repeated-floor geometry is missing. Use the written directions for the remaining journey."
        : "Previewing one floor: the supplied route does not identify a unique sequence of floor connections.";
  }
  const layouts = connectorLayouts(data);
  const world = (p: Point, elevation: number): RoutePoint => [
    p[0],
    elevation,
    -p[1],
  ];
  const add = (leg: Omit<TravelLeg, "start" | "distance">) => {
    const distance = pathDistance(leg.points);
    plan.legs.push({ ...leg, distance, start: plan.distance });
    plan.distance += distance;
  };
  for (let i = 0; i < ordered.length; i++) {
    const entry = entries[ordered[i].index],
      y = floorGeometry(entry.floor).elevation;
    add({
      kind: "walk",
      floorId: entry.floor.id,
      toFloorId: entry.floor.id,
      name: `Follow the path on ${entry.floor.name}`,
      points: entry.points.map((p) => world(p, y)),
    });
    const c = ordered[i].connector,
      next = ordered[i + 1] && entries[ordered[i + 1].index];
    if (!c || !next) continue;
    const y2 = floorGeometry(next.floor).elevation,
      from = world(entry.points.at(-1)!, y),
      to = world(next.points[0], y2);
    const span = layouts
      .find((l) => l.connector.id === c.id)
      ?.spans.find(
        (s) =>
          [s.from.floorId, s.to.floorId].includes(entry.floor.id) &&
          [s.from.floorId, s.to.floorId].includes(next.floor.id),
      );
    let points: RoutePoint[] = [from, to];
    if (c.kind === "stairs" && span?.footprint) {
      const { center, width: w, depth: d, angle } = span.footprint,
        h = span.rise,
        z0 = -d * 0.42,
        run = d * 0.68;
      const local = (x: number, y: number, z: number): RoutePoint => [
        center[0] + Math.cos(angle) * x + Math.sin(angle) * z,
        span.from.elevation + y,
        -center[1] - Math.sin(angle) * x + Math.cos(angle) * z,
      ];
      const flights = [
        local(-w * 0.26, 0, z0),
        local(-w * 0.26, h / 2, z0 + run),
        local(-w * 0.26, h / 2, d * 0.375),
        local(w * 0.26, h / 2, d * 0.375),
        local(w * 0.26, h / 2, z0 + run),
        local(w * 0.26, h, z0),
        local(w * 0.26, h, -d * 0.5),
      ];
      if (y > y2) flights.reverse();
      points = [from, ...flights, to];
    }
    add({
      kind: "connector",
      floorId: entry.floor.id,
      toFloorId: next.floor.id,
      name: `${c.name || c.kind} → ${next.floor.name}`,
      connectorId: c.id,
      illustrative: true,
      points,
    });
  }
  plan.complete =
    !ambiguous &&
    !outside &&
    !missingGeometry &&
    visited.size === entries.length;
  const first = entries[ordered[0].index],
    last = entries[ordered.at(-1)!.index];
  const nameAt = (e: typeof first, p: Point) =>
    data.spaces.find(
      (s) => s.floor_id === e.floor.id && pointInside(p, s.polygon),
    );
  const startSpace = nameAt(first, first.points[0]),
    endSpace = nameAt(last, last.points.at(-1)!);
  plan.startLabel = startSpace ? label(startSpace) : first.floor.name;
  plan.endLabel = endSpace ? label(endSpace) : last.floor.name;
  return plan;
}
export type PlaybackFrame = {
  firstPerson: boolean;
  live: LivePosition | null;
  active: boolean;
  playing: boolean;
  finished: boolean;
  follow: boolean;
  speed: number;
  progress: number;
  distance: number;
  legIndex: number;
  legProgress: number;
  point: RoutePoint;
  heading: number;
  floorId: string;
  leg: TravelLeg | null;
  plan: RoutePlan;
  revision: number;
};
export function sampleRoute(plan: RoutePlan, distance: number) {
  const d = Math.max(0, Math.min(plan.distance, distance));
  let index = plan.legs.findIndex(
    (l) => l.distance > 0 && d < l.start + l.distance,
  );
  if (index < 0) index = plan.legs.length - 1;
  const leg = plan.legs[index];
  if (!leg)
    return {
      leg: null,
      legIndex: 0,
      legProgress: 0,
      point: [0, 0, 0] as RoutePoint,
      heading: 0,
      floorId: "",
    };
  let remaining = Math.max(0, d - leg.start),
    point = leg.points.at(-1)!,
    heading = 0;
  for (let i = 1; i < leg.points.length; i++) {
    const a = leg.points[i - 1],
      b = leg.points[i],
      length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (length > 0 && remaining <= length) {
      const t = remaining / length;
      point = a.map((v, k) => v + (b[k] - v) * t) as RoutePoint;
      heading = Math.atan2(b[0] - a[0], -(b[2] - a[2]));
      break;
    }
    remaining -= length;
  }
  const legProgress = leg.distance
    ? Math.max(0, Math.min(1, (d - leg.start) / leg.distance))
    : 1;
  return {
    leg,
    legIndex: index,
    legProgress,
    point,
    heading,
    floorId:
      leg.kind === "connector" && legProgress >= 0.5
        ? leg.toFloorId
        : leg.floorId,
  };
}
export type PlaybackStore = ReturnType<typeof createPlaybackStore>;
export function createPlaybackStore() {
  let plan = buildRoutePlan(null, null, null),
    distance = 0,
    playing = false,
    follow = true,
    speed = 2,
    revision = 0,
    lastEmit = 0;
  let firstPerson = false,
    live: LivePosition | null = null;
  const listeners = new Set<() => void>(),
    frames = new Set<(frame: PlaybackFrame) => void>();
  const frame = (): PlaybackFrame => ({
    firstPerson,
    live,
    active: plan.legs.length > 0,
    playing,
    finished: plan.legs.length > 0 && distance >= plan.distance,
    follow,
    speed,
    progress: plan.distance ? distance / plan.distance : 0,
    distance,
    plan,
    revision,
    ...sampleRoute(plan, distance),
    ...(live
      ? { point: live.point, heading: live.heading, floorId: live.floorId }
      : {}),
  });
  let current = frame(),
    snapshot = current;
  const emit = (force = true) => {
    current = frame();
    frames.forEach((f) => f(current));
    if (
      force ||
      performance.now() - lastEmit > 100 ||
      current.legIndex !== snapshot.legIndex ||
      current.finished !== snapshot.finished
    ) {
      snapshot = current;
      lastEmit = performance.now();
      listeners.forEach((f) => f());
    }
  };
  return {
    getFrame: () => current,
    getSnapshot: () => snapshot,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    subscribeFrame: (fn: (f: PlaybackFrame) => void) => {
      frames.add(fn);
      return () => {
        frames.delete(fn);
      };
    },
    setPlan(next: RoutePlan) {
      live = null;
      plan = next;
      distance = 0;
      playing = false;
      follow = true;
      revision++;
      emit();
    },
    play(value: boolean) {
      playing = !live && value && plan.distance > 0 && distance < plan.distance;
      emit();
    },
    seek(progress: number) {
      distance = Math.max(0, Math.min(1, progress)) * plan.distance;
      if (distance >= plan.distance) playing = false;
      revision++;
      emit();
    },
    restart() {
      live = null;
      distance = 0;
      playing = plan.distance > 0;
      follow = true;
      revision++;
      emit();
    },
    setFollow(value: boolean) {
      follow = value;
      revision++;
      emit();
    },
    setSpeed(value: number) {
      if ([1, 2, 4].includes(value)) speed = value;
      emit();
    },
    setFirstPerson(value: boolean) {
      firstPerson = value;
      follow = true;
      revision++;
      emit();
    },
    setLive(value: LivePosition | null, progress?: number) {
      live = value;
      playing = false;
      if (progress !== undefined)
        distance = Math.max(0, Math.min(plan.distance, progress));
      emit();
    },
    tick(seconds: number) {
      if (!playing || live) return;
      distance = Math.min(
        plan.distance,
        distance + Math.max(0, Math.min(seconds, 0.1)) * 1.4 * speed,
      );
      if (distance >= plan.distance) playing = false;
      emit(false);
    },
  };
}

/** Completed 2D trail, sampled on the same polyline as the moving character. */
export function travelledFloorPath(frame: PlaybackFrame, floorId: string) {
  return frame.plan.legs
    .filter((l) => l.kind === "walk" && l.floorId === floorId)
    .map((leg) => {
      if (!leg || frame.distance <= leg.start) return "";
      const remaining = Math.min(leg.distance, frame.distance - leg.start);
      const points = [leg.points[0]];
      let covered = 0;
      for (let i = 1; i < leg.points.length; i++) {
        const a = leg.points[i - 1],
          b = leg.points[i],
          length = Math.hypot(...b.map((v, k) => v - a[k]));
        if (covered + length <= remaining) {
          points.push(b);
          covered += length;
          continue;
        }
        if (length)
          points.push(
            a.map(
              (v, k) => v + ((b[k] - v) * (remaining - covered)) / length,
            ) as RoutePoint,
          );
        break;
      }
      return points.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[2]}`).join(" ");
    })
    .join(" ");
}
