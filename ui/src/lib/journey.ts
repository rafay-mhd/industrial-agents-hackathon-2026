import type { RoutePlan } from "./routePlayback";
/** Travel estimates use walked geometry, not Core's equivalent-distance scoring allowance. */
export function journeyEstimate(plan: RoutePlan, distance: number, pace = 1.2) {
  let metres = 0,
    seconds = 0,
    transfers = 0;
  const speed = Math.max(0.4, Math.min(2, pace));
  for (const leg of plan.legs) {
    const left = Math.max(
      0,
      Math.min(
        1,
        leg.distance
          ? (leg.start + leg.distance - distance) / leg.distance
          : distance <= leg.start
            ? 1
            : 0,
      ),
    );
    if (!left) continue;
    if (leg.kind === "walk") {
      metres += leg.distance * left;
      seconds += (leg.distance * left) / speed;
    } else {
      transfers++;
      const rise = Math.abs(leg.points.at(-1)![1] - leg.points[0][1]);
      seconds +=
        (leg.connectorKind === "lift" ? 30 + rise / 1 : 10 + rise / 0.25) *
        left;
    }
  }
  return {
    metres: Math.max(0, Math.ceil(metres)),
    seconds: Math.max(0, Math.ceil(seconds)),
    transfers,
  };
}
export function durationLabel(seconds: number) {
  return seconds <= 0
    ? "Arriving"
    : seconds < 60
      ? "<1 min"
      : `${Math.ceil(seconds / 60)} min`;
}
export function elapsedLabel(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
