import type { RoutePlan, RoutePoint, PlaybackFrame } from "./routePlayback";
import { sampleRoute } from "./routePlayback.ts";

export type LivePosition = {
  point: RoutePoint;
  estimatedPoint?: RoutePoint;
  floorId: string;
  heading: number;
  accuracy: number;
  steps: number;
  offRoute: boolean;
  needsFloorConfirmation: boolean;
};

/** High-pass gravity removal plus peak/release hysteresis; one peak cannot count twice. */
export class StepDetector {
  gravity: number | null = null;
  armed = true;
  lastStep = -Infinity;
  lastTime = -Infinity;
  update(magnitude: number, now: number) {
    if (!Number.isFinite(magnitude) || !Number.isFinite(now)) return false;
    if (now - this.lastTime > 2000) this.gravity = magnitude;
    this.lastTime = now;
    this.gravity ??= magnitude;
    const high = magnitude - this.gravity;
    this.gravity += (magnitude - this.gravity) * 0.08;
    if (high < 0.25) this.armed = true;
    if (this.armed && high > 1.15 && high < 7 && now - this.lastStep > 300) {
      this.armed = false;
      this.lastStep = now;
      return true;
    }
    return false;
  }
}
export const angleDifference = (a: number, b: number) =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** Match only nearby route progress on the confirmed floor, never teleport across a building. */
export function projectWalk(
  plan: RoutePlan,
  point: RoutePoint,
  floorId: string,
  previous: number,
) {
  let best = { distance: previous, error: Infinity };
  for (const leg of plan.legs) {
    if (leg.kind !== "walk" || leg.floorId !== floorId) continue;
    let along = leg.start;
    for (let i = 1; i < leg.points.length; i++) {
      const a = leg.points[i - 1],
        b = leg.points[i],
        dx = b[0] - a[0],
        dz = b[2] - a[2];
      const length = Math.hypot(dx, dz);
      const t = Math.max(
        0,
        Math.min(
          1,
          ((point[0] - a[0]) * dx + (point[2] - a[2]) * dz) /
            (length * length || 1),
        ),
      );
      const distance = along + t * length,
        error = Math.hypot(point[0] - a[0] - t * dx, point[2] - a[2] - t * dz);
      if (
        distance >= previous - 1.5 &&
        distance <= previous + 1.5 &&
        error < best.error
      )
        best = { distance, error };
      along += length;
    }
  }
  return best;
}
export function advanceWalk(
  plan: RoutePlan,
  live: LivePosition,
  distance: number,
  stride: number,
) {
  const estimate = live.estimatedPoint ?? live.point;
  const point: RoutePoint = [
    estimate[0] + Math.sin(live.heading) * stride,
    estimate[1],
    estimate[2] - Math.cos(live.heading) * stride,
  ];
  const nearest = projectWalk(plan, point, live.floorId, distance);
  const offRoute = nearest.error > 1.25;
  let nextDistance = offRoute ? distance : nearest.distance;
  const transfer = plan.legs.find(
    (l) =>
      l.kind === "connector" &&
      l.floorId === live.floorId &&
      l.start >= distance - 0.001 &&
      nextDistance >= l.start - 1,
  );
  const needsFloorConfirmation = !!transfer && !offRoute;
  if (transfer && needsFloorConfirmation)
    nextDistance = Math.min(nextDistance, Math.max(0, transfer.start - 0.001));
  return {
    distance: nextDistance,
    live: {
      ...live,
      point: offRoute ? live.point : sampleRoute(plan, nextDistance).point,
      estimatedPoint: point,
      steps: live.steps + 1,
      accuracy: live.accuracy + stride * 0.12,
      offRoute,
      needsFloorConfirmation,
    },
  };
}

export function footprintTrail(plan: RoutePlan, spacing = 0.72) {
  const result: {
    point: RoutePoint;
    heading: number;
    side: number;
    distance: number;
    floorId: string;
  }[] = [];
  for (const leg of plan.legs) {
    if (leg.kind !== "walk") continue;
    for (
      let d = 0.32;
      d < leg.distance;
      d += Math.max(spacing, plan.distance / 1800)
    ) {
      const f = sampleRoute(plan, leg.start + d),
        side = result.length % 2 ? 1 : -1;
      result.push({
        point: [
          f.point[0] + Math.cos(f.heading) * 0.12 * side,
          f.point[1],
          f.point[2] + Math.sin(f.heading) * 0.12 * side,
        ],
        heading: f.heading,
        side,
        distance: leg.start + d,
        floorId: leg.floorId,
      });
    }
  }
  return result;
}

/** Relative directions come from the route's geometry, never invented compass orientation. */
export function walkingCue(frame: PlaybackFrame) {
  if (frame.live?.offRoute)
    return {
      text: "You seem to be off the route",
      detail: "Stop and confirm your location before continuing.",
      turn: "stop",
    };
  if (frame.live?.needsFloorConfirmation) {
    const transfer =
      frame.leg?.kind === "connector"
        ? frame.leg
        : frame.plan.legs[frame.legIndex + 1];
    return {
      text: transfer?.name ?? "Change floors",
      detail: `Confirm ${frame.plan.floorNames[transfer?.toFloorId ?? ""] ?? "the next floor"} when you arrive.`,
      turn: "floor",
    };
  }
  if (frame.finished)
    return {
      text: frame.live ? "Near your destination" : "You’ve arrived",
      detail: frame.plan.endLabel,
      turn: "arrive",
    };
  const leg = frame.leg;
  if (!leg)
    return {
      text: "Choose a destination",
      detail: "Your route will appear here.",
      turn: "straight",
    };
  if (leg.kind === "connector")
    return {
      text: leg.name,
      detail: "Continue to the indicated floor.",
      turn: "floor",
    };
  let offset = leg.start;
  for (let i = 1; i < leg.points.length - 1; i++) {
    const a = leg.points[i - 1],
      b = leg.points[i],
      c = leg.points[i + 1];
    offset += Math.hypot(b[0] - a[0], b[2] - a[2]);
    const incoming = Math.atan2(b[0] - a[0], -(b[2] - a[2])),
      outgoing = Math.atan2(c[0] - b[0], -(c[2] - b[2]));
    const turn = angleDifference(outgoing, incoming),
      remaining = offset - frame.distance;
    if (remaining > 0.3 && Math.abs(turn) > 0.5) {
      const name =
        Math.abs(turn) > 2.5
          ? "turn around"
          : turn > 0
            ? "turn right"
            : "turn left";
      return {
        text: `In ${Math.max(1, Math.round(remaining))} m, ${name}`,
        detail: frame.plan.floorNames[frame.floorId],
        turn: turn > 0 ? "right" : "left",
      };
    }
  }
  const next = frame.plan.legs[frame.legIndex + 1];
  return {
    text: `Continue for ${Math.max(1, Math.round(leg.start + leg.distance - frame.distance))} m`,
    detail:
      next?.kind === "connector"
        ? `Then ${next.name}`
        : `Towards ${frame.plan.endLabel}`,
    turn: "straight",
  };
}
