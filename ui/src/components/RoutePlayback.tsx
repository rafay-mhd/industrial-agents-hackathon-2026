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

export function RoutePlaybackProvider({
  data,
  route,
  location,
  playing,
  setPlaying,
  onFloorChange,
  onBegin,
  onClear,
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
  children: ReactNode;
}) {
  const [store] = useState(createPlaybackStore);
  const callbacks = useRef({ onFloorChange, onBegin, onClear, setPlaying });
  useEffect(() => {
    callbacks.current = { onFloorChange, onBegin, onClear, setPlaying };
  }, [onFloorChange, onBegin, onClear, setPlaying]);
  const plan = useMemo(
    () => buildRoutePlan(data, route, location),
    [data, route, location],
  );
  useEffect(() => {
    store.setPlan(plan);
    if (plan.legs.length) {
      callbacks.current.onBegin();
      callbacks.current.onFloorChange(store.getFrame().floorId);
    }
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) store.setFollow(false);
    // Synchronise the external animation clock with a newly received route.
    callbacks.current.setPlaying(plan.distance > 0 && !reduced);
  }, [store, plan]);
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
      toggle() {
        const f = store.getFrame();
        if (f.finished) {
          store.restart();
          callbacks.current.onBegin();
          callbacks.current.setPlaying(true);
        } else {
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
      className="navigation-player"
      data-follow={frame.follow}
      aria-label="Visual route player"
    >
      <div className="navigation-player-heading">
        <span>
          <i className={frame.playing ? "playing" : ""} /> ROUTE PREVIEW
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
          <strong>{status}</strong>
          <p>
            {frame.finished
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
          {frame.playing ? <Pause size={14} /> : <Play size={14} />}{" "}
          {frame.finished ? "Replay" : frame.playing ? "Pause" : "Play"}
        </button>
        <button
          title="Restart route preview"
          aria-label="Restart route preview"
          onClick={controls.restart}
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
        Simulated journey · no live position tracking
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
      disabled={!frame.plan.distance}
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
