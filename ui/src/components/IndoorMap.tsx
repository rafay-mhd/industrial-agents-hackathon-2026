import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { wheelZoomStep } from "../lib/lookExperiment";
import { motion, useReducedMotion } from "motion/react";
import { LocateFixed, Minus, Plus, Compass } from "lucide-react";
import type { BuildingData, Floor } from "../types";
import { parseFootprint } from "../types";
import {
  boundsOf,
  interiorPoint,
  label,
  palette,
  polygonArea,
  routeOnFloor,
  visibleClosures,
} from "../lib/model";
import type { Layers, Location, MapState } from "../lib/model";
import { useRoutePlayback } from "../lib/routePlaybackContext";
import { travelledFloorPath } from "../lib/routePlayback";
import { footprintTrail, walkingCue, turnSymbol } from "../lib/walking";
import { journeyEstimate } from "../lib/journey";
import { useRouteFrame } from "../lib/routePlaybackContext";
import { warningPins } from "../lib/liveWarnings";
import { PixelPerson } from "./PixelPerson";
import { easeCamera, easeZoom } from "../lib/sceneMath";

export type Selection = {
  kind: "space" | "asset" | "opening" | "connector";
  id: string;
} | null;

function RouteFootprints({ floorId }: { floorId: string }) {
  const frame = useRouteFrame();
  const prints = useMemo(
    () => footprintTrail(frame.plan).filter((p) => p.floorId === floorId),
    [frame.plan, floorId],
  );
  return (
    <g aria-label="Walking footprint trail">
      {prints.map((p, i) => (
        <path
          key={i}
          d="M-.045,-.12 C-.07,-.02 -.07,.12 -.015,.16 C.065,.18 .07,.06 .045,-.02 L.035,-.12 Z"
          transform={`translate(${p.point[0]},${p.point[2]}) rotate(${(p.heading * 180) / Math.PI + 180})`}
          fill={p.distance <= frame.distance ? "#ae7926" : "#3150a2"}
          stroke="#fffaf0"
          strokeWidth=".018"
          opacity={p.distance <= frame.distance ? 0.9 : 0.72}
        />
      ))}
    </g>
  );
}
export type MapProps = {
  data: BuildingData;
  floor: Floor;
  state: MapState;
  layers: Layers;
  selected: Selection;
  location: Location | null;
  avatar: number;
  /** Show the wheelchair user instead of the walker in the 3D route preview. */
  wheelchair?: boolean;
  onSelect: (selection: Selection) => void;
  onWarning?: () => void;
};

