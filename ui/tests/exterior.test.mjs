import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, globSync } from "node:fs";
import { JSDOM } from "jsdom";
import * as THREE from "three";
import {
  buildEnvelope,
  floorEnvelope,
  insideFootprints,
} from "../src/lib/envelopeLayout.ts";
import { createExteriorScene } from "../src/lib/exteriorScene.ts";
const load = (id) =>
  JSON.parse(
    readFileSync(new URL(`../public/buildings/${id}.json`, import.meta.url)),
  );
const rect = (x, y, w, h) => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
const room = (id, polygon, extra = {}) => ({
  id,
  floor_id: "ground",
  type: "room",
  name: id,
  polygon,
  ...extra,
});
const building = (spaces) => ({
  building: { id: "unseen", name: "Unseen" },
  floors: [
    { id: "ground", level: 0, name: "Ground", elevation_m: 0, height_m: 3 },
  ],
  spaces,
  openings: [],
});
test("Envelope keeps courtyards, concavity, detached wings and annotated outdoor spaces", () => {
  const ring = floorEnvelope([
    rect(0, 0, 10, 2),
    rect(0, 8, 10, 2),
    rect(0, 2, 2, 6),
    rect(8, 2, 2, 6),
  ]);
  assert.equal(ring.length, 1);
  assert.equal(ring[0].holes.length, 1);
  assert.equal(insideFootprints([5, 5], ring), false);
  assert.equal(insideFootprints([1, 5], ring), true);
  const l = floorEnvelope([rect(-5, -4, 3, 8), rect(-2, -4, 6, 3)]);
  assert.equal(insideFootprints([1, 1], l), false);
  assert.equal(floorEnvelope([rect(0, 0, 3, 3), rect(5, 0, 3, 3)]).length, 2);
  const closed = floorEnvelope([rect(0, 0, 3, 3), rect(3.2, 0, 3, 3)]);
  assert.equal(closed.length, 1);
  const terrace = floorEnvelope([rect(0, 0, 5, 5)], [rect(3, 3, 3, 3)]);
  assert.equal(insideFootprints([4, 4], terrace), false);
});
test("Factory has a continuous skin, four source-aligned entries, separate hall/office roof heights and no invented terrace", () => {
  const data = load("proc-factory-dev-003"),
    before = JSON.stringify(data),
    e = buildEnvelope(data);
  assert.equal(e.outdoors.length, 0);
  assert.equal(e.entrances.length, 4);
  assert.ok(e.entrances.every((e) => e.edge && e.distance < 0.001));
  assert.ok(e.bands.every((b) => b.footprints.length === 1));
  assert.ok(
    e.bands.some((b) => b.top === 7 && insideFootprints([6, 40], b.roof)),
  );
  assert.ok(
    e.bands.some((b) => b.top === 8 && insideFootprints([-20, 40], b.roof)),
  );
  assert.ok(
    e.bands
      .filter((b) => b.top === 8)
      .every((b) => !insideFootprints([6, 40], b.roof)),
  );
  for (const entry of e.entrances) {
    const b = e.bands.find((b) => b.edges.some((x) => x.id === entry.edge.id));
    assert.equal(
      insideFootprints(
        [
          entry.point[0] + entry.normal[0] * 0.4,
          entry.point[1] + entry.normal[1] * 0.4,
        ],
        b.footprints,
      ),
      false,
    );
    assert.deepEqual(
      entry.point.map((v) => Math.round(v * 1e4)),
      entry.opening.position.map((v) => Math.round(v * 1e4)),
    );
  }
  assert.equal(JSON.stringify(data), before);
});
test("Unseen balcony remains open, gets rails on free edges and keeps the access side open", () => {
  const data = building([
    room("home", rect(-10, -5, 10, 10)),
    room("deck", rect(0, -3, 3, 4), { type: "outdoor", room_type: "terrace" }),
  ]);
  const e = buildEnvelope(data);
  assert.equal(e.outdoors.length, 1);
  assert.equal(e.outdoors[0].railing, true);
  assert.equal(e.outdoors[0].edges.length, 3);
  assert.ok(e.bands.every((b) => !insideFootprints([1, -1], b.roof)));
});
test("Unaligned entrance annotations stay at the source location instead of inventing a facade door", () => {
  const data = building([room("home", rect(0, 0, 10, 10))]);
  data.openings = [
    {
      id: "entry",
      kind: "entrance",
      floor_id: "ground",
      space_ids: ["home", "outside"],
      position: [5, 5],
      width_m: 1,
      synthetic: true,
    },
  ];
  const [entry] = buildEnvelope(data).entrances;
  assert.equal(entry.edge, null);
  assert.deepEqual(entry.point, [5, 5]);
  assert.equal(entry.opening.synthetic, true);
});
test("Exterior geometry and picking stay finite; entrance selection, closures and floor offsets retain source IDs", () => {
  const dom = new JSDOM('<div id="labels"></div>');
  globalThis.document = dom.window.document;
  const selected = [],
    layout = buildEnvelope(load("resplan-1465")),
    model = createExteriorScene(
      layout,
      document.querySelector("#labels"),
      (s) => selected.push(s),
    );
  model.group.updateMatrixWorld(true);
  model.group.traverse((o) => {
    if (!o.geometry) return;
    o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox;
    assert.ok([...b.min.toArray(), ...b.max.toArray()].every(Number.isFinite));
  });
  const entry = model.features.find((f) => f.entry);
  entry.tag.click();
  assert.deepEqual(selected[0], { kind: "opening", id: entry.id });
  assert.ok(
    model.picks.some(
      (p) => p.userData.kind === "opening" && p.userData.id === entry.id,
    ),
  );
  model.update(
    "inside",
    entry.floorId,
    new Map([[entry.floorId, 9]]),
    entry.id,
    new Set([entry.id]),
  );
  assert.equal(model.shell.visible, false);
  assert.equal(entry.group.position.y, 9);
  assert.equal(entry.materials[0].color.getHexString(), "a73549");
  model.update(
    "building",
    entry.floorId,
    new Map([[entry.floorId, 0]]),
    undefined,
    new Set(),
  );
  assert.equal(model.shell.visible, true);
  assert.equal(entry.materials[0].color.getHexString(), "2d4f79");
  const entryMeshes = model.picks.filter((p) => p.userData.id === entry.id);
  assert.ok(entryMeshes.length > 0);
  assert.ok(
    new THREE.Box3().setFromObject(entry.group).getSize(new THREE.Vector3()).y >
      2,
  );
  model.dispose();
  assert.equal(document.querySelector("#labels").children.length, 0);
  dom.window.close();
  delete globalThis.document;
});
test("All 280 supplied buildings produce finite exterior geometry without changing the source", () => {
  let count = 0,
    entrances = 0,
    outdoors = 0;
  for (const file of globSync("../data/*/*/building.json", {
    cwd: new URL("../", import.meta.url),
  })) {
    const data = JSON.parse(
        readFileSync(new URL(`../${file}`, import.meta.url)),
      ),
      before = JSON.stringify(data),
      e = buildEnvelope(data);
    count++;
    for (const band of e.bands) {
      assert.ok(band.top > band.bottom);
      assert.ok(Number.isFinite(band.bottom));
      for (const edge of band.edges)
        assert.ok(
          [...edge.a, ...edge.b, ...edge.normal, edge.length].every(
            Number.isFinite,
          ),
        );
    }
    assert.equal(
      e.entrances.length,
      (data.openings ?? []).filter((o) => o.kind === "entrance").length,
    );
    assert.equal(JSON.stringify(data), before);
    entrances += e.entrances.length;
    outdoors += e.outdoors.length;
  }
  assert.equal(count, 280);
  assert.ok(entrances > 0 && outdoors >= 1831);
});

