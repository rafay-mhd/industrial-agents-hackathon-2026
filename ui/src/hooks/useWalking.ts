import { useCallback, useEffect, useRef, useState } from "react";
import type { PlaybackStore } from "../lib/routePlayback";
import { sampleRoute } from "../lib/routePlayback";
import { StepDetector, advanceWalk, angleDifference } from "../lib/walking";

type PermissionConstructor = { requestPermission?: () => Promise<string> };
export function useWalking(store: PlaybackStore) {
  const [status, setStatus] = useState(""),
    [starting, setStarting] = useState(false),
    [stride, setStride] = useState(0.72);
  const cleanup = useRef<() => void>(() => {}),
    generation = useRef(0);
  const stop = useCallback(() => {
    generation.current++;
    cleanup.current();
    cleanup.current = () => {};
    store.setLive(null);
    setStarting(false);
  }, [store]);
  const plan = store.getFrame().plan;
  useEffect(() => stop, [stop, plan]);
  const start = useCallback(
    async (onReady?: () => void) => {
      stop();
      setStatus("");
      if (!window.isSecureContext) {
        setStatus(
          "Phone sensors need HTTPS. Open this app through a secure connection.",
        );
        return;
      }
      if (!window.DeviceMotionEvent || !window.DeviceOrientationEvent) {
        setStatus(
          "This device has no supported motion sensors. Use route preview or confirm your position on the map.",
        );
        return;
      }
      const f = store.getFrame();
      if (!f.plan.complete || !f.plan.distance || !f.plan.verified) {
        setStatus("Choose a complete route before starting a live walk.");
        return;
      }
      const run = generation.current;
      setStarting(true);
      try {
        // Request both permissions from this user gesture, before any awaited task.
        const permissions = [DeviceMotionEvent, DeviceOrientationEvent].map(
          (type) =>
            (type as unknown as PermissionConstructor).requestPermission?.(),
        );
        const granted = await Promise.all(permissions);
        if (run !== generation.current) return;
        if (granted.some((p) => p && p !== "granted"))
          throw Error(
            "Motion access was denied. You can still use the route preview.",
          );
        const began = performance.now();
        let initial: number | null = null,
          current: number | null = null,
          motion = false,
          ready = false,
          lastMotion = began;
        const startFrame = sampleRoute(f.plan, 0),
          detector = new StepDetector();
        const activate = () => {
          if (ready || initial === null || !motion) return;
          ready = true;
          setStarting(false);
          setStatus(
            "Hold your phone facing the direction you’re walking. Recalibrate if the estimate drifts.",
          );
          store.setFollow(true);
          store.setLive(
            {
              startedAt: Date.now(),
              point: startFrame.point,
              floorId: startFrame.floorId,
              heading: startFrame.heading,
              steps: 0,
              accuracy: 2,
              offRoute: false,
              needsFloorConfirmation: startFrame.leg?.kind === "connector",
            },
            0,
          );
          onReady?.();
        };
        const orientation = (e: DeviceOrientationEvent) => {
          const heading = (
            e as DeviceOrientationEvent & { webkitCompassHeading?: number }
          ).webkitCompassHeading;
          const raw = heading ?? (e.alpha === null ? null : 360 - e.alpha);
          if (raw === null || !Number.isFinite(raw)) return;
          current = (raw * Math.PI) / 180;
          initial ??= current;
          activate();
          const frame = store.getFrame();
          if (frame.live)
            store.setLive(
              {
                ...frame.live,
                heading: startFrame.heading + angleDifference(current, initial),
              },
              frame.distance,
            );
        };
        const move = (e: DeviceMotionEvent) => {
          const a = e.accelerationIncludingGravity;
          if (a?.x == null || a.y == null || a.z == null) return;
          motion = true;
          lastMotion = performance.now();
          activate();
          if (!detector.update(Math.hypot(a.x, a.y, a.z), lastMotion)) return;
          const frame = store.getFrame();
          if (
            !frame.live ||
            frame.live.needsFloorConfirmation ||
            frame.live.accuracy > 8 ||
            document.hidden
          )
            return;
          if (initial === null || current === null) return;
          const live = {
            ...frame.live,
            heading: startFrame.heading + angleDifference(current, initial),
          };
          const advanced = advanceWalk(
            frame.plan,
            live,
            frame.distance,
            stride,
          );
          store.setLive(advanced.live, advanced.distance);
          if (advanced.live.accuracy > 8)
            setStatus(
              "The estimate has drifted. Stop and confirm your location before continuing.",
            );
        };
        const hidden = () => {
          if (document.hidden) {
            stop();
            setStatus(
              "Tracking paused when the app went into the background. Calibrate again to resume.",
            );
          }
        };
        const rotated = () => {
          stop();
          setStatus(
            "Screen orientation changed. Confirm your starting location and recalibrate before continuing.",
          );
        };
        window.screen.orientation?.addEventListener("change", rotated);
        window.addEventListener("deviceorientation", orientation);
        window.addEventListener("devicemotion", move);
        document.addEventListener("visibilitychange", hidden);
        const timeout = window.setInterval(() => {
          if (
            performance.now() - lastMotion > 5000 ||
            (!ready && performance.now() - began > 5000)
          ) {
            stop();
            setStatus(
              "No usable phone sensor data. Try a supported phone over HTTPS; preview remains available.",
            );
          }
        }, 1000);
        cleanup.current = () => {
          window.screen.orientation?.removeEventListener("change", rotated);
          window.removeEventListener("deviceorientation", orientation);
          window.removeEventListener("devicemotion", move);
          document.removeEventListener("visibilitychange", hidden);
          clearInterval(timeout);
        };
      } catch (e) {
        stop();
        setStatus(
          e instanceof Error ? e.message : "Could not start motion tracking.",
        );
      }
    },
    [stop, store, stride],
  );
  const confirmFloor = () => {
    const f = store.getFrame();
    if (!f.live?.needsFloorConfirmation) return;
    const next =
      f.leg?.kind === "connector" ? f.leg : f.plan.legs[f.legIndex + 1];
    if (next?.kind !== "connector") return;
    const distance = next.start + next.distance + 0.001,
      at = sampleRoute(f.plan, distance);
    store.setLive(
      {
        ...f.live,
        point: at.point,
        estimatedPoint: at.point,
        floorId: at.floorId,
        heading: at.heading,
        accuracy: 2,
        offRoute: false,
        needsFloorConfirmation: false,
      },
      distance,
    );
  };
  return { start, stop, status, starting, stride, setStride, confirmFloor };
}
