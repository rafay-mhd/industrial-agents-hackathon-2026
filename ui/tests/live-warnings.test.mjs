import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMapActions, emptyMapState } from "../src/lib/model.ts";
import { warningPins } from "../src/lib/liveWarnings.ts";
const route = {
  type: "route",
  length_m: 12,
  steps: [],
  floors: {
    0: [
      [0, 0],
      [4, 0],
    ],
  },
  element_ids: ["lift"],
};
const building = {
  building: {
    id: "unseen",
    name: "Unseen",
    closed_element_ids: ["lift"],
    live_warnings: [
      { id: "one", element_id: "lift", status: "active", blocks_route: true },
    ],
  },
  floors: [
    { id: "g", level: 0 },
    { id: "u", level: 1 },
  ],
  spaces: [
    {
      id: "bottom",
      floor_id: "g",
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    },
    {
      id: "top",
      floor_id: "u",
      polygon: [
        [8, 8],
        [10, 8],
        [10, 10],
        [8, 10],
      ],
    },
  ],
  vertical_connectors: [{ id: "lift", space_ids: ["bottom", "top"] }],
};
test("Unrelated warning preserves route identity and geometry cache inputs", () => {
  const old = { ...emptyMapState, route };
  const next = applyMapActions(old, [
    {
      type: "building_state",
      building,
      preserve_route: true,
      geometry_changed: false,
    },
  ]);
  assert.equal(next.route, route);
  assert.equal(next.doors, old.doors);
  assert.deepEqual([...next.closed], ["lift"]);
});
test("Changed route retains a clearly separate old path for optional comparison", () => {
  const nextRoute = { ...route, length_m: 21, element_ids: ["stairs"] };
  const next = applyMapActions({ ...emptyMapState, route }, [
    { type: "building_state", building, preserve_route: false },
    { type: "route_update", changed: true },
    nextRoute,
  ]);
  assert.equal(next.previousRoute, route);
  assert.equal(next.route, nextRoute);
  assert.equal(next.comparePrevious, false);
  const paused = applyMapActions(
    { ...emptyMapState, route: null, previousRoute: route },
    [
      { type: "building_state", building, preserve_route: false },
      { type: "route_unavailable", reason: "No step-free route" },
      { type: "route_update", changed: true },
    ],
  );
  assert.equal(paused.route, null);
  assert.equal(paused.previousRoute, route);
});
test("Lift warning pins use the actual landing on each floor, aggregate duplicates and omit resolved reports", () => {
  const twice = {
    ...building,
    building: {
      ...building.building,
      live_warnings: [
        ...building.building.live_warnings,
        { id: "two", element_id: "lift", status: "active" },
        { id: "three", element_id: "lift", status: "resolved" },
      ],
    },
  };
  assert.deepEqual(warningPins(twice, "g")[0].point, [1, 1]);
  assert.deepEqual(warningPins(twice, "u")[0].point, [9, 9]);
  assert.equal(warningPins(twice, "u")[0].warnings.length, 2);
  assert.deepEqual(warningPins(twice, "unknown"), []);
});
