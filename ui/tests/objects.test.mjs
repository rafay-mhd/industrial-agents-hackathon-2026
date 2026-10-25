import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { describeAsset, objectParts } from "../src/lib/assetCatalog.ts";
import {
  createAssetScene,
  assetHit,
  assetTransform,
} from "../src/lib/assetScene.ts";
const asset = (type, extra = {}) => ({
  id: type,
  name: type,
  type,
  space_id: "room",
  floor_id: "floor",
  position: [-7, 12],
  footprint: { width_m: 1.2, depth_m: 0.7, rotation_deg: 37 },
  source: "generated",
  ...extra,
});
test("Object identity and provenance come from data; appearance and unknown dimensions stay explicit", () => {
  assert.equal(describeAsset(asset("office_chair")).family, "chair");
  assert.equal(describeAsset(asset("armchair")).family, "sofa");
  assert.equal(describeAsset(asset("never_seen_machine_42")).family, "unknown");
  assert.equal(describeAsset(asset("bed")).heightKnown, false);
  assert.equal(describeAsset(asset("bed", { height_m: 1.23 })).height, 1.23);
  assert.equal(
    describeAsset(asset("bed", { height_m: NaN })).heightKnown,
    false,
  );
  assert.equal(
    describeAsset(asset("bed", { footprint: undefined })).footprintKnown,
    false,
  );
  assert.equal(describeAsset(asset("bed")).provenance, "Generated furnishing");
  assert.equal(
    describeAsset(asset("bed", { source: "dataset" })).provenance,
    "Dataset annotation",
  );
});
test("Model parts fit supplied footprint, height and rotation, even at negative coordinates", () => {
  const types = [
    "chair",
    "desk",
    "sofa",
    "bed",
    "pallet_rack",
    "cabinet",
    "server_rack",
    "cnc_mill",
    "forklift",
    "pallet_jack",
    "conveyor",
    "plant",
    "toilet",
    "sink",
    "bathtub",
    "shower",
    "kitchen_counter",
    "fridge",
    "stove",
    "coffee_machine",
    "screen",
    "fire_extinguisher",
    "printer",
    "bench",
    "washing_machine",
    "microscope",
    "unknown",
  ];
  const assets = types.map((t, i) => asset(t, { position: [i * 3, -12] }));
  const original = JSON.stringify(assets),
    model = createAssetScene(assets, 3);
  for (const a of assets) {
    const inverse = assetTransform(a, 3).invert(),
      box = new THREE.Box3();
    for (const mesh of model.meshes) {
      mesh.geometry.computeBoundingBox();
      mesh.userData.assetIds.forEach((id, i) => {
        if (id !== a.id) return;
        const m = new THREE.Matrix4();
        mesh.getMatrixAt(i, m);
        box.union(
          mesh.geometry.boundingBox
            .clone()
            .applyMatrix4(inverse.clone().multiply(m)),
        );
      });
    }
    assert.ok(box.min.x >= -0.501 && box.max.x <= 0.501, `${a.id} width`);
    assert.ok(box.min.z >= -0.501 && box.max.z <= 0.501, `${a.id} depth`);
    assert.ok(box.min.y >= -0.001 && box.max.y <= 1.001, `${a.id} height`);
    assert.ok(
      model.bounds
        .get(a.id)
        .containsPoint(new THREE.Vector3(a.position[0], 0.1, -a.position[1])),
    );
  }
  assert.equal(JSON.stringify(assets), original);
  model.dispose();
});
test("Instanced object picking returns the original asset id and honours hidden/highlighted instances", () => {
  const a = asset("desk", { footprint: [1, 1, 90], position: [2, -3] }),
    model = createAssetScene([a], 3);
  model.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(2, 4, 3),
    new THREE.Vector3(0, -1, 0),
  );
  let hits = ray.intersectObjects(model.meshes);
  assert.ok(hits.length);
  assert.equal(assetHit(hits[0]), "desk");
  model.update(false, undefined, []);
  assert.equal(ray.intersectObjects(model.meshes).length, 0);
  model.update(false, "desk", []);
  hits = ray.intersectObjects(model.meshes);
  assert.ok(hits.length);
  assert.equal(assetHit(hits[0]), "desk");
  model.update(false, undefined, ["desk"]);
  assert.ok(ray.intersectObjects(model.meshes).length);
  model.dispose();
});
test("Repeated furnishings are batched; representative parts are distinct and bounded", () => {
  const model = createAssetScene(
    Array.from({ length: 200 }, (_, i) =>
      asset("desk", { id: `desk${i}`, position: [i * 2, 0] }),
    ),
    3,
  );
  assert.ok(model.meshes.length < 10);
  assert.equal(model.bounds.size, 200);
  assert.notDeepEqual(objectParts("bed"), objectParts("chair"));
  model.dispose();
});

test("Shared wall pieces do not overlap; opening gaps and parallel walls remain intact", async () => {
  const { wallCoverage } = await import("../src/lib/wallCoverage.ts");
  const unique = wallCoverage();
  assert.equal(unique({ a: [0, 0], b: [4, 0] }).length, 1);
  assert.equal(unique({ a: [6, 0], b: [10, 0] }).length, 1);
  assert.equal(unique({ a: [4, 0], b: [0, 0] }).length, 0);
  assert.deepEqual(unique({ a: [8, 0], b: [12, 0] }), [
    { a: [10, 0], b: [12, 0] },
  ]);
  assert.equal(unique({ a: [0, 2], b: [4, 2] }).length, 1);
  assert.deepEqual(unique({ a: [4, 0], b: [6, 0] }), [
    { a: [4, 0], b: [6, 0] },
  ]);
});
