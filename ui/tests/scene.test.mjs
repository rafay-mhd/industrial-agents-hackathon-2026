import { test } from "node:test";
import assert from "node:assert/strict";
import { fitCameraDistance, easeCamera } from "../src/lib/sceneMath.ts";
import { palette } from "../src/lib/model.ts";

test("camera framing contains every corner for wide, portrait, tall and top views", () => {
  for (const size of [
    [90, 8, 22],
    [15, 42, 20],
    [3, 3, 4],
    [150, 6, 2],
  ]) {
    for (const aspect of [0.45, 1, 2.4]) {
      for (const direction of [
        [0.95, 1.05, 1.25],
        [0, 1, 0],
        [0.01, 0.2, 1],
      ]) {
        const n = Math.hypot(...direction),
          d = direction.map((v) => v / n),
          h = Math.hypot(d[0], d[2]);
        const r = h < 1e-8 ? [1, 0, 0] : [d[2] / h, 0, -d[0] / h];
        const u =
          h < 1e-8 ? [0, 0, -1] : [(-d[0] * d[1]) / h, h, (-d[2] * d[1]) / h];
        const distance = fitCameraDistance(size, direction, aspect, 36),
          tan = Math.tan(Math.PI / 10);
        for (const a of [-1, 1])
          for (const b of [-1, 1])
            for (const c of [-1, 1]) {
              const p = [
                  (a * size[0]) / 2,
                  (b * size[1]) / 2,
                  (c * size[2]) / 2,
                ],
                dot = (v) => p.reduce((s, x, i) => s + x * v[i], 0),
                depth = distance - dot(d);
              assert.ok(depth > 0);
              assert.ok(
                Math.abs(dot(r)) / (depth * tan * aspect) < 1,
                "horizontal crop",
              );
              assert.ok(Math.abs(dot(u)) / (depth * tan) < 1, "vertical crop");
            }
      }
    }
  }
});

test("camera easing is monotonic, clamped and ends exactly at the target", () => {
  assert.equal(easeCamera(-1), 0);
  assert.equal(easeCamera(2), 1);
  let prior = 0;
  for (let i = 0; i <= 100; i++) {
    const value = easeCamera(i / 100);
    assert.ok(value >= prior);
    prior = value;
  }
  assert.equal(prior, 1);
});

test("supplied room purpose wins over a generic hall or corridor type", () => {
  const hall = { type: "hall" };
  assert.equal(
    palette({ ...hall, room_type: "warehouse_zone" }).group,
    "Storage & logistics",
  );
  assert.equal(
    palette({ ...hall, room_type: "production_zone" }).group,
    "Production",
  );
  assert.equal(palette({ ...hall, room_type: "lobby" }).group, "Circulation");
  assert.equal(
    palette({ type: "corridor", room_type: "stairwell" }).group,
    "Stairs & lifts",
  );
  assert.equal(
    palette({ type: "room", room_type: "lecture_hall" }).group,
    "Shared spaces",
  );
  assert.notEqual(
    palette({ ...hall, room_type: "warehouse_zone" }).solid,
    palette({ ...hall, room_type: "production_zone" }).solid,
  );
});
