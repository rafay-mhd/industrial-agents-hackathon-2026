import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRoutePlan,
  createPlaybackStore,
  sampleRoute,
  travelledFloorPath,
} from "../src/lib/routePlayback.ts";
const room = (id, floor, x, y, type = "room") => ({
  id,
  floor_id: floor,
  name: id,
  type,
  polygon: [
    [x - 1, y - 1],
    [x + 1, y - 1],
    [x + 1, y + 1],
    [x - 1, y + 1],
  ],
});
const building = {
  building: { id: "unseen", name: "Unseen" },
  floors: [
    {
      id: "upper",
      level: 7,
      name: "Upper floor",
      elevation_m: 12,
      height_m: 3,
    },
    { id: "lower", level: -2, name: "Basement", elevation_m: -4, height_m: 3 },
  ],
  spaces: [
    room("destination", "upper", 8, 5),
    room("up-stair", "upper", 5, 5, "stairwell"),
    room("start", "lower", 0, 0),
    room("down-stair", "lower", 5, 5, "stairwell"),
  ],
  vertical_connectors: [
    {
      id: "stairs",
      name: "South stairs",
      kind: "stairs",
      floor_ids: ["upper", "lower"],
      space_ids: ["up-stair", "down-stair"],
    },
  ],
};
const route = {
  type: "route",
  length_m: 29,
  steps: [
    "Start in start on Basement.",
    "Use South stairs to Upper floor.",
    "Arrive in destination.",
  ],
  floors: {
    7: [
      [5, 5],
      [8, 5],
    ],
    "-2": [
      [0, 0],
      [5, 0],
      [5, 5],
    ],
  },
};
const location = { floorId: "lower", spaceId: "start", position: [0, 0] };
test("Orders an unseen building from source connections, independent of numeric keys or floor order", () => {
  const original = JSON.stringify(building),
    p = buildRoutePlan(building, route, location);
  assert.equal(p.complete, true);
  assert.deepEqual(
    p.legs.map((l) => [l.kind, l.floorId, l.toFloorId]),
    [
      ["walk", "lower", "lower"],
      ["connector", "lower", "upper"],
      ["walk", "upper", "upper"],
    ],
  );
  assert.deepEqual(p.legs[0].points, [
    [0, -4, -0],
    [5, -4, -0],
    [5, -4, -5],
  ]);
  assert.equal(p.startLabel, "start");
  assert.equal(p.endLabel, "destination");
  assert.equal(p.legs[1].connectorId, "stairs");
  assert.equal(p.legs[1].illustrative, true);
  assert.equal(JSON.stringify(building), original);
});
test("Descending travel reverses the staircase and changes floors at the transfer", () => {
  const down = {
    ...route,
    floors: {
      7: [...route.floors[7]].reverse(),
      "-2": [...route.floors["-2"]].reverse(),
    },
    steps: [
      "Start in destination.",
      "Use South stairs to Basement.",
      "Arrive in start.",
    ],
  };
  const p = buildRoutePlan(building, down, {
    floorId: "upper",
    spaceId: "destination",
    position: [8, 5],
  });
  assert.equal(p.complete, true);
  assert.equal(p.legs[0].floorId, "upper");
  assert.equal(p.legs[1].points[0][1], 12);
  assert.equal(p.legs[1].points.at(-1)[1], -4);
  assert.equal(
    sampleRoute(p, p.legs[1].start + p.legs[1].distance * 0.25).floorId,
    "upper",
  );
  assert.equal(
    sampleRoute(p, p.legs[1].start + p.legs[1].distance * 0.75).floorId,
    "lower",
  );
  assert.deepEqual(sampleRoute(p, p.distance).point, [0, -4, 0]);
});
test("The marker follows exact corners; completed trails never cut diagonally across rooms", () => {
  const p = buildRoutePlan(building, route, location);
  assert.deepEqual(sampleRoute(p, 6).point, [5, -4, -1]);
  const s = createPlaybackStore();
  s.setPlan(p);
  s.seek(6 / p.distance);
  assert.equal(travelledFloorPath(s.getFrame(), "lower"), "M0,0 L5,0 L5,-1");
  assert.equal(travelledFloorPath(s.getFrame(), "upper"), "");
  s.seek(1);
  assert.equal(travelledFloorPath(s.getFrame(), "upper"), "M5,-5 L8,-5");
});
test("Missing or ambiguous connections and outdoor gaps remain partial, with no invented link", () => {
  for (const data of [
    { ...building, vertical_connectors: [] },
    {
      ...building,
      vertical_connectors: [
        ...building.vertical_connectors,
        {
          ...building.vertical_connectors[0],
          id: "another",
          name: "Other stairs",
        },
      ],
    },
  ]) {
    const p = buildRoutePlan(
      data,
      { ...route, steps: ["Start in start.", "Go upstairs."] },
      location,
    );
    assert.equal(p.complete, false);
    assert.equal(p.legs.length, 1);
    assert.match(p.notice, /one floor/);
  }
  const p = buildRoutePlan(
    building,
    { ...route, steps: ["Go outside, then re-enter."] },
    location,
  );
  assert.equal(p.complete, false);
  assert.equal(p.legs.length, 1);
  assert.match(p.notice, /outdoor/);
});
test("Pause/resume, speed, seek and restart preserve a single journey and stop at arrival", () => {
  const s = createPlaybackStore();
  s.setPlan(buildRoutePlan(building, route, location));
  s.play(true);
  s.tick(0.1);
  const initial = s.getFrame().distance;
  assert.ok(Math.abs(initial - 0.28) < 1e-9);
  s.play(false);
  s.tick(0.1);
  assert.equal(s.getFrame().distance, initial);
  s.play(true);
  s.setSpeed(4);
  s.tick(0.1);
  assert.ok(Math.abs(s.getFrame().distance - 0.84) < 1e-9);
  s.seek(0.99);
  for (let i = 0; i < 10; i++) s.tick(0.1);
  assert.equal(s.getFrame().progress, 1);
  assert.equal(s.getFrame().playing, false);
  assert.equal(s.getFrame().finished, true);
  s.tick(100);
  assert.equal(s.getFrame().progress, 1);
  s.seek(0.25);
  s.play(true);
  assert.equal(s.getFrame().finished, false);
  assert.equal(s.getFrame().playing, true);
  s.setFollow(false);
  s.restart();
  assert.equal(s.getFrame().distance, 0);
  assert.equal(s.getFrame().follow, true);
  s.setPlan(buildRoutePlan(null, null, null));
  assert.equal(s.getFrame().active, false);
  assert.equal(s.getFrame().playing, false);
});
test("Same-floor, stationary and empty routes require no connector and remain finite", () => {
  const p = buildRoutePlan(
    building,
    {
      ...route,
      floors: {
        7: [
          [5, 5],
          [8, 5],
        ],
      },
    },
    null,
  );
  assert.equal(p.complete, true);
  assert.equal(p.legs.length, 1);
  assert.equal(p.distance, 3);
  const s = createPlaybackStore();
  s.setPlan(
    buildRoutePlan(building, { ...route, floors: { 7: [[5, 5]] } }, null),
  );
  s.play(true);
  assert.equal(s.getFrame().playing, false);
  assert.equal(s.getFrame().finished, true);
  assert.ok(s.getFrame().point.every(Number.isFinite));
  assert.equal(
    buildRoutePlan(building, { ...route, floors: {} }, null).legs.length,
    0,
  );
});

test("Invalid coordinates do not get removed and joined across a missing section", () => {
  const p = buildRoutePlan(
    building,
    {
      ...route,
      floors: {
        ...route.floors,
        7: [
          [5, 5],
          [NaN, 6],
          [8, 5],
        ],
      },
    },
    location,
  );
  assert.equal(p.complete, false);
  assert.equal(p.legs.length, 1);
  assert.equal(p.legs[0].floorId, "lower");
  assert.match(p.notice, /coordinates/);
});