export default function IndoorMap({
  data,
  floor,
  state,
  layers,
  selected,
  location,
  avatar,
  wheelchair,
  onSelect,
  onWarning,
}: MapProps) {
  const navigation = useRoutePlayback();
  const svg = useRef<SVGSVGElement>(null),
    wrapper = useRef<HTMLDivElement>(null),
    dragged = useRef(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(
    null,
  );
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [size, setSize] = useState({ width: 800, height: 550 });
  const previewDistance = useRef<SVGTextElement>(null);
  const previewMarker = useRef<SVGGElement>(null),
    previewSprite = useRef<SVGGElement>(null),
    completedTrail = useRef<SVGPathElement>(null);
  const reduced = useReducedMotion();
  const camera = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  const destination = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  const cameraFrame = useRef(0);
  const moveCamera = useCallback(
    (next: typeof camera.current, duration = 480, easing = easeCamera) => {
      cancelAnimationFrame(cameraFrame.current);
      destination.current = next;
      const from = camera.current,
        start = performance.now();
      const tick = (now: number) => {
        const t =
            reduced || !duration ? 1 : Math.min((now - start) / duration, 1),
          k = easing(t);
        const value = {
          zoom: from.zoom + (next.zoom - from.zoom) * k,
          pan: {
            x: from.pan.x + (next.pan.x - from.pan.x) * k,
            y: from.pan.y + (next.pan.y - from.pan.y) * k,
          },
        };
        camera.current = value;
        setZoom(value.zoom);
        setPan(value.pan);
        if (t < 1) cameraFrame.current = requestAnimationFrame(tick);
      };
      cameraFrame.current = requestAnimationFrame(tick);
    },
    [reduced],
  );
  useEffect(() => () => cancelAnimationFrame(cameraFrame.current), []);
  const spaces = useMemo(
    () => data.spaces.filter((s) => s.floor_id === floor.id),
    [data, floor.id],
  );
  const b = useMemo(() => boundsOf(spaces.flatMap((s) => s.polygon)), [spaces]);
  const route = useMemo(
    () => routeOnFloor(state.route, floor),
    [state.route, floor],
  );
  const scale = Math.max(b.width, b.height),
    padding = scale * 0.09;
  const vw = (b.width + padding * 2) / zoom,
    vh = (b.height + padding * 2) / zoom;
  const pixelUnit = Math.max(vw / size.width, vh / size.height);
  const vb = [
    (b.minX + b.maxX - vw) / 2 + pan.x,
    (-b.maxY - b.minY - vh) / 2 + pan.y,
    vw,
    vh,
  ].join(" ");
  const closed = useMemo(
      () => visibleClosures(data, state.closed),
      [data, state.closed],
    ),
    highlighted = useMemo(() => new Set(state.spaces), [state.spaces]);
  const openings = useMemo(
    () =>
      [
        ...(data.openings ?? []).filter(
          (d) => !state.doors.some((a) => a.id === d.id),
        ),
        ...state.doors,
      ].filter((d) => d.floor_id === floor.id),
    [data, state.doors, floor.id],
  );
  const metrics = useMemo(
    () =>
      spaces.map((space) => ({
        space,
        point: interiorPoint(space.polygon),
        area: polygonArea(space.polygon),
        bounds: boundsOf(space.polygon),
      })),
    [spaces],
  );
  const labels = useMemo(() => {
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    return [...metrics]
      .sort(
        (a, c) =>
          Number(c.space.id === selected?.id) -
            Number(a.space.id === selected?.id) || c.area - a.area,
      )
      .flatMap((m) => {
        const full = label(m.space),
          words = full.split(" "),
          last = words.at(-1) ?? "";
        let lines =
          words.length > 1 && full.length > 17
            ? [words.slice(0, -1).join(" "), last]
            : [full];
        if (
          m.bounds.width <
            Math.max(...lines.map((l) => l.length)) * 5.7 * pixelUnit &&
          m.space.ref
        )
          lines = [m.space.ref];
        const width = Math.max(...lines.map((l) => l.length)) * 5.7 * pixelUnit,
          height = lines.length * 12 * pixelUnit;
        if (
          m.bounds.width < width * 0.8 ||
          m.bounds.height < height ||
          m.area < width * height * 0.7
        )
          return [];
        const box = {
          x: m.point[0] - width / 2,
          y: -m.point[1] - height / 2,
          w: width,
          h: height,
        };
        if (
          placed.some(
            (p) =>
              box.x < p.x + p.w + pixelUnit * 5 &&
              box.x + box.w > p.x - pixelUnit * 5 &&
              box.y < p.y + p.h + pixelUnit * 4 &&
              box.y + box.h > p.y - pixelUnit * 4,
          )
        )
          return [];
        placed.push(box);
        return [{ ...m, lines }];
      });
  }, [metrics, pixelUnit, selected]);

  useEffect(() => {
    if (!wrapper.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(wrapper.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      navigation.store.setFollow(false);
      const from = destination.current,
        rect = element.getBoundingClientRect();
      const nextZoom = Math.max(
        0.55,
        Math.min(12, from.zoom * Math.exp(-wheelZoomStep(event, rect.height))),
      );
      const unit = Math.max(
        (b.width + padding * 2) / rect.width,
        (b.height + padding * 2) / rect.height,
      );
      const dx = event.clientX - rect.left - rect.width / 2,
        dy = event.clientY - rect.top - rect.height / 2;
      moveCamera(
        {
          zoom: nextZoom,
          pan: {
            x: from.pan.x + dx * unit * (1 / from.zoom - 1 / nextZoom),
            y: from.pan.y + dy * unit * (1 / from.zoom - 1 / nextZoom),
          },
        },
        180,
        easeZoom,
      );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [b, padding, moveCamera, navigation.store]);
  useEffect(() => {
    if (state.route && !navigation.store.getFrame().follow)
      moveCamera({ zoom: 1, pan: { x: 0, y: 0 } }, 260, easeZoom);
  }, [state.route, moveCamera, navigation.store]);
  useEffect(() => {
    if (!selected || !["space", "asset"].includes(selected.kind)) return;
    const space =
      selected.kind === "space"
        ? spaces.find((s) => s.id === selected.id)
        : undefined;
    const asset =
      selected.kind === "asset"
        ? data.assets?.find(
            (a) => a.id === selected.id && a.floor_id === floor.id,
          )
        : undefined;
    if (!space && !asset) return;
    navigation.store.setFollow(false);
    const fp = asset && parseFootprint(asset.footprint);
    const bounds = space
        ? boundsOf(space.polygon)
        : {
            width: Math.max(fp?.width_m ?? 1, 2),
            height: Math.max(fp?.depth_m ?? 1, 2),
          },
      point = space ? interiorPoint(space.polygon) : asset!.position;
    const targetZoom = Math.min(
      6,
      Math.max(
        1.4,
        Math.min(b.width / bounds.width, b.height / bounds.height) * 0.65,
      ),
    );
    moveCamera(
      {
        zoom: targetZoom,
        pan: {
          x: point[0] - (b.minX + b.maxX) / 2,
          y: -point[1] + (b.minY + b.maxY) / 2,
        },
      },
      850,
    );
  }, [
    selected,
    spaces,
    data.assets,
    floor.id,
    b,
    moveCamera,
    navigation.store,
  ]);
  useEffect(() => {
    let raf = 0,
      last = performance.now(),
      revision = -1,
      lastLabels = 0,
      following = false;
    let flight: { from: typeof camera.current; start: number } | null = null;
    const tick = (now: number) => {
      const f = navigation.store.getFrame(),
        shown = f.active && layers.route && f.floorId === floor.id;
      previewMarker.current?.setAttribute(
        "visibility",
        shown ? "visible" : "hidden",
      );
      if (shown)
        previewMarker.current?.setAttribute(
          "transform",
          `translate(${f.point[0]},${f.point[2]})`,
        );
      completedTrail.current?.setAttribute(
        "d",
        travelledFloorPath(f, floor.id),
      );
      if (shown && f.follow) {
        cancelAnimationFrame(cameraFrame.current);
        if (revision !== f.revision || !following)
          flight = { from: camera.current, start: now };
        const target = {
          zoom: Math.min(7, Math.max(1, scale / 20)),
          pan: {
            x: f.point[0] - (b.minX + b.maxX) / 2,
            y: f.point[2] + (b.minY + b.maxY) / 2,
          },
        };
        const dt = Math.min(0.1, (now - last) / 1000),
          amount = reduced
            ? 1
            : flight
              ? easeCamera(Math.min(1, (now - flight.start) / 850))
              : 1 - Math.exp(-dt * 8);
        const from = flight ? flight.from : camera.current;
        camera.current = {
          zoom: from.zoom + (target.zoom - from.zoom) * amount,
          pan: {
            x: from.pan.x + (target.pan.x - from.pan.x) * amount,
            y: from.pan.y + (target.pan.y - from.pan.y) * amount,
          },
        };
        destination.current = camera.current;
        const w = (b.width + 2 * padding) / camera.current.zoom,
          h = (b.height + 2 * padding) / camera.current.zoom;
        svg.current?.setAttribute(
          "viewBox",
          `${(b.minX + b.maxX - w) / 2 + camera.current.pan.x} ${(-b.maxY - b.minY - h) / 2 + camera.current.pan.y} ${w} ${h}`,
        );
        if (flight && now - lastLabels > 100) {
          setZoom(camera.current.zoom);
          setPan(camera.current.pan);
          lastLabels = now;
        }
        if (flight && amount === 1) {
          flight = null;
          setZoom(camera.current.zoom);
          setPan(camera.current.pan);
        }
      } else if (following) {
        flight = null;
        setZoom(camera.current.zoom);
        setPan(camera.current.pan);
      }
      const unit = Math.max(
        (b.width + 2 * padding) / camera.current.zoom / size.width,
        (b.height + 2 * padding) / camera.current.zoom / size.height,
      );
      previewSprite.current?.setAttribute("transform", `scale(${unit * 1.25})`);
      if (shown && previewDistance.current) {
        const cue = walkingCue(f);
        const text = `${turnSymbol(cue.turn)} ${journeyEstimate(f.plan, f.distance).metres} m left`;
        if (previewDistance.current.textContent !== text)
          previewDistance.current.textContent = text;
      }
      revision = f.revision;
      following = shown && f.follow;
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [
    navigation.store,
    b,
    padding,
    scale,
    floor.id,
    layers.route,
    reduced,
    size,
  ]);
  const choose = (selection: Selection) => {
    if (!dragged.current) onSelect(selection);
  };
  const paths = state.route?.segments
    ?.filter((s) => s.floor_id === floor.id)
    .map((s) => s.points) ?? [route];
  const path = paths
    .map((points) =>
      points.map(([x, y], i) => `${i ? "L" : "M"}${x},${-y}`).join(" "),
    )
    .join(" ");
  const reached = state.pulse ? new Set(state.pulse.reachable_space_ids) : null;
  const pins = warningPins(data, floor.id);
  const previousPath =
    state.comparePrevious && state.previousRoute
      ? (
          state.previousRoute.segments
            ?.filter((s) => s.floor_id === floor.id)
            .map((s) => s.points) ?? [routeOnFloor(state.previousRoute, floor)]
        )
          .map((points) =>
            points.map(([x, y], i) => `${i ? "L" : "M"}${x},${-y}`).join(" "),
          )
          .join(" ")
      : "";
  const locationPoint =
    location?.floorId === floor.id ? location.position : null;

  return (
    <div className="map-viewport" ref={wrapper}>
      {state.comparePrevious && (
        <div className="route-compare-legend">
          <span>Previous route · no longer in use</span>
          <span>Current route</span>
        </div>
      )}
      <svg
        ref={svg}
        className="indoor-svg"
        viewBox={vb}
        role="group"
        aria-label={`${floor.name} indoor map. Choose a room for details.`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          navigation.store.setFollow(false);
          cancelAnimationFrame(cameraFrame.current);
          destination.current = camera.current;
          dragged.current = false;
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            px: camera.current.pan.x,
            py: camera.current.pan.y,
          };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dx = e.clientX - drag.current.x,
            dy = e.clientY - drag.current.y;
          if (Math.hypot(dx, dy) > 4) {
            dragged.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            moveCamera(
              {
                zoom: camera.current.zoom,
                pan: {
                  x: drag.current.px - dx * pixelUnit,
                  y: drag.current.py - dy * pixelUnit,
                },
              },
              0,
            );
          }
        }}
        onPointerUp={(e) => {
          drag.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onPointerLeave={() => {
          if (!dragged.current) drag.current = null;
        }}
      >
        <defs>
          <pattern
            id="closed-hatch"
            width={pixelUnit * 9}
            height={pixelUnit * 9}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(35)"
          >
            <rect width={pixelUnit * 9} height={pixelUnit * 9} fill="#f1dedc" />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2={pixelUnit * 9}
              stroke="#bc7d7d"
              strokeWidth={pixelUnit}
              opacity=".5"
            />
          </pattern>
        </defs>
        <g className="room-layer">
          {spaces.map((space) => (
            <polygon
              key={space.id}
              points={space.polygon.map(([x, y]) => `${x},${-y}`).join(" ")}
              fill={
                closed.has(space.id)
                  ? "url(#closed-hatch)"
                  : selected?.id === space.id
                    ? "#c2d0e8"
                    : reached
                      ? reached.has(space.id)
                        ? "#b7dcc7"
                        : "#e8e3d9"
                      : highlighted.has(space.id)
                        ? "#d6bd83"
                        : palette(space).fill
              }
              stroke={selected?.id === space.id ? "#29478e" : "#fffcf4"}
              strokeWidth={selected?.id === space.id ? 2.5 : 2}
              vectorEffect="non-scaling-stroke"
              className={`map-space ${reached ? (reached.has(space.id) ? "pulse-reachable" : "pulse-unreachable") : ""} ${highlighted.has(space.id) ? "map-highlight" : ""}`}
              onClick={() => choose({ kind: "space", id: space.id })}
            >
              <title>
                {label(space)} · {space.type}
                {closed.has(space.id)
                  ? " · Closed"
                  : reached
                    ? reached.has(space.id)
                      ? " · Reachable step-free"
                      : " · Not connected under access filters"
                    : ""}
              </title>
            </polygon>
          ))}
        </g>
        {(layers.assets || state.assets.length > 0) &&
          (data.assets ?? [])
            .filter(
              (a) =>
                a.floor_id === floor.id &&
                (layers.assets || state.assets.includes(a.id)),
            )
            .map((asset) => {
              const footprint = parseFootprint(asset.footprint),
                active =
                  state.assets.includes(asset.id) || selected?.id === asset.id;
              return (
                <g
                  key={asset.id}
                  transform={`translate(${asset.position[0]},${-asset.position[1]}) rotate(${-(footprint?.rotation_deg ?? 0)})`}
                  className="map-asset"
                  onClick={() => choose({ kind: "asset", id: asset.id })}
                >
                  {footprint ? (
                    <rect
                      x={-footprint.width_m / 2}
                      y={-footprint.depth_m / 2}
                      width={footprint.width_m}
                      height={footprint.depth_m}
                      fill={active ? "#b29456" : "#82939f"}
                      opacity={active ? 1 : 0.42}
                      stroke={active ? "#80622b" : "#617789"}
                      strokeWidth={pixelUnit}
                    />
                  ) : (
                    <circle
                      r={pixelUnit * 3}
                      fill={active ? "#b29456" : "#82939f"}
                    />
                  )}
                  <circle r={pixelUnit * 7} fill="transparent" />
                  <title>{asset.name || asset.id}</title>
                </g>
              );
            })}
        {(layers.openings || state.closed.length > 0) &&
          openings
            .filter((d) => layers.openings || closed.has(d.id))
            .map((door) => (
              <g
                key={door.id}
                transform={`translate(${door.position[0]},${-door.position[1]})`}
                onClick={() => choose({ kind: "opening", id: door.id })}
                className="map-door"
              >
                <circle
                  r={pixelUnit * (door.kind === "entrance" ? 5 : 3)}
                  fill={
                    closed.has(door.id)
                      ? "#a52b40"
                      : door.kind === "entrance"
                        ? "#29478e"
                        : "#fffaf0"
                  }
                  stroke={closed.has(door.id) ? "#a52b40" : "#9e8b67"}
                  strokeWidth={pixelUnit * 1.2}
                />
                <circle r={pixelUnit * 8} fill="transparent" />
                <title>
                  {door.name || door.kind} ·{" "}
                  {door.width_m != null ? `${door.width_m} m` : "width unknown"}
                  {closed.has(door.id) ? " · Closed" : ""}
                </title>
              </g>
            ))}
        {layers.labels && (
          <g className="map-labels" pointerEvents="none">
            {labels.map(({ space, point, lines }) => (
              <text
                key={space.id}
                x={point[0]}
                y={-point[1] - (lines.length - 1) * 5.8 * pixelUnit}
                textAnchor="middle"
                dominantBaseline="central"
                fill={closed.has(space.id) ? "#a52b40" : palette(space).ink}
                fontSize={11 * pixelUnit}
                fontWeight={space.type === "corridor" ? 500 : 600}
              >
                {lines.map((line, i) => (
                  <tspan key={i} x={point[0]} dy={i ? 12 * pixelUnit : 0}>
                    {line}
                  </tspan>
                ))}
              </text>
            ))}
          </g>
        )}
        {previousPath && (
          <path
            d={previousPath}
            fill="none"
            stroke="#ad3048"
            strokeWidth={3 * pixelUnit}
            strokeDasharray={`${7 * pixelUnit} ${6 * pixelUnit}`}
            opacity={0.65}
            pointerEvents="none"
          />
        )}
        {layers.route && route.length > 1 && (
          <g pointerEvents="none">
            <path
              d={path}
              fill="none"
              stroke="#fffaf0"
              strokeWidth={8 * pixelUnit}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <motion.path
              key={path}
              d={path}
              fill="none"
              stroke="#284a96"
              strokeWidth={1 * pixelUnit}
              strokeLinejoin="round"
              strokeLinecap="round"
              initial={{ pathLength: reduced ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.2, ease: "easeInOut" }}
            />
            <path
              d={path}
              fill="none"
              stroke="#aec6ff"
              strokeWidth={0.6 * pixelUnit}
              strokeDasharray={`${2 * pixelUnit} ${9 * pixelUnit}`}
              className="route-flow"
            />
            <path
              ref={completedTrail}
              fill="none"
              stroke="#c49b4f"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {[route[0], route[route.length - 1]].map((p, i) => (
              <g key={i} transform={`translate(${p[0]},${-p[1]})`}>
                <circle
                  r={pixelUnit * 7}
                  fill={i ? "#a52b40" : "#29478e"}
                  stroke="#fffaf0"
                  strokeWidth={pixelUnit * 2}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="white"
                  fontSize={pixelUnit * 8}
                  fontWeight="700"
                >
                  {i ? "·" : "·"}
                </text>
              </g>
            ))}
            <RouteFootprints floorId={floor.id} />
          </g>
        )}
        {pins.map((pin) => {
          const blocked = pin.warnings.some(
            (w) => w.blocks_route || w.asset_unavailable,
          );
          return (
            <g
              key={pin.id}
              transform={`translate(${pin.point[0]},${-pin.point[1]})`}
              role="button"
              tabIndex={0}
              aria-label={`Live warning: ${pin.warnings[0].label}. ${pin.warnings[0].message}`}
              onClick={(e) => {
                e.stopPropagation();
                onWarning?.();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onWarning?.();
                }
              }}
              className={`warning-map-pin ${blocked ? "blocking" : "caution"}`}
            >
              <title>{pin.warnings.map((w) => w.message).join(" · ")}</title>
              <circle
                className="warning-pin-pulse"
                r={pixelUnit * 14}
                fill="currentColor"
                opacity=".15"
              />
              <circle
                r={pixelUnit * 9}
                fill="currentColor"
                stroke="#fffbef"
                strokeWidth={pixelUnit * 2}
              />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
                fontSize={pixelUnit * 12}
                fontWeight="800"
              >
                !
              </text>
            </g>
          );
        })}
        {locationPoint && (
          <g
            transform={`translate(${locationPoint[0]},${-locationPoint[1]})`}
            pointerEvents="none"
          >
            <circle r={pixelUnit * 15} fill="#29478e" opacity=".08" />
            <circle
              r={pixelUnit * 5}
              fill="#29478e"
              stroke="#fff"
              strokeWidth={pixelUnit * 2}
            />
            <g
              transform={`translate(${-pixelUnit * 10},${-pixelUnit * 29}) scale(${pixelUnit * 1.25})`}
            >
              <PixelPerson
                variant={avatar}
                wheelchair={wheelchair}
                title="Your selected location"
                inMap
              />
            </g>
            <text
              textAnchor="middle"
              y={pixelUnit * 17}
              fontSize={pixelUnit * 10}
              fill="#29478e"
              fontWeight="700"
            >
              You
            </text>
          </g>
        )}
        <g
          ref={previewMarker}
          visibility="hidden"
          pointerEvents="none"
          aria-label="Route preview character"
        >
          <g ref={previewSprite}>
            <g className="route-marker-badge" aria-hidden="true">
              <rect
                x="-43"
                y="-58"
                width="86"
                height="26"
                rx="13"
                fill="#fffcf4"
                fillOpacity=".96"
                stroke="#fff"
              />
              <text
                ref={previewDistance}
                textAnchor="middle"
                y="-41"
                fontSize="11"
                fontWeight="700"
                fill="#29478e"
              />
            </g>
            <circle
              r={11}
              fill="#d0ae60"
              fillOpacity=".2"
              stroke="#b68a40"
              strokeWidth="1"
            />
            <g transform="translate(-8,-23)">
              <PixelPerson
                variant={avatar}
                wheelchair={wheelchair}
                title="Route preview character"
                inMap
              />
            </g>
            <text
              textAnchor="middle"
              y="19"
              fontSize="7"
              fontWeight="700"
              fill="#967438"
              stroke="#fffaf0"
              strokeWidth="2"
              paintOrder="stroke"
            >
              PREVIEW
            </text>
          </g>
        </g>
      </svg>
      {!spaces.length && (
        <div className="scene-error">
          No room geometry is supplied for this floor.
        </div>
      )}
      <div className="map-compass">
        <Compass size={24} strokeWidth={1.3} />
        <span>Y+</span>
      </div>
      <div className="map-scale">
        <span style={{ width: 60 }} />
        {(60 * pixelUnit).toLocaleString(undefined, {
          maximumFractionDigits: 1,
        })}{" "}
        {data.building.units === "m" || !data.building.units
          ? "m"
          : data.building.units}
      </div>
      <div className="map-zoom">
        <button
          aria-label="Zoom in"
          onClick={() => {
            navigation.store.setFollow(false);
            moveCamera(
              {
                ...destination.current,
                zoom: Math.min(12, destination.current.zoom * 1.4),
              },
              200,
              easeZoom,
            );
          }}
        >
          <Plus size={17} />
        </button>
        <button
          aria-label="Zoom out"
          onClick={() => {
            navigation.store.setFollow(false);
            moveCamera(
              {
                ...destination.current,
                zoom: Math.max(0.55, destination.current.zoom / 1.4),
              },
              200,
              easeZoom,
            );
          }}
        >
          <Minus size={17} />
        </button>
        <span />
        <button
          aria-label="Fit map"
          onClick={() => {
            navigation.store.setFollow(false);
            moveCamera({ zoom: 1, pan: { x: 0, y: 0 } }, 850);
          }}
        >
          <LocateFixed size={18} />
        </button>
      </div>
    </div>
  );
}
