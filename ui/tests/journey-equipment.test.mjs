import { test } from "node:test";
import assert from "node:assert/strict";
import {
  journeyEstimate,
  elapsedLabel,
  durationLabel,
} from "../src/lib/journey.ts";
import { placeChoices, nearestChoices } from "../src/lib/placeSearch.ts";
import { warningPins } from "../src/lib/liveWarnings.ts";
const building = {
  building: {
    live_warnings: [
      { id: "w", element_id: "p", status: "active", asset_unavailable: true },
    ],
  },
  floors: [{ id: "f", name: "Floor 2" }],
  spaces: [
    {
      id: "lab",
      name: "Workshop",
      ref: "2.3",
      floor_id: "f",
      polygon: [
        [0, 0],
        [5, 0],
        [5, 5],
        [0, 5],
      ],
    },
  ],
  assets: [
    {
      id: "p",
      name: "3D printer",
      type: "printer_3d",
      space_id: "lab",
      floor_id: "f",
      position: [2, 3],
    },
    {
      id: "c",
      name: "Coffee machine",
      type: "coffee_machine",
      space_id: "lab",
      floor_id: "f",
      position: [1, 1],
    },
  ],
};
test("Object search includes equipment, outage status and nearest-by-type suggestions", () => {
  const printer = placeChoices(building).find((s) => s.id === "p");
  assert.equal(printer.unavailable, true);
  assert.match(printer.detail, /Workshop/);
  assert.equal(
    nearestChoices(building, "closest coffe machine")[0].id,
    "nearest:coffee_machine",
  );
  assert.equal(
    nearestChoices(building, "3d printer")[0].id,
    "nearest:printer_3d",
  );
  assert.deepEqual(nearestChoices(building, "unknown telescope"), []);
  assert.deepEqual(warningPins(building, "f")[0].point, [2, 3]);
});
const plan = {
  legs: [
    {
      kind: "walk",
      start: 0,
      distance: 12,
      points: [
        [0, 0, 0],
        [12, 0, 0],
      ],
    },
    {
      kind: "connector",
      connectorKind: "lift",
      start: 12,
      distance: 4,
      points: [
        [12, 0, 0],
        [12, 4, 0],
      ],
    },
    {
      kind: "walk",
      start: 16,
      distance: 6,
      points: [
        [12, 4, 0],
        [18, 4, 0],
      ],
    },
  ],
};
test("Journey estimates count real walking geometry and transfer allowance separately", () => {
  assert.deepEqual(journeyEstimate(plan, 0, 1), {
    metres: 18,
    seconds: 52,
    transfers: 1,
  });
  assert.deepEqual(journeyEstimate(plan, 16, 1), {
    metres: 6,
    seconds: 6,
    transfers: 0,
  });
  assert.deepEqual(journeyEstimate(plan, 22, 1), {
    metres: 0,
    seconds: 0,
    transfers: 0,
  });
  assert.ok(
    journeyEstimate(plan, 0, 0.8).seconds >
      journeyEstimate(plan, 0, 1.5).seconds,
  );
  assert.equal(durationLabel(42), "<1 min");
  assert.equal(durationLabel(61), "2 min");
  assert.equal(elapsedLabel(125), "2:05");
});
