import type { BuildingData } from "../types";
import { warningsOf } from "./liveWarnings.ts";
export function placeChoices(data: BuildingData) {
  const floors = new Map(data.floors.map((f) => [f.id, f.name])),
    rooms = new Map(data.spaces.map((s) => [s.id, s.name]));
  const unavailable = new Set(
    warningsOf(data)
      .filter((w) => w.status === "active" && w.asset_unavailable)
      .map((w) => w.element_id),
  );
  return [
    ...data.spaces.map((s) => ({
      id: s.id,
      name: s.name || s.ref,
      detail: `${floors.get(s.floor_id) || ""} · ${s.ref || ""}`,
      search: `${s.name} ${s.ref} ${floors.get(s.floor_id) || ""}`,
      unavailable: false,
    })),
    ...(data.assets ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      detail: `${rooms.get(a.space_id) || ""} · ${floors.get(a.floor_id) || ""}${unavailable.has(a.id) ? " · Reported unavailable" : ""}`,
      search: `${a.name} ${a.type?.replaceAll("_", " ")} ${rooms.get(a.space_id) || ""} ${floors.get(a.floor_id) || ""}`,
      unavailable: unavailable.has(a.id),
    })),
  ];
}
export function nearestChoices(data: BuildingData, query: string) {
  const words = query
    .toLowerCase()
    .replace(/^(closest|nearest)\s+/, "")
    .replaceAll("_", " ")
    .trim()
    .split(/\s+/);
  if (!words[0]) return [];
  return [
    ...new Set(
      (data.assets ?? []).map((a) => a.type).filter((v): v is string => !!v),
    ),
  ]
    .filter((type) =>
      words.every((w) => type.replaceAll("_", " ").toLowerCase().includes(w)),
    )
    .slice(0, 4)
    .map((type) => ({
      id: `nearest:${type}`,
      name: `Nearest ${type.replaceAll("_", " ")}`,
      detail: "By walking distance · skips reported outages",
      search: type,
      unavailable: false,
    }));
}
