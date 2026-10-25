import { useEffect, useRef, useState, useMemo } from "react";
import { motion } from "motion/react";
import {
  Box,
  Layers3,
  Scan,
  RotateCcw,
  Plus,
  Minus,
  Focus,
  Rotate3D,
  ArrowUpRight,
  ArrowUpDown,
  ChevronDown,
  DoorOpen,
  Sun,
} from "lucide-react";
import { createBuildingWorld } from "../lib/buildingWorld";
import type { SceneMode } from "../lib/buildingWorld";
import { isOutdoor, isExteriorEntrance } from "../lib/envelopeLayout";
import { floorGeometry } from "../lib/model";
import { useRoutePlayback, useRouteFrame } from "../lib/routePlaybackContext";
import type { MapProps } from "./IndoorMap";

const modes = [
  { id: "building", name: "Exterior", icon: Box },
  { id: "connected", name: "Cutaway", icon: Layers3 },
  { id: "floors", name: "Exploded", icon: Layers3 },
  { id: "inside", name: "Inside", icon: Scan },
] as const;

export default function BuildingScene(props: MapProps) {
  const { data, floor, state, layers, selected, location, onSelect, avatar } =
    props;
  const {
    floors,
    spaces,
    openings: sourceOpenings,
    vertical_connectors,
    assets,
  } = data;
  const { id, name, source, units } = data.building;
  const sceneData = useMemo(
    () => ({
      building: { id, name, source, units },
      floors,
      spaces,
      openings: sourceOpenings,
      vertical_connectors,
      assets,
    }),
    [
      id,
      name,
      source,
      units,
      floors,
      spaces,
      sourceOpenings,
      vertical_connectors,
      assets,
    ],
  );
  const navigation = useRoutePlayback(),
    navFrame = useRouteFrame();
  const host = useRef<HTMLDivElement>(null),
    labels = useRef<HTMLDivElement>(null);
  const world = useRef<ReturnType<typeof createBuildingWorld> | null>(null);
  const selectRef = useRef(onSelect);
  const [finish, setFinish] = useState<"materials" | "purpose">("purpose");
  const [mode, setMode] = useState<SceneMode>("building");
  const [modeFloorId, setModeFloorId] = useState(floor.id);
  const [orbit, setOrbit] = useState(false),
    [error, setError] = useState("");
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);
  const openings = [
    ...(data.openings ?? []).filter(
      (d) => !state.doors.some((a) => a.id === d.id),
    ),
    ...state.doors,
  ];
  const entrances = openings.filter(isExteriorEntrance);
  const outdoorSpaces = data.spaces.filter(isOutdoor);
  const exteriorSelection =
    selected &&
    (selected.kind === "opening"
      ? openings.some(
          (d) =>
            d.id === selected.id &&
            (isExteriorEntrance(d) ||
              d.space_ids.some((id) => outdoorSpaces.some((s) => s.id === id))),
        )
      : selected.kind === "space" &&
        outdoorSpaces.some((s) => s.id === selected.id));
  // Selecting any room (including from the directory) opens its interior.
  const displayMode =
    navFrame.active && navFrame.follow
      ? navFrame.leg?.kind === "connector"
        ? "connected"
        : "inside"
      : state.pulseActive || state.pulse
        ? "inside"
        : exteriorSelection
          ? "building"
          : selected?.kind === "connector"
            ? mode === "floors"
              ? "floors"
              : "connected"
            : selected || floor.id !== modeFloorId
              ? "inside"
              : mode;
  useEffect(() => {
    selectRef.current = onSelect;
  }, [onSelect]);
  useEffect(() => {
    if (!host.current || !labels.current) return;
    try {
      world.current = createBuildingWorld(
        host.current,
        labels.current,
        sceneData,
        state.doors,
        (s) => selectRef.current(s),
        () => {
          setOrbit(false);
          navigation.store.setFollow(false);
        },
        setError,
      );
    } catch {
      // oxlint-disable-next-line react/set-state-in-effect -- Report a failed external WebGL context.
      setError(
        "3D could not start on this device. The 2D map is still available.",
      );
    }
    return () => {
      world.current?.dispose();
      world.current = null;
    };
  }, [sceneData, state.doors, navigation.store]);
  useEffect(() => {
    world.current?.bindNavigation(navigation.store, avatar);
  }, [navigation.store, avatar, sceneData, state.doors]);
  useEffect(() => {
    if (selected && navigation.store.getFrame().active)
      navigation.store.setFollow(false);
  }, [selected, navigation.store]);
  useEffect(() => {
    world.current?.update({
      floorId: floor.id,
      mode: displayMode,
      orbit,
      finish,
      state,
      layers,
      selected,
      location,
    });
  }, [
    data,
    floor.id,
    displayMode,
    orbit,
    finish,
    state,
    layers,
    selected,
    location,
  ]);
  const changeMode = (next: SceneMode) => {
    navigation.store.setFollow(false);
    onSelect(null);
    setMode(next);
    setModeFloorId(floor.id);
    setOrbit(false);
  };
  const estimated = data.floors.some((f) => floorGeometry(f).estimated);
  return (
    <motion.div
      className={`scene-viewport ${navFrame.active && navFrame.follow && navFrame.firstPerson ? "is-walking" : ""}`}
      data-presentation={displayMode}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      <div
        className="three-host"
        ref={host}
        role="img"
        aria-label={`Interactive coloured 3D model of ${data.building.name}. Drag to orbit, scroll to zoom, select a room or object to fly inside. Room and object details are also available in the directory.`}
      />
      <div className="scene-labels" ref={labels} />
      <div className="scene-heading">
        <span className="scene-eyebrow">
          <i /> SPATIAL EXPLORER
        </span>
        <strong>
          {displayMode === "building"
            ? "Your building, from outside."
            : displayMode === "connected"
              ? "Every floor, connected."
              : displayMode === "floors"
                ? "Exploded for inspection."
                : floor.name}
        </strong>
        <span>
          {displayMode === "building"
            ? `${entrances.length} ${entrances.length === 1 ? "entrance" : "entrances"} · ${outdoorSpaces.length} outdoor ${outdoorSpaces.length === 1 ? "area" : "areas"}`
            : displayMode === "connected"
              ? "Source elevations · stairs & lift connections"
              : displayMode === "floors"
                ? "Artificial spacing · return to Cutaway to assemble"
                : "Select a room or an object to move closer"}
        </span>
      </div>
      <div className="scene-finish" role="group" aria-label="Model appearance">
        <button
          aria-pressed={finish === "materials"}
          onClick={() => setFinish("materials")}
        >
          Materials
        </button>
        <button
          aria-pressed={finish === "purpose"}
          onClick={() => setFinish("purpose")}
        >
          Room colours
        </button>
      </div>
      <div className="scene-connections">
        <button
          className="connections-toggle"
          aria-expanded={connectionsOpen}
          aria-controls="scene-connections-menu"
          onClick={() => {
            setConnectionsOpen((v) => !v);
            setSiteOpen(false);
          }}
        >
          <ArrowUpDown size={14} /> Connections{" "}
          <span>{data.vertical_connectors?.length ?? 0}</span>
          <ChevronDown size={12} />
        </button>
        {connectionsOpen && (
          <div
            id="scene-connections-menu"
            className="connections-menu"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setConnectionsOpen(false);
              }
            }}
          >
            <span className="eyebrow">BETWEEN FLOORS</span>
            {(data.vertical_connectors ?? []).map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setMode("connected");
                  setModeFloorId(floor.id);
                  setOrbit(false);
                  onSelect({ kind: "connector", id: c.id });
                  setConnectionsOpen(false);
                }}
              >
                <span>{c.kind === "lift" ? "⇅" : "↗"}</span>
                <span>
                  <strong>{c.name || c.kind}</strong>
                  <small>
                    {c.floor_ids
                      .map(
                        (id) =>
                          data.floors.find((f) => f.id === id)?.name ?? id,
                      )
                      .join(" · ")}
                  </small>
                </span>
              </button>
            ))}
            {!data.vertical_connectors?.length && (
              <p>No floor connections are supplied in this building’s data.</p>
            )}
            <p>Source connections · illustrative stair and shaft geometry</p>
          </div>
        )}
      </div>
      <div className="scene-site-controls">
        <button
          className="connections-toggle"
          aria-expanded={siteOpen}
          aria-controls="scene-site-menu"
          onClick={() => {
            setSiteOpen((v) => !v);
            setConnectionsOpen(false);
          }}
        >
          <DoorOpen size={14} /> Entrances & outdoors <ChevronDown size={12} />
        </button>
        {siteOpen && (
          <div
            className="connections-menu site-menu"
            id="scene-site-menu"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setSiteOpen(false);
              }
            }}
          >
            <span className="eyebrow">ARRIVE HERE · {entrances.length}</span>
            {entrances.map((d, i) => (
              <button
                key={d.id}
                onClick={() => {
                  navigation.explore();
                  setMode("building");
                  setModeFloorId(d.floor_id);
                  onSelect({ kind: "opening", id: d.id });
                  setSiteOpen(false);
                }}
              >
                <span>
                  <DoorOpen size={15} />
                </span>
                <span>
                  <strong>
                    {d.name || `Entrance ${String(i + 1).padStart(2, "0")}`}
                  </strong>
                  <small>
                    {data.floors.find((f) => f.id === d.floor_id)?.name} ·{" "}
                    {d.width_m ? `${d.width_m} m wide` : "Width unknown"}
                    {d.synthetic ? " · generated point" : ""}
                  </small>
                </span>
              </button>
            ))}
            {!entrances.length && <p>No exterior entrances are recorded.</p>}
            <span className="eyebrow">
              OUTDOOR SPACES · {outdoorSpaces.length}
            </span>
            {outdoorSpaces.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  navigation.explore();
                  setMode("building");
                  setModeFloorId(s.floor_id);
                  onSelect({ kind: "space", id: s.id });
                  setSiteOpen(false);
                }}
              >
                <span>
                  <Sun size={15} />
                </span>
                <span>
                  <strong>{s.name || s.room_type}</strong>
                  <small>
                    {data.floors.find((f) => f.id === s.floor_id)?.name} ·{" "}
                    {s.room_type ?? s.type}
                  </small>
                </span>
              </button>
            ))}
            {!outdoorSpaces.length && (
              <p>No balconies, terraces or outdoor areas are recorded.</p>
            )}
            <p>
              Source locations and footprints. Roof profiles, facade finishes,
              glazing and railings are illustrative.
            </p>
          </div>
        )}
      </div>
      <div className="scene-navigation">
        <button
          title="Zoom in"
          aria-label="Zoom in 3D"
          onClick={() => world.current?.zoom(0.72)}
        >
          <Plus size={18} />
        </button>
        <button
          title="Zoom out"
          aria-label="Zoom out 3D"
          onClick={() => world.current?.zoom(1.38)}
        >
          <Minus size={18} />
        </button>
        <span />
        <button
          title="Top view"
          aria-label="Animate to top view"
          onClick={() => {
            setOrbit(false);
            world.current?.fit(true);
          }}
        >
          <Focus size={18} />
        </button>
        <button
          title="Reset view"
          aria-label="Reset 3D view"
          onClick={() => {
            setOrbit(false);
            world.current?.fit();
          }}
        >
          <RotateCcw size={17} />
        </button>
      </div>
      {error && <div className="scene-error">{error}</div>}
      {displayMode === "inside" &&
        !data.spaces.some((s) => s.floor_id === floor.id) && (
          <div className="scene-error">
            No room geometry is supplied for this floor. Choose another floor.
          </div>
        )}
      <div className="scene-bottom">
        <div
          className="scene-controls"
          role="group"
          aria-label="3D presentation"
        >
          {modes.map(({ id, name, icon: Icon }) => (
            <button
              key={id}
              aria-pressed={displayMode === id}
              className={displayMode === id ? "active" : ""}
              onClick={() => changeMode(id)}
            >
              {displayMode === id && (
                <motion.span
                  className="scene-tab-indicator"
                  layoutId="scene-mode"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <Icon size={16} />
              <span>{name}</span>
            </button>
          ))}
          <span className="scene-controls-divider" />
          <button
            className={orbit ? "active orbit-button" : "orbit-button"}
            aria-label={
              orbit ? "Pause building orbit" : "Orbit around building"
            }
            aria-pressed={orbit}
            onClick={() => setOrbit((v) => !v)}
          >
            <Rotate3D size={17} />
            <span>Orbit</span>
          </button>
        </div>
        <span className="scene-gesture">
          <ArrowUpRight size={12} /> Drag to explore · scroll to move closer
        </span>
      </div>
      <span className="scene-provenance">
        {estimated
          ? "Missing heights estimated at 3 m"
          : "Source footprints & floor heights"}{" "}
        · illustrative roof, facade & furnishings
      </span>
    </motion.div>
  );
}
