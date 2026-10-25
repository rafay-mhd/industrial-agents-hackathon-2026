import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import * as THREE from "three";
import {
  connectorLayouts,
  sharedCoreFootprint,
} from "../src/lib/connectorLayout.ts";
import { createConnectorScene } from "../src/lib/connectorScene.ts";
import { pointInside } from "../src/lib/model.ts";
const factory = JSON.parse(
  readFileSync(
    new URL("../public/buildings/proc-factory-dev-003.json", import.meta.url),
  ),
);
const room = (id, floor_id, dx = 0) => ({
  id,
  floor_id,
  name: id,
  type: "stair",
  polygon: [
    [dx - 3, -2],
    [dx + 3, -2],
    [dx + 3, 2],
    [dx - 3, 2],
  ],
});
const unseen = {
  building: { id: "new", name: "Unseen", source: "test" },
  floors: [
    { id: "top", level: 2, elevation_m: 5.8, height_m: 3 },
    { id: "base", level: -1, elevation_m: -3.2, height_m: 3 },
  ],
  spaces: [room("up", "top", -10), room("down", "base", -10)],
  vertical_connectors: [
    {
      id: "s",
      kind: "stairs",
      name: "West stair",
      floor_ids: ["top", "base"],
      space_ids: ["up", "down"],
    },
  ],
};
test("Connections use declared stops and source elevations, including unordered basement floors", () => {
  const original = JSON.stringify(unseen),
    [layout] = connectorLayouts(unseen);
  assert.deepEqual(
    layout.stops.map((s) => s.floorId),
    ["base", "top"],
  );
  assert.equal(layout.spans[0].rise, 9);
  assert.ok(layout.spans[0].footprint);
  assert.equal(JSON.stringify(unseen), original);
  assert.deepEqual(
    connectorLayouts({ ...unseen, vertical_connectors: [] }),
    [],
  );
  const omitted = structuredClone(unseen);
  omitted.vertical_connectors[0].floor_ids = ["base"];
  assert.deepEqual(connectorLayouts(omitted), []);
});
test("Physical display cores stay inside both landing polygons; offset and conflicting stops remain schematic", () => {
  const [a, b] = unseen.spaces,
    fp = sharedCoreFootprint(a, b);
  assert.ok(fp);
  for (const p of fp.polygon) {
    assert.ok(pointInside(p, a.polygon));
    assert.ok(pointInside(p, b.polygon));
  }
  assert.equal(sharedCoreFootprint(a, room("other", "base", 30)), null);
  const conflict = structuredClone(unseen);
  conflict.vertical_connectors.push({
    ...conflict.vertical_connectors[0],
    id: "lift",
    kind: "lift",
  });
  assert.ok(
    connectorLayouts(conflict).every((c) =>
      c.spans.every((s) => s.footprint === null),
    ),
  );
  const concave = {
    ...a,
    polygon: [
      [0, 0],
      [6, 0],
      [6, 5],
      [3.01, 5],
      [3.01, 1],
      [2.99, 1],
      [2.99, 5],
      [0, 5],
    ],
  };
  const narrow = sharedCoreFootprint(concave, concave);
  if (narrow)
    for (let x = -0.5; x <= 0.5; x += 0.05)
      for (let y = -0.5; y <= 0.5; y += 0.05) {
        const p = [
          narrow.center[0] +
            Math.cos(narrow.angle) * x * narrow.width -
            Math.sin(narrow.angle) * y * narrow.depth,
          narrow.center[1] +
            Math.sin(narrow.angle) * x * narrow.width +
            Math.cos(narrow.angle) * y * narrow.depth,
        ];
        assert.ok(pointInside(p, concave.polygon));
      }
});
test("Factory stairs and lift touch both actual floor elevations; exploded mode never stretches the stairs", () => {
  const dom = new JSDOM('<div id="labels"></div>'),
    old = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    for (const layout of connectorLayouts(factory)) {
      const model = createConnectorScene(
          layout,
          document.getElementById("labels"),
          () => {},
        ),
        heights = new Map(layout.stops.map((s) => [s.floorId, s.elevation]));
      model.setState(false, true);
      model.update("connected", layout.stops[0].floorId, heights);
      model.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model.group);
      assert.ok(box.min.y <= 0.01);
      assert.ok(box.max.y >= 3.5);
      assert.ok([...box.min, ...box.max].every(Number.isFinite));
      assert.ok(
        model.picks.every(
          (p) =>
            p.userData.kind === "connector" &&
            p.userData.id === layout.connector.id,
        ),
      );
      const core = model.group.children[0],
        before = new THREE.Box3().setFromObject(core);
      heights.set(layout.stops[1].floorId, 23.5);
      model.update("floors", layout.stops[0].floorId, heights);
      model.group.updateMatrixWorld(true);
      const after = new THREE.Box3().setFromObject(core);
      assert.equal(before.max.y, after.max.y);
      assert.ok(model.group.children.some((c) => c.isLine && c.visible));
      model.update(
        "connected",
        layout.stops[0].floorId,
        new Map(layout.stops.map((s) => [s.floorId, s.elevation])),
      );
      assert.ok(
        model.group.children.filter((c) => c.isLine).every((c) => !c.visible),
      );
      model.setState(true, false);
      assert.match(model.tag.textContent, /Closed/);
      model.dispose();
    }
  } finally {
    globalThis.document = old;
    dom.window.close();
  }
});
test("Every supplied connector resolves to finite source stops and conservative display envelopes", () => {
  let count = 0,
    physical = 0,
    schematic = 0;
  for (const path of globSync("data/*/*/building.json", {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
  })) {
    const d = JSON.parse(
      readFileSync(new URL("../../" + path, import.meta.url)),
    );
    const layouts = connectorLayouts(d);
    count += layouts.length;
    for (const c of layouts)
      for (const span of c.spans) {
        assert.ok(Number.isFinite(span.rise) && span.rise > 0);
        if (span.footprint) {
          physical++;
          for (const p of span.footprint.polygon)
            assert.ok(
              pointInside(p, span.from.space.polygon) &&
                pointInside(p, span.to.space.polygon),
            );
        } else schematic++;
      }
  }
  assert.equal(count, 712);
  assert.ok(physical > 1000);
  assert.ok(schematic > 0);
});
