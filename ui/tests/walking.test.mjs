import test from "node:test";
import assert from "node:assert/strict";
import {
  StepDetector,
  advanceWalk,
  footprintTrail,
  projectWalk,
  walkingCue,
} from "../src/lib/walking.ts";
import {
  buildRoutePlan,
  createPlaybackStore,
  travelledFloorPath,
} from "../src/lib/routePlayback.ts";
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
        [-2, -2],
        [12, -2],
        [12, 12],
        [-2, 12],
      ],
    },
  ],
  vertical_connectors: [],
  openings: [],
  assets: [],
};
const plan = buildRoutePlan(
  building,
  {
    type: "route",
    steps: ["Follow the hall."],
    floors: {
      0: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    },
  },
  null,
);
const live = {
  point: [0, 0, 0],
  floorId: "f",
  heading: Math.PI / 2,
  accuracy: 2,
  steps: 0,
  offRoute: false,
  needsFloorConfirmation: false,
};
test("Stationary noise does not advance a live walk; one sustained peak counts once", () => {
  const detector = new StepDetector();
  let count = 0;
  for (let t = 0; t < 5000; t += 20)
    count += +detector.update(9.81 + Math.sin(t) * 0.08, t);
  assert.equal(count, 0);
  for (let t = 5000; t < 5300; t += 20) count += +detector.update(12, t);
  assert.equal(count, 1);
  for (let t = 5300; t < 5700; t += 20) detector.update(9.5, t);
  assert.equal(detector.update(12, 5700), true);
  assert.equal(detector.update(Infinity, 5800), false);
});
test("A calibrated step updates position and route progress; walking away stops progress", () => {
  const next = advanceWalk(plan, live, 0, 0.72);
  assert.equal(next.live.steps, 1);
  assert.ok(Math.abs(next.distance - 0.72) < 1e-8);
  const wrong = advanceWalk(
    plan,
    { ...live, point: [0, 0, 5], heading: 0 },
    0,
    0.72,
  );
  assert.equal(wrong.live.offRoute, true);
  assert.equal(wrong.distance, 0);
  assert.equal(projectWalk(plan, [100, 0, 100], "unknown", 2).error, Infinity);
});
test("Live progress cannot advance on an animation timer or start a simulated walk", () => {
  const store = createPlaybackStore();
  store.setPlan(plan);
  store.setLive(live, 0);
  store.play(true);
  store.tick(100);
  assert.equal(store.getFrame().distance, 0);
  assert.equal(store.getFrame().playing, false);
  store.setLive({ ...live, point: [0.72, 0, 0], steps: 1 }, 0.72);
  assert.equal(store.getFrame().distance, 0.72);
});
test("Footprints alternate feet and follow turns; directions come from geometry", () => {
  const feet = footprintTrail(plan);
  assert.ok(feet.length > 20);
  assert.notEqual(feet[0].side, feet[1].side);
  assert.ok(feet.at(-1).point[2] < -8);
  const store = createPlaybackStore();
  store.setPlan(plan);
  assert.match(walkingCue(store.getFrame()).text, /10 m, turn left/);
});
test("Progress on repeated floors preserves separate paths without fictitious connecting lines", () => {
  const second = {
    ...plan.legs[0],
    start: 20,
    distance: 5,
    points: [
      [30, 0, 0],
      [35, 0, 0],
    ],
  };
  const frame = {
    plan: { ...plan, legs: [plan.legs[0], second] },
    distance: 23,
  };
  assert.match(travelledFloorPath(frame, "f"), /M30,0 L33,0/);
  assert.equal((travelledFloorPath(frame, "f").match(/M/g) || []).length, 2);
});

test("A step reaching a floor transfer stops before it and requires an explicit floor confirmation", () => {
  const walk = {
    ...plan.legs[0],
    points: [
      [0, 0, 0],
      [10, 0, 0],
    ],
    distance: 10,
  };
  const connector = {
    kind: "connector",
    floorId: "f",
    toFloorId: "upper",
    name: "Lift",
    start: 10,
    distance: 3,
    points: [
      [10, 0, 0],
      [10, 3, 0],
    ],
  };
  const multi = { ...plan, legs: [walk, connector], distance: 13 };
  const next = advanceWalk(multi, { ...live, point: [9.6, 0, 0] }, 9.6, 0.72);
  assert.equal(next.live.needsFloorConfirmation, true);
  assert.ok(next.distance < 10);
  assert.equal(next.live.floorId, "f");
  assert.equal(next.live.point[1], 0);
  const store = createPlaybackStore();
  store.setPlan(multi);
  store.setLive(next.live, next.distance);
  assert.match(walkingCue(store.getFrame()).text, /Lift/);
});

test("Small sensor drift displays a point on the verified path; accumulated drift stops without crossing walls", () => {
  const diagonal = { ...live, heading: Math.PI / 2 + 0.45 };
  let result = advanceWalk(plan, diagonal, 0, 0.72);
  assert.equal(result.live.point[2], 0);
  assert.notEqual(result.live.estimatedPoint[2], 0);
  for (let i = 0; i < 8 && !result.live.offRoute; i++) {
    const previous = result;
    result = advanceWalk(plan, result.live, result.distance, 0.72);
    if (result.live.offRoute) {
      assert.deepEqual(result.live.point, previous.live.point);
      assert.equal(result.distance, previous.distance);
    }
  }
  assert.equal(result.live.offRoute, true);
});

test("Animated directions show a turn-now cue, then the next leg; incomplete paths do not claim arrival", () => {
  const store = createPlaybackStore();
  store.setPlan(plan);
  store.seek(9.5 / plan.distance);
  assert.equal(walkingCue(store.getFrame()).text, "Turn left now");
  assert.equal(walkingCue(store.getFrame()).turn, "left");
  store.seek(11 / plan.distance);
  assert.match(walkingCue(store.getFrame()).text, /Continue for/);
  store.seek(1);
  assert.equal(walkingCue(store.getFrame()).text, "You’ve arrived");
  store.setPlan({ ...plan, complete: false, notice: "A walkway is missing." });
  store.seek(1);
  assert.equal(walkingCue(store.getFrame()).text, "End of mapped route");
  assert.equal(walkingCue(store.getFrame()).turn, "stop");
});

test("Turn distances count down with playback, freeze on pause and reset on replay", () => {
  const store = createPlaybackStore();
  store.setPlan(plan);
  assert.equal(walkingCue(store.getFrame()).metres, 10);
  store.seek(6 / plan.distance);
  assert.equal(walkingCue(store.getFrame()).metres, 4);
  assert.equal(walkingCue(store.getFrame()).turn, "left");
  const paused = walkingCue(store.getFrame());
  store.tick(0.1);
  assert.deepEqual(walkingCue(store.getFrame()), paused);
  store.seek(9.5 / plan.distance);
  assert.equal(walkingCue(store.getFrame()).metres, 0);
  assert.equal(walkingCue(store.getFrame()).instruction, "turn left now");
  store.seek(11 / plan.distance);
  assert.equal(walkingCue(store.getFrame()).metres, 9);
  assert.equal(walkingCue(store.getFrame()).turn, "straight");
  store.seek(1);
  assert.equal(walkingCue(store.getFrame()).turn, "arrive");
  assert.equal(walkingCue(store.getFrame()).metres, undefined);
  store.restart();
  assert.equal(walkingCue(store.getFrame()).metres, 10);
});
