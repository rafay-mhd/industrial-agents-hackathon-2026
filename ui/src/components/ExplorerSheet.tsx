import { useEffect, useRef } from "react";
import {
  ArrowDownToLine,
  DoorOpen,
  Layers3,
  MapPin,
  Navigation,
  Upload,
  X,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { BuildingData } from "../types";
import { floorGeometry } from "../lib/model";
import type { Layers } from "../lib/model";
import { PlanImport } from "./PlanImport";

export type Sheet = "layers" | "import" | "source" | null;
type Props = {
  panel: Sheet;
  close: () => void;
  data: BuildingData | null;
  layers: Layers;
  setLayers: Dispatch<SetStateAction<Layers>>;
  upload: (file: File) => Promise<void>;
  onCreated: (data: BuildingData, warnings: string[]) => Promise<void>;
  notice: string;
};
export default function ExplorerSheet({
  panel,
  close,
  data,
  layers,
  setLayers,
  upload,
  onCreated,
  notice,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null),
    jsonInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (panel && dialog.current && !dialog.current.open)
      dialog.current.showModal();
    if (!panel && dialog.current?.open) dialog.current.close();
  }, [panel]);
  const download = () => {
    if (!data) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${data.building.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <>
      <dialog
        ref={dialog}
        className="sheet-dialog"
        aria-label={panel ? `${panel} settings` : "Explorer settings"}
        onCancel={close}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className="sheet-content">
          <button
            className="sheet-close icon-button"
            aria-label="Close panel"
            onClick={close}
          >
            <X size={20} />
          </button>
          {panel === "layers" && (
            <>
              <span className="eyebrow">JUST THE RIGHT AMOUNT</span>
              <h2>Make it your map.</h2>
              <p>
                Keep things simple, or look a little closer. Every detail comes
                from the building file.
              </p>
              <div className="layer-options">
                {(
                  [
                    {
                      key: "labels",
                      title: "Room names",
                      description:
                        "Clear labels, with more revealed as you zoom.",
                      icon: MapPin,
                    },
                    {
                      key: "openings",
                      title: "Doors & entrances",
                      description: "Inspect widths, access and closures.",
                      icon: DoorOpen,
                    },
                    {
                      key: "assets",
                      title: "Furniture & equipment",
                      description:
                        "Original positions and supplied footprints.",
                      icon: Layers3,
                    },
                    {
                      key: "route",
                      title: "Your route",
                      description:
                        "Follow the exact path returned by the agent.",
                      icon: Navigation,
                    },
                  ] as const
                ).map((item) => (
                  <label key={item.key}>
                    <item.icon size={20} />
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.description}</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={layers[item.key]}
                      onChange={(e) =>
                        setLayers((prev) => ({
                          ...prev,
                          [item.key]: e.target.checked,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
              <p className="fine-print">
                3D walls use a 10 cm display thickness. Door gaps use supplied
                widths; equipment is shown as a flat footprint because its
                height is not in the data. Room names are available in the
                directory and on selection in both views.
              </p>
            </>
          )}
          {panel === "source" && data && (
            <>
              <span className="eyebrow">THE PLACE BEHIND THE MAP</span>
              <h2>{data.building.name}</h2>
              <p>
                Both map views use the same original room polygons, opening
                positions and floor levels.
              </p>
              <dl className="building-facts">
                <div>
                  <dt>Source</dt>
                  <dd>{data.building.source}</dd>
                </div>
                <div>
                  <dt>Building ID</dt>
                  <dd>{data.building.id}</dd>
                </div>
                <div>
                  <dt>Spaces / floors</dt>
                  <dd>
                    {data.spaces.length} / {data.floors.length}
                  </dd>
                </div>
                <div>
                  <dt>Openings / connectors</dt>
                  <dd>
                    {data.openings?.length ?? 0} /{" "}
                    {data.vertical_connectors?.length ?? 0}
                  </dd>
                </div>
                <div>
                  <dt>Equipment & furniture</dt>
                  <dd>{data.assets?.length ?? 0}</dd>
                </div>
                <div>
                  <dt>Units</dt>
                  <dd>
                    {data.building.units || "metres (dataset convention)"}
                  </dd>
                </div>
                {data.building.license && (
                  <div>
                    <dt>License</dt>
                    <dd>{data.building.license}</dd>
                  </div>
                )}
              </dl>
              {data.building.attribution && (
                <p className="fine-print">{data.building.attribution}</p>
              )}
              <p className="fine-print">
                This is a spatial model, not a surveyed exterior. Window
                positions, facade materials and equipment heights are not
                supplied.{" "}
                {data.floors.some((f) => floorGeometry(f).estimated)
                  ? "Missing floor heights / elevations use an explicit 3 m estimate."
                  : "All floor heights and elevations come from the file."}
              </p>
              <button className="primary-button" onClick={download}>
                <ArrowDownToLine size={16} />
                Download original building JSON
              </button>
            </>
          )}
          {panel === "import" && (
            <>
              <span className="eyebrow">EVERY BUILDING IS WELCOME</span>
              <h2>
                A new place.
                <br />
                The same familiar guide.
              </h2>
              <p>
                Open a building JSON to explore its rooms instantly in 2D and
                3D. No building-specific templates.
              </p>
              {notice && (
                <p className="sheet-notice" role="alert">
                  {notice}
                </p>
              )}
              <button
                className="upload-zone"
                onClick={() => jsonInput.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file) void upload(file);
                }}
              >
                <Upload size={27} strokeWidth={1.3} />
                <strong>Drop your building.json here</strong>
                <span>or choose a file · up to 20 MB</span>
              </button>
              <PlanImport onCreated={onCreated} />
              <p className="fine-print">
                Building JSON imports register with the agent automatically, so
                chat, voice and routing work on your new map.
              </p>
            </>
          )}
        </div>
      </dialog>
      <input
        ref={jsonInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
    </>
  );
}
