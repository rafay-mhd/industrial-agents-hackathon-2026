import { useState } from "react";
import { DoorOpen, TriangleAlert, RotateCcw, CheckCircle2 } from "lucide-react";
import type { BuildingData, BuildingChange } from "../types";
import { PlaceInput } from "./PlaceInput";
export function BuildingUpdates({
  data,
  closed,
  changes,
  busy,
  onEdit,
}: {
  data: BuildingData;
  closed: string[];
  changes: BuildingChange[];
  busy: boolean;
  onEdit: (edit: Record<string, unknown>) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<"closure" | "door">("closure"),
    [element, setElement] = useState(""),
    [first, setFirst] = useState(""),
    [second, setSecond] = useState(""),
    [accessible, setAccessible] = useState(false);
  const items = [
    ...(data.vertical_connectors ?? []).map((c) => ({
      id: c.id,
      label: `${c.kind === "lift" ? "Lift" : "Stairs"} · ${c.name || c.id}`,
    })),
    ...data.spaces.map((s) => ({
      id: s.id,
      label: `${s.name} · ${data.floors.find((f) => f.id === s.floor_id)?.name}`,
    })),
    ...(data.openings ?? []).map((d) => ({
      id: d.id,
      label: `Door · ${d.space_ids.map((id) => data.spaces.find((s) => s.id === id)?.name ?? "Outside").join(" ↔ ")}`,
    })),
  ];
  return (
    <details className="building-updates">
      <summary>
        <TriangleAlert size={16} />
        Building updates
        <span>
          {closed.length ? `${closed.length} unavailable` : "All clear"}
        </span>
      </summary>
      <p>
        Report an outage or add a new doorway. Saved changes update the building
        and recalculate your trip.
      </p>
      <div className="update-tabs">
        <button
          aria-pressed={kind === "closure"}
          onClick={() => setKind("closure")}
        >
          <TriangleAlert size={14} />
          Outage / reopen
        </button>
        <button aria-pressed={kind === "door"} onClick={() => setKind("door")}>
          <DoorOpen size={14} />
          New door
        </button>
      </div>
      {kind === "closure" ? (
        <>
          <label className="update-select">
            Lift, stairs, room or door
            <select
              value={element}
              onChange={(e) => setElement(e.target.value)}
            >
              <option value="">Choose a place or connection</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {closed.includes(item.id) ? " — unavailable" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            className="update-submit"
            disabled={!element || busy}
            onClick={() =>
              void onEdit({
                kind: "closure",
                element_id: element,
                closed: !closed.includes(element),
              })
            }
          >
            {closed.includes(element) ? (
              <RotateCcw size={14} />
            ) : (
              <TriangleAlert size={14} />
            )}{" "}
            {closed.includes(element)
              ? "Reopen connection"
              : "Mark unavailable"}
          </button>
        </>
      ) : (
        <>
          <PlaceInput
            data={data}
            label="Door joins"
            value={first}
            onChange={setFirst}
          />
          <PlaceInput
            data={data}
            label="Adjacent room"
            value={second}
            onChange={setSecond}
          />
          <label className="door-accessibility">
            <input
              type="checkbox"
              checked={accessible}
              onChange={(e) => setAccessible(e.target.checked)}
            />
            This doorway has no steps
          </label>
          <button
            className="update-submit"
            disabled={!first || !second || first === second || busy}
            onClick={() =>
              void onEdit({
                kind: "door",
                first,
                second,
                step_free: accessible,
              })
            }
          >
            <DoorOpen size={14} />
            Add doorway
          </button>
          <small>
            Adjacent rooms on the same floor only. The new door appears on their
            shared wall.
          </small>
        </>
      )}
      {!!closed.length && (
        <ul className="outage-list">
          {closed.map((id) => (
            <li key={id}>
              <TriangleAlert size={12} />
              <span>{items.find((x) => x.id === id)?.label ?? id}</span>
              <button
                disabled={busy}
                aria-label={`Reopen ${items.find((x) => x.id === id)?.label ?? id}`}
                onClick={() =>
                  void onEdit({
                    kind: "closure",
                    element_id: id,
                    closed: false,
                  })
                }
              >
                Reopen
              </button>
            </li>
          ))}
        </ul>
      )}
      {!!changes.length && (
        <div className="changes-log">
          <strong>Recent changes</strong>
          {[...changes]
            .reverse()
            .slice(0, 5)
            .map((c) => (
              <p key={c.id}>
                {c.kind === "door_added" ? (
                  <DoorOpen size={12} />
                ) : c.closed ? (
                  <TriangleAlert size={12} />
                ) : (
                  <CheckCircle2 size={12} />
                )}
                <span>
                  {c.label}
                  <small>
                    {c.kind === "warning"
                      ? c.status === "active"
                        ? "Warning posted"
                        : "Warning resolved"
                      : c.kind === "door_added"
                        ? "Door added"
                        : c.closed
                          ? "Marked unavailable"
                          : "Reopened"}
                  </small>
                </span>
              </p>
            ))}
        </div>
      )}
    </details>
  );
}
