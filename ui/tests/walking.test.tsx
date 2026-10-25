// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { useWalking } from "../src/hooks/useWalking";
import { buildRoutePlan, createPlaybackStore } from "../src/lib/routePlayback";
import type { BuildingData } from "../src/types";
let hook: ReturnType<typeof useWalking>,
  root: Root,
  host: HTMLDivElement,
  store: ReturnType<typeof createPlaybackStore>;
const permission = vi.fn(async () => "granted");
class Sensor extends Event {
  static requestPermission = permission;
}
function Harness() {
  const value = useWalking(store);
  useEffect(() => {
    hook = value;
  });
  return null;
}
function sensor(name: string, data: object) {
  window.dispatchEvent(Object.assign(new Event(name), data));
}
beforeEach(async () => {
  vi.useFakeTimers();
  permission.mockResolvedValue("granted");
  permission.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("DeviceMotionEvent", Sensor);
  vi.stubGlobal("DeviceOrientationEvent", Sensor);
  store = createPlaybackStore();
  const building = {
    building: { id: "new", name: "New" },
    floors: [{ id: "f", level: 0, name: "Ground", elevation_m: 0 }],
    spaces: [
      {
        id: "hall",
        floor_id: "f",
        type: "hall",
        name: "Hall",
        polygon: [
          [-1, -1],
          [11, -1],
          [11, 1],
          [-1, 1],
        ],
      },
    ],
    vertical_connectors: [],
    openings: [],
    assets: [],
  } as unknown as BuildingData;
  store.setPlan(
    buildRoutePlan(
      building,
      {
        type: "route",
        geometry_valid: true,
        steps: [],
        floors: {
          0: [
            [0, 0],
            [10, 0],
          ],
        },
      },
      null,
    ),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<Harness />);
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
test("Live calibration waits for both sensors, does not move on heading updates, and stops on sensor loss", async () => {
  await act(async () => {
    await hook.start();
  });
  expect(store.getFrame().live).toBeNull();
  await act(async () => {
    sensor("deviceorientation", { alpha: 0 });
  });
  expect(store.getFrame().live).toBeNull();
  await act(async () => {
    sensor("devicemotion", {
      accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
    });
  });
  expect(store.getFrame().live?.steps).toBe(0);
  const point = store.getFrame().point;
  await act(async () => {
    sensor("deviceorientation", { alpha: 270 });
  });
  expect(store.getFrame().point).toEqual(point);
  expect(store.getFrame().live?.heading).toBeCloseTo(Math.PI);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(store.getFrame().live).toBeNull();
  expect(hook.status).toContain("No usable phone sensor data");
});
test("Denied sensor permission never starts tracking and leaves route preview available", async () => {
  permission.mockResolvedValue("denied");
  await act(async () => {
    await hook.start();
  });
  expect(store.getFrame().live).toBeNull();
  expect(hook.status).toContain("denied");
  expect(store.getFrame().plan.complete).toBe(true);
});

test("First-person live position responds to sensed steps and heading, never elapsed animation time", async () => {
  await act(async () => {
    await hook.start(() => store.setFirstPerson(true));
  });
  await act(async () => {
    sensor("deviceorientation", { alpha: 0 });
    sensor("devicemotion", {
      accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
    });
  });
  expect(store.getFrame().firstPerson).toBe(true);
  const initial = store.getFrame().point;
  const began = store.getFrame().live?.startedAt;
  expect(began).toBeGreaterThan(0);
  store.play(true);
  store.tick(20);
  expect(store.getFrame().distance).toBe(0);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
    sensor("devicemotion", {
      accelerationIncludingGravity: { x: 0, y: 0, z: 12 },
    });
    sensor("devicemotion", {
      accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
    });
  });
  expect(store.getFrame().live?.steps).toBe(1);
  expect(store.getFrame().distance).toBeGreaterThan(0);
  expect(store.getFrame().point).not.toEqual(initial);
  const moved = store.getFrame().point;
  await act(async () => sensor("deviceorientation", { alpha: 270 }));
  expect(store.getFrame().point).toEqual(moved);
  expect(store.getFrame().heading).toBeCloseTo(Math.PI);
  store.tick(20);
  expect(store.getFrame().point).toEqual(moved);
});
