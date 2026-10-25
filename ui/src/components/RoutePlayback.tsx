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
  CornerUpLeft,
  CornerUpRight,
  ArrowUp,
  TriangleAlert,
  Undo2,
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
import { walkingCue } from "../lib/walking";
import type { WalkingCue } from "../lib/walking";
import { journeyEstimate, durationLabel } from "../lib/journey";

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
        const entering = !frame.firstPerson;
        if (entering) {
          if (frame.finished) store.restart();
          else store.play(true);
          callbacks.current.setPlaying(true);
          callbacks.current.onBegin();
          callbacks.current.onWalkView();
        }
        store.setFirstPerson(entering);
        store.setFollow(true);
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
function DirectionCue({ cue }: { cue: WalkingCue }) {
  const Turn =
    cue.turn === "stop"
      ? TriangleAlert
      : cue.turn === "left"
        ? CornerUpLeft
        : cue.turn === "right"
          ? CornerUpRight
          : cue.turn === "around"
            ? Undo2
            : cue.turn === "floor"
              ? ArrowUpDown
              : cue.turn === "arrive"
                ? Check
                : ArrowUp;
  return (
    <div className="navigation-now" aria-label="Current direction">
      <div className="navigation-avatar">
        <Turn size={36} aria-hidden="true" />
      </div>
      <div className="navigation-instruction">
        {cue.metres !== undefined && cue.metres > 0 && (
          <span className="turn-distance">
            {cue.metres}
            <small>m</small>
          </span>
        )}
        <strong>{cue.instruction ?? cue.text}</strong>
        <p>{cue.detail}</p>
      </div>
    </div>
  );
}

export function RouteDistanceSummary({
  fullRouteMetres,
}: {
  fullRouteMetres: number;
}) {
  const frame = useRouteFrame();
  const estimate = frame.active
    ? journeyEstimate(frame.plan, frame.distance)
    : null;
  return (
    <>
      <h3
        className="route-distance-live"
        aria-label="Remaining walking distance"
      >
        {estimate?.metres ??
          fullRouteMetres.toLocaleString(undefined, {
            maximumFractionDigits: 1,
          })}
        <span>
          {estimate ? "walking metres remaining" : "metres on your route"}
        </span>
      </h3>
      <p className="route-distance-total">
        Planned route ·{" "}
        {fullRouteMetres.toLocaleString(undefined, {
          maximumFractionDigits: 1,
        })}{" "}
        m
      </p>
    </>
  );
}

export function AssistantDirections() {
  const frame = useRouteFrame(),
    controls = useRoutePlayback();
  if (!frame.active) return null;
  const estimate = journeyEstimate(frame.plan, frame.distance);
  return (
    <section
      className="assistant-directions"
      aria-label="Current route directions"
    >
      <span className="eyebrow">
        {frame.finished ? "WALKTHROUGH COMPLETE" : "YOUR NEXT DIRECTION"}
      </span>
      <DirectionCue cue={walkingCue(frame)} />
      <div className="assistant-journey">
        <span>
          <strong>{estimate.metres} m</strong> remaining
          {estimate.transfers
            ? ` · ${estimate.transfers} floor transfer${estimate.transfers > 1 ? "s" : ""}`
            : ""}
        </span>
        <span>
          {estimate.seconds ? `~${durationLabel(estimate.seconds)}` : "0 sec"}
        </span>
      </div>
      <button className="assistant-route-play" onClick={controls.toggle}>
        {frame.playing ? <Pause size={15} /> : <Play size={15} />}
        {frame.playing
          ? "Pause walkthrough"
          : frame.finished
            ? "Replay walkthrough"
            : "Play walkthrough"}
      </button>
    </section>
  );
}

export function RoutePlayer(_props: { avatar: number }) {
  const controls = useRoutePlayback(),
    frame = useRouteFrame();
  const cue = walkingCue(frame);
  if (!frame.active) return null;
  const { plan } = frame;
  const estimate = journeyEstimate(plan, frame.distance);
  return (
    <section
      className={`navigation-player ${frame.firstPerson && frame.follow ? "is-first-person" : ""}`}
      data-follow={frame.follow}
      aria-label="Visual route player"
    >
      <div className="navigation-player-heading">
        <span>
          <i className={frame.playing ? "playing" : ""} />
          ROUTE WALKTHROUGH ·{" "}
          {frame.finished ? "COMPLETE" : frame.playing ? "PLAYING" : "PAUSED"}
        </span>
        <button aria-label="Clear route preview" onClick={controls.clear}>
          <X size={14} />
        </button>
      </div>
      <DirectionCue cue={cue} />
      <div
        className="journey-metrics walkthrough-metrics"
        aria-label="Journey estimate"
      >
        <div>
          <strong>{estimate.metres} m</strong>
          <small>
            walking remaining
            {estimate.transfers
              ? ` + ${estimate.transfers} floor transfer${estimate.transfers > 1 ? "s" : ""}`
              : ""}
          </small>
        </div>
        <div>
          <strong>
            {estimate.seconds
              ? `~${durationLabel(estimate.seconds)}`
              : "Complete"}
          </strong>
          <small>estimated walking time</small>
        </div>
      </div>
      <div className="navigation-controls">
        <button
          className="navigation-play"
          disabled={!plan.distance}
          onClick={controls.toggle}
          aria-label={
            frame.finished
              ? "Replay route"
              : frame.playing
                ? "Pause route preview"
                : "Play route preview"
          }
        >
          {frame.playing ? <Pause size={16} /> : <Play size={16} />}
          {frame.finished ? "Replay" : frame.playing ? "Pause" : "Play route"}
        </button>
        <button
          title="Restart route preview"
          aria-label="Restart route preview"
          onClick={controls.restart}
          disabled={!plan.distance}
        >
          <RotateCcw size={15} />
        </button>
        <select
          aria-label="Route preview speed"
          value={frame.speed}
          onChange={(e) => controls.store.setSpeed(Number(e.target.value))}
        >
          <option value="1">1×</option>
          <option value="2">2×</option>
          <option value="4">4×</option>
        </select>
      </div>
      <div className="navigation-controls walkthrough-view-controls">
        <button
          aria-pressed={frame.firstPerson}
          onClick={controls.walkView}
          disabled={!plan.verified || !plan.complete}
          title={
            !plan.verified
              ? "A verified walkable route is required for first person"
              : "Play the route from eye level"
          }
          className={frame.firstPerson ? "following" : ""}
        >
          <Navigation size={15} />
          {frame.firstPerson ? "First person on" : "First person"}
        </button>
        <button
          className={frame.follow ? "following" : ""}
          aria-pressed={frame.follow}
          onClick={frame.follow ? controls.explore : controls.follow}
        >
          <LocateFixed size={14} />
          {frame.follow ? "Following" : "Follow"}
        </button>
      </div>
      <input
        className="navigation-scrubber"
        type="range"
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
      <span className="navigation-disclaimer">
        Animated route preview · follows mapped doors, stairs and lifts.
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
    <details className="written-route" open>
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
