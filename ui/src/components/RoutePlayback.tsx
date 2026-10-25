import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, ComponentProps } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  LocateFixed,
  X,
  ArrowUpDown,
  Navigation,
  Check,
  ChevronDown,
} from "lucide-react";
import type { BuildingData, RouteAction } from "../types";
import type { Location } from "../lib/model";
import { buildRoutePlan, createPlaybackStore } from "../lib/routePlayback";
import {
  Context,
  useRoutePlayback,
  useRouteFrame,
} from "../lib/routePlaybackContext";
import type { Controls } from "../lib/routePlaybackContext";
import { PixelPerson } from "./PixelPerson";
import { walkingCue } from "../lib/walking";
import { useWalking } from "../hooks/useWalking";

export function RoutePlaybackProvider({
  data,
  route,
  location,
  playing,
  setPlaying,
  onFloorChange,
  onBegin,
  onClear,
  onWalkView,
  children,
}: {
  data: BuildingData | null;
  route: RouteAction | null;
  location: Location | null;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  onFloorChange: (id: string) => void;
  onBegin: () => void;
  onClear: () => void;
  onWalkView: () => void;
  children: ReactNode;
}) {
  const [store] = useState(createPlaybackStore);
  const callbacks = useRef({
    onFloorChange,
    onBegin,
    onClear,
    setPlaying,
    onWalkView,
  });
  useEffect(() => {
    callbacks.current = {
      onFloorChange,
      onBegin,
      onClear,
      setPlaying,
      onWalkView,
    };
  }, [onFloorChange, onBegin, onClear, setPlaying, onWalkView]);
  const plan = useMemo(
    () => buildRoutePlan(data, route, location),
    [data, route, location],
  );
  const priorPlan = useRef<{
    route: RouteAction | null;
    location: Location | null;
    signature: string;
  } | null>(null);
  useEffect(() => {
    const signature = JSON.stringify(plan),
      old = priorPlan.current;
    priorPlan.current = { route, location, signature };
    // Metadata-only alerts must not restart an unaffected walker or move their camera.
    if (
      old &&
      old.route === route &&
      old.location === location &&
      old.signature === signature
    )
      return;
    store.setPlan(plan);
    store.setFirstPerson(false);
    if (plan.legs.length) {
      callbacks.current.onBegin();
      callbacks.current.onFloorChange(store.getFrame().floorId);
    }
    // Planning shows the whole route; movement begins only after an explicit start.
    store.setFollow(false);
    callbacks.current.setPlaying(false);
  }, [store, plan, route, location]);
  useEffect(() => {
    store.play(playing);
  }, [store, playing]);
  useEffect(() => {
    let frame = 0,
      last = performance.now(),
      floor = "";
    const tick = (now: number) => {
      const wasPlaying = store.getFrame().playing;
      if (!document.hidden) store.tick((now - last) / 1000);
      last = now;
      const current = store.getFrame();
      if (current.follow && current.active && current.floorId !== floor) {
        floor = current.floorId;
        callbacks.current.onFloorChange(floor);
      }
      if (wasPlaying && current.finished) callbacks.current.setPlaying(false);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [store]);
  const value = useMemo<Controls>(
    () => ({
      store,
      walkView() {
        if (!store.getFrame().plan.verified || !store.getFrame().plan.complete)
          return;
        const frame = store.getFrame();
        if (!frame.firstPerson) {
          if (frame.finished) store.restart();
          store.setFollow(true);
          if (!frame.live) {
            store.play(true);
            callbacks.current.setPlaying(true);
          }
        }
        store.setFirstPerson(!frame.firstPerson);
        callbacks.current.onBegin();
        callbacks.current.onWalkView();
      },
      toggle() {
        const f = store.getFrame();
        if (f.finished) {
          store.restart();
          callbacks.current.onBegin();
          callbacks.current.setPlaying(true);
        } else {
          if (!f.playing) store.setFollow(true);
          store.play(!f.playing);
          callbacks.current.setPlaying(!f.playing);
        }
      },
      restart() {
        store.restart();
        callbacks.current.onBegin();
        callbacks.current.onFloorChange(store.getFrame().floorId);
        callbacks.current.setPlaying(true);
      },
      follow() {
        store.setFollow(true);
        callbacks.current.onBegin();
        callbacks.current.onFloorChange(store.getFrame().floorId);
      },
      explore() {
        store.setFollow(false);
      },
      clear() {
        callbacks.current.setPlaying(false);
        callbacks.current.onClear();
      },
    }),
    [store],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function RoutePlayer({ avatar }: { avatar: number }) {
  const controls = useRoutePlayback(),
    frame = useRouteFrame();
  const walking = useWalking(controls.store),
    cue = walkingCue(frame);
  const [calibrated, setCalibrated] = useState<typeof frame.plan | null>(null);
  if (!frame.active) return null;
  const { plan, leg } = frame,
    status = frame.finished
      ? plan.complete
        ? "Preview complete"
        : "End of mapped segment"
      : frame.playing
        ? leg?.kind === "connector"
          ? "Changing floors"
          : "Walking the route"
        : "Preview paused";
  return (
    <section
      className={`navigation-player ${frame.firstPerson && frame.follow ? "is-first-person" : ""}`}
      data-follow={frame.follow}
      aria-label="Visual route player"
    >
      <div className="navigation-player-heading">
        <span>
          <i className={frame.playing || frame.live ? "playing" : ""} />{" "}
          {frame.live ? "LIVE WALK · ESTIMATED" : "ROUTE PREVIEW"}
        </span>
        <button aria-label="Clear route preview" onClick={controls.clear}>
          <X size={14} />
        </button>
      </div>
      <div className="navigation-now">
        <div className="navigation-avatar">
          <PixelPerson variant={avatar} title="Route preview character" />
        </div>
        <div>
          <strong>{frame.firstPerson || frame.live ? cue.text : status}</strong>
          <p>
            {frame.firstPerson || frame.live
              ? cue.detail
              : frame.finished
                ? plan.endLabel
                : leg?.kind === "connector"
                  ? leg.name
                  : plan.floorNames[frame.floorId]}
          </p>
        </div>
        {frame.finished ? (
          <Check size={19} />
        ) : leg?.kind === "connector" ? (
          <ArrowUpDown size={19} />
        ) : (
          <Navigation size={17} />
        )}
      </div>
      <div className="navigation-controls">
        <button
          aria-pressed={frame.firstPerson}
          onClick={controls.walkView}
          disabled={!plan.verified || !plan.complete}
          title={
            !plan.verified
              ? "A verified walkable route is required for first person"
              : "Follow the route through mapped doorways"
          }
          className={frame.firstPerson ? "following" : ""}
        >
          <Navigation size={14} />
          {frame.firstPerson ? "Walk view on" : "First person"}
        </button>
        <button
          className="navigation-play"
          disabled={!plan.distance || !!frame.live}
          onClick={controls.toggle}
          aria-label={
            frame.finished
              ? "Replay route"
              : frame.playing
                ? "Pause route preview"
                : "Play route preview"
          }
        >
          {frame.playing ? <Pause size={14} /> : <Play size={14} />}{" "}
          {frame.finished ? "Replay" : frame.playing ? "Pause" : "Play"}
        </button>
        <button
          title="Restart route preview"
          aria-label="Restart route preview"
          onClick={controls.restart}
          disabled={!!frame.live}
        >
          <RotateCcw size={14} />
        </button>
        <button
          className={frame.follow ? "following" : ""}
          aria-pressed={frame.follow}
          onClick={frame.follow ? controls.explore : controls.follow}
        >
          <LocateFixed size={14} /> {frame.follow ? "Following" : "Follow"}
        </button>
        <select
          aria-label="Route preview speed"
          value={frame.speed}
          disabled={!!frame.live}
          onChange={(e) => controls.store.setSpeed(Number(e.target.value))}
        >
          <option value="1">1×</option>
          <option value="2">2×</option>
          <option value="4">4×</option>
        </select>
      </div>
      <input
        className="navigation-scrubber"
        type="range"
        disabled={!!frame.live}
        min="0"
        max="1000"
        value={Math.round(frame.progress * 1000)}
        aria-label="Route preview progress"
        aria-valuetext={`${Math.round(frame.progress * 100)} percent, ${plan.floorNames[frame.floorId] ?? ""}`}
        onChange={(e) => controls.store.seek(Number(e.target.value) / 1000)}
      />
      <div className="navigation-progress">
        <span>{plan.startLabel}</span>
        <strong>{Math.round(frame.progress * 100)}%</strong>
        <span>{plan.endLabel}</span>
      </div>
      {plan.notice && <p className="navigation-notice">{plan.notice}</p>}
      <details className="live-walk-settings">
        <summary>
          <LocateFixed size={14} /> Live walk with your phone
        </summary>
        {frame.live ? (
          <>
            <p>
              {frame.live.steps} steps · motion estimate · recalibrate often
            </p>
            {frame.live.needsFloorConfirmation && (
              <button
                className="navigation-play"
                onClick={walking.confirmFloor}
              >
                I’ve reached{" "}
                {
                  frame.plan.floorNames[
                    (frame.leg?.kind === "connector"
                      ? frame.leg
                      : frame.plan.legs[frame.legIndex + 1]
                    )?.toFloorId
                  ]
                }
              </button>
            )}
            <button onClick={walking.stop}>Stop live tracking</button>
          </>
        ) : (
          <>
            <p>
              Stand at <strong>{plan.startLabel}</strong>, facing the first
              footprints. Keep your phone pointing ahead while walking.
            </p>
            <label>
              <input
                type="checkbox"
                checked={calibrated === plan}
                onChange={(e) => setCalibrated(e.target.checked ? plan : null)}
              />{" "}
              I’m at the start, phone pointing along the route
            </label>
            <label>
              Step length{" "}
              <select
                aria-label="Walking step length"
                value={walking.stride}
                onChange={(e) => walking.setStride(Number(e.target.value))}
              >
                <option value="0.6">Short · 60 cm</option>
                <option value="0.72">Average · 72 cm</option>
                <option value="0.85">Long · 85 cm</option>
              </select>
            </label>
            <button
              className="navigation-play"
              disabled={
                calibrated !== plan ||
                walking.starting ||
                !plan.complete ||
                !plan.verified
              }
              onClick={() => {
                setCalibrated(null);
                controls.store.play(false);
                void walking.start();
              }}
            >
              {walking.starting
                ? "Connecting sensors…"
                : "Calibrate & start walking"}
            </button>
          </>
        )}
        {walking.status && <p role="status">{walking.status}</p>}
        <small>
          Uses phone motion, not indoor GPS. Position is an estimate; confirm
          floors and recalibrate at known places. Requires a supported phone and
          HTTPS.
        </small>
      </details>
      <span className="navigation-disclaimer">
        {frame.live
          ? "Sensor-driven estimate · keep checking your surroundings"
          : "Preview playback · switch on Live walk to use phone sensors"}
        {leg?.kind === "connector" ? " · illustrative transfer" : ""}
      </span>
    </section>
  );
}
export function RouteReplayButton() {
  const controls = useRoutePlayback(),
    frame = useRouteFrame();
  return (
    <button
      className="subtle-button"
      disabled={!frame.plan.distance || !!frame.live}
      onClick={controls.toggle}
    >
      {frame.playing ? <Pause size={15} /> : <Play size={15} />}{" "}
      {frame.finished
        ? "Replay on map"
        : frame.playing
          ? "Pause route"
          : "Play on map"}
    </button>
  );
}
export function WrittenRoute({ children }: { children: ReactNode }) {
  return (
    <details className="written-route">
      <summary>
        <ChevronDown size={15} /> Written directions
      </summary>
      {children}
    </details>
  );
}

export function RouteExploreButton({
  onClick,
  ...props
}: ComponentProps<"button">) {
  const { store } = useRoutePlayback();
  return (
    <button
      {...props}
      onClick={(e) => {
        store.setFollow(false);
        onClick?.(e);
      }}
    />
  );
}

export function FloorTransferOverlay() {
  const { store } = useRoutePlayback(),
    frame = useRouteFrame();
  if (
    !frame.active ||
    !frame.firstPerson ||
    !frame.follow ||
    frame.leg?.kind !== "connector"
  )
    return null;
  const leg = frame.leg;
  return (
    <div className="floor-transfer-overlay" role="status">
      <ArrowUpDown size={32} />
      <strong>{leg.name}</strong>
      <p>
        Follow this connection to the next floor. The walkthrough continues at
        its landing.
      </p>
      {!frame.live && (
        <button
          className="primary-button"
          onClick={() =>
            store.seek((leg.start + leg.distance + 0.001) / frame.plan.distance)
          }
        >
          Show the next floor
        </button>
      )}
    </div>
  );
}