test("A balcony door cuts the facade without being relabelled as a building entrance", () => {
  const data = building([
    room("home", rect(-10, -5, 10, 10)),
    room("deck", rect(0, -3, 3, 4), { type: "outdoor", room_type: "balcony" }),
  ]);
  data.openings = [
    {
      id: "balcony-door",
      kind: "door",
      floor_id: "ground",
      space_ids: ["home", "deck"],
      position: [0, -1],
      width_m: 1,
    },
  ];
  const e = buildEnvelope(data);
  assert.equal(e.entrances.length, 0);
  assert.equal(e.accesses.length, 1);
  assert.equal(e.accesses[0].isEntrance, false);
  assert.ok(e.accesses[0].edge);
  assert.equal(e.accesses[0].opening.id, "balcony-door");
});
test("Source entrances are real holes in the exterior shell rather than markers painted over solid walls", () => {
  const dom = new JSDOM('<div id="labels"></div>');
  globalThis.document = dom.window.document;
  const layout = buildEnvelope(load("proc-factory-dev-003")),
    model = createExteriorScene(
      layout,
      document.querySelector("#labels"),
      () => {},
    );
  model.group.updateMatrixWorld(true);
  for (const e of layout.entrances) {
    const n = new THREE.Vector3(e.normal[0], 0, -e.normal[1]),
      origin = new THREE.Vector3(
        e.point[0],
        e.elevation + 1.1,
        -e.point[1],
      ).addScaledVector(n, 0.6),
      ray = new THREE.Raycaster(origin, n.clone().negate());
    const hits = ray.intersectObjects(model.shell.children);
    assert.ok(!hits.length || hits[0].distance > 1, `${e.label} is obstructed`);
  }
  model.dispose();
  dom.window.close();
  delete globalThis.document;
});
