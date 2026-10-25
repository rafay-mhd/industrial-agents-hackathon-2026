import type { BuildingData, LiveWarning } from "../types";
import { interiorPoint } from "./model.ts";
export const warningsOf = (data: BuildingData | null): LiveWarning[] =>
  Array.isArray(data?.building.live_warnings)
    ? (data.building.live_warnings as LiveWarning[])
    : [];
export function warningPlaces(data: BuildingData) {
  const names = new Map(data.spaces.map((s) => [s.id, s.name]));
  const floors = new Map(data.floors.map((f) => [f.id, f.name]));
  return [
    ...(data.vertical_connectors ?? []).map((c) => ({
      id: c.id,
      label: `${c.kind === "lift" ? "Lift" : "Stairs"} · ${c.name}`,
    })),
    ...data.spaces.map((s) => ({
      id: s.id,
      label: `${s.name} · ${floors.get(s.floor_id) ?? ""}`,
    })),
    ...(data.assets ?? []).map((a) => ({
      id: a.id,
      label: `${a.name} · ${names.get(a.space_id) ?? ""} · ${floors.get(a.floor_id) ?? ""}`,
    })),
    ...(data.openings ?? []).map((d) => ({
      id: d.id,
      label:
        d.name ||
        `Door · ${d.space_ids.map((id) => names.get(id) ?? "Outside").join(" ↔ ")}`,
    })),
  ];
}
export function warningPins(data: BuildingData, floorId: string) {
  const groups = new Map<
    string,
    { id: string; point: [number, number]; warnings: LiveWarning[] }
  >();
  for (const w of warningsOf(data).filter((w) => w.status === "active")) {
    const connector = data.vertical_connectors?.find(
      (c) => c.id === w.element_id,
    );
    const room = data.spaces.find(
      (s) =>
        s.floor_id === floorId &&
        (s.id === w.element_id || connector?.space_ids.includes(s.id)),
    );
    const door = data.openings?.find(
      (d) => d.id === w.element_id && d.floor_id === floorId,
    );
    const asset = data.assets?.find(
      (a) => a.id === w.element_id && a.floor_id === floorId,
    );
    if (!room && !door && !asset) continue;
    const existing = groups.get(w.element_id);
    if (existing) existing.warnings.push(w);
    else
      groups.set(w.element_id, {
        id: w.element_id,
        point:
          asset?.position ?? door?.position ?? interiorPoint(room!.polygon),
        warnings: [w],
      });
  }
  return [...groups.values()];
}
export function relativeReportTime(value: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 60000),
  );
  if (!Number.isFinite(minutes) || minutes === 0) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / 1440)} d ago`;
}
