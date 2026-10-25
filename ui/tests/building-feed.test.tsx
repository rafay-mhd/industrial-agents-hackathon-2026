// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { useBuildingFeed } from "../src/hooks/useBuildingFeed";
import {
  RoutePlaybackProvider,
  RoutePlayer,
  AssistantDirections,
  RouteDistanceSummary,
} from "../src/components/RoutePlayback";
import { useRoutePlayback } from "../src/lib/routePlaybackContext";
import type { BuildingData, RouteAction } from "../src/types";
vi.mock("../src/lib/api", () => ({
  API: "/api",
  request: (...args: unknown[]) => fetchMock(...args),
}));
const fetchMock = vi.fn();
class Stream extends EventTarget {
  static all: Stream[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    super();
    Stream.all.push(this);
  }
  send(revision: number) {
    this.dispatchEvent(
      new MessageEvent("building-update", {
        data: JSON.stringify({ revision, closed: ["lift"] }),
      }),
    );
  }
}
let root: Root, host: HTMLDivElement;
let options: Parameters<typeof useBuildingFeed>[0];
function Harness() {
  useBuildingFeed(options);
  return null;
}
async function render() {
  await act(async () => root.render(<Harness />));
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("EventSource", Stream);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  Stream.all = [];
  fetchMock.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  options = {
    buildingId: "new-building",
    enabled: true,
    revision: 0,
    session: { current: "alice" },
    busy: { current: false },
    trip: { current: null },
    setBusy: vi.fn(),
    onActions: vi.fn(),
    onEvent: vi.fn(),
    onError: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function state(revision: number) {
  return {
    actions: [
      {
        type: "building_state",
        building: { building: { revision } },
        preserve_route: true,
        geometry_changed: false,
      },
    ],
  };
}
test("Busy agent queues sync but immediately reports the closure; newer revisions coalesce", async () => {
  options.busy.current = true;
  await render();
  await act(async () => {
    Stream.all[0].send(1);
    Stream.all[0].send(2);
  });
  expect(options.onEvent).toHaveBeenCalledTimes(2);
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockResolvedValue(state(2));
  options.busy.current = false;
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(options.onActions).toHaveBeenCalledWith(state(2).actions);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
test("Sync newer than the triggering event does not create a repeated request loop", async () => {
  fetchMock.mockResolvedValue(state(3));
  await render();
  await act(async () => Stream.all[0].send(1));
  await act(async () => vi.advanceTimersByTimeAsync(1500));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  options = { ...options, revision: 3 };
  await render();
  await act(async () => Stream.all[0].send(2));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
test("Late response from the previous building is discarded and its connection is closed", async () => {
  let resolve!: (v: unknown) => void;
  fetchMock.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await render();
  await act(async () => Stream.all[0].send(1));
  options = {
    ...options,
    buildingId: "other",
    session: { current: "bob" },
    busy: { current: false },
  };
  await render();
  expect(Stream.all[0].close).toHaveBeenCalledOnce();
  await act(async () => resolve(state(1)));
  expect(options.onActions).not.toHaveBeenCalled();
});
test("Polling recovers missed stream events and sends the saved trip for server restart recovery", async () => {
  options.trip.current = {
    start: "A",
    destination: "B",
    via: ["C"],
    step_free: true,
  };
  await render();
  fetchMock.mockImplementation(async (path: string) =>
    path.endsWith("/changes") ? { revision: 2, closed: ["lift"] } : state(2),
  );
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  const call = fetchMock.mock.calls.find((c) =>
    (c[0] as string).endsWith("/sync"),
  );
  expect(JSON.parse(call![1].body).planned_trip).toMatchObject({
    start: "A",
    destination: "B",
    via: ["C"],
    step_free: true,
  });
});
test("Metadata-only update preserves playback progress, camera follow and the active plan", async () => {
  const data = {
    building: { id: "new", name: "New", source: "test" },
    floors: [{ id: "g", level: 0, name: "Ground", elevation_m: 0 }],
    spaces: [
      {
        id: "hall",
        floor_id: "g",
        name: "Hall",
        type: "hall",
        ref: "H",
        polygon: [
          [0, 0],
          [20, 0],
          [20, 4],
          [0, 4],
        ],
      },
    ],
    openings: [],
    vertical_connectors: [],
    assets: [],
  } as BuildingData;
  const route = {
    type: "route",
    geometry_valid: true,
    length_m: 10,
    steps: [],
    floors: {
      0: [
        [1, 2],
        [11, 2],
      ],
    },
  } as RouteAction;
  let store!: ReturnType<typeof useRoutePlayback>["store"];
  function Probe() {
    const value = useRoutePlayback();
    useEffect(() => {
      store = value.store;
    });
    return null;
  }
  const noop = () => {};
  const draw = (building: BuildingData, routeValue = route) => (
    <RoutePlaybackProvider
      data={building}
      route={routeValue}
      location={null}
      playing={false}
      setPlaying={noop}
      onFloorChange={noop}
      onBegin={noop}
      onClear={noop}
      onWalkView={noop}
    >
      <Probe />
    </RoutePlaybackProvider>
  );
  await act(async () => root.render(draw(data)));
  const plan = store.getFrame().plan;
  store.setFollow(true);
  store.play(true);
  store.tick(2);
  const distance = store.getFrame().distance;
  await act(async () =>
    root.render(draw({ ...data, building: { ...data.building, revision: 1 } })),
  );
  expect(store.getFrame().plan).toBe(plan);
  expect(store.getFrame().distance).toBe(distance);
  expect(store.getFrame().follow).toBe(true);
  await act(async () => root.render(draw(data, { ...route, length_m: 11 })));
  expect(store.getFrame().distance).toBe(0);
  expect(store.getFrame().follow).toBe(false);
});

test("Own mutation acknowledgment prevents a duplicate event response from replacing its route notice", async () => {
  const applied = { current: 0 };
  options.appliedRevision = applied;
  let resolve!: (v: unknown) => void;
  fetchMock.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await render();
  await act(async () => Stream.all[0].send(1));
  applied.current = 1;
  await act(async () => resolve(state(1)));
  expect(options.onActions).not.toHaveBeenCalled();
  await act(async () => Stream.all[0].send(1));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("First-person selection starts the animated walkthrough; pause and replay still work", async () => {
  const data = {
    building: { id: "new", name: "New", source: "test" },
    floors: [{ id: "g", level: 0, name: "Ground", elevation_m: 0 }],
    spaces: [
      {
        id: "hall",
        floor_id: "g",
        name: "Hall",
        type: "hall",
        ref: "H",
        polygon: [
          [0, 0],
          [20, 0],
          [20, 4],
          [0, 4],
        ],
      },
    ],
  } as BuildingData;
  const route = {
    type: "route",
    geometry_valid: true,
    length_m: 10,
    steps: [],
    floors: {
      0: [
        [1, 2],
        [11, 2],
      ],
    },
  } as RouteAction;
  let controls!: ReturnType<typeof useRoutePlayback>;
  function Probe() {
    const value = useRoutePlayback();
    useEffect(() => {
      controls = value;
    });
    return null;
  }
  const noop = () => {};
  await act(async () =>
    root.render(
      <RoutePlaybackProvider
        data={data}
        route={route}
        location={null}
        playing={false}
        setPlaying={noop}
        onFloorChange={noop}
        onBegin={noop}
        onClear={noop}
        onWalkView={noop}
      >
        <Probe />
        <RoutePlayer avatar={0} />
        <AssistantDirections />
        <RouteDistanceSummary fullRouteMetres={10} />
      </RoutePlaybackProvider>,
    ),
  );
  expect(host.textContent).toContain("Continue straight");
  expect(
    host.querySelector('[aria-label="Remaining walking distance"]')
      ?.textContent,
  ).toContain("10walking metres remaining");
  expect(host.textContent).not.toMatch(
    /Phone walking|Calibrate|Check laptop location/,
  );
  expect(
    host.querySelector('[aria-label="Play route preview"]'),
  ).not.toBeNull();
  await act(async () => controls.walkView());
  expect(
    host.querySelector('[aria-label="Current direction"]')?.textContent,
  ).toContain("Continue straight");
  expect(controls.store.getFrame().firstPerson).toBe(true);
  expect(controls.store.getFrame().playing).toBe(true);
  await act(async () => controls.store.tick(0.1));
  const distance = controls.store.getFrame().distance;
  expect(distance).toBeGreaterThan(0);
  await act(async () => controls.toggle());
  await act(async () => controls.store.tick(0.1));
  expect(controls.store.getFrame().distance).toBe(distance);
  await act(async () => controls.store.seek(0.4));
  expect(
    host.querySelector('[aria-label="Remaining walking distance"]')
      ?.textContent,
  ).toContain("6walking metres remaining");
  expect(
    host.querySelector('[aria-label="Current route directions"]')?.textContent,
  ).toContain("6 m");
  expect(
    host.querySelector('[aria-label="Journey estimate"]')?.textContent,
  ).toContain("6 m");
  await act(async () => controls.store.seek(1));
  expect(
    host.querySelector('[aria-label="Current route directions"]')?.textContent,
  ).toContain("You’ve arrived");
  expect(
    host.querySelector('[aria-label="Remaining walking distance"]')
      ?.textContent,
  ).toContain("0walking metres remaining");
  await act(async () => controls.restart());
  expect(controls.store.getFrame().distance).toBe(0);
  expect(controls.store.getFrame().firstPerson).toBe(true);
  expect(controls.store.getFrame().playing).toBe(true);
});
