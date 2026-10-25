import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  modelNames,
  modelForType,
  prepareModel,
  loadAssetModels,
} from "../src/lib/assetModels.ts";
import {
  createAssetScene,
  assetHit,
  assetTransform,
} from "../src/lib/assetScene.ts";

async function readModel(name) {
  const bytes = await readFile(
    new URL(`../public/models/${name}.glb`, import.meta.url),
  );
  return new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
}
const asset = (type, id = type) => ({
  id,
  type,
  name: type,
  floor_id: "floor",
  space_id: "room",
  position: [-7, 12],
  footprint: { width_m: 1.2, depth_m: 0.7, rotation_deg: 37 },
  height_m: 1.13,
});

test("All 22 Blender GLBs parse, keep their materials and fit source dimensions at arbitrary rotations", async () => {
  for (const name of modelNames) {
    const template = prepareModel((await readModel(name)).scene);
    const a = asset(name),
      original = JSON.stringify(a);
    const model = createAssetScene([a], 3, new Map([[name, template]]));
    const inverse = assetTransform(a, 3).invert(),
      box = new THREE.Box3();
    assert.equal(model.meshes.length, template.parts.length);
    for (const mesh of model.meshes) {
      assert.ok(
        template.parts.some(
          (part) =>
            part.geometry === mesh.geometry && part.material === mesh.material,
        ),
      );
      mesh.geometry.computeBoundingBox();
      const matrix = new THREE.Matrix4();
      mesh.getMatrixAt(0, matrix);
      box.union(
        mesh.geometry.boundingBox
          .clone()
          .applyMatrix4(inverse.clone().multiply(matrix)),
      );
      assert.equal(mesh.userData.assetIds[0], name);
    }
    for (const [actual, expected] of [
      [box.min.x, -0.5],
      [box.max.x, 0.5],
      [box.min.y, 0],
      [box.max.y, 1],
      [box.min.z, -0.5],
      [box.max.z, 0.5],
    ])
      assert.ok(
        Math.abs(actual - expected) < 0.0001,
        `${name}: ${actual} != ${expected}`,
      );
    assert.equal(JSON.stringify(a), original);
    model.dispose();
    template.dispose();
    template.dispose();
  }
});

test("GLB furniture is instanced; selection, hiding and raycasting retain source asset IDs", async () => {
  const template = prepareModel((await readModel("desk")).scene);
  const models = new Map([["desk", template]]);
  const assets = Array.from({ length: 200 }, (_, i) => ({
    ...asset("desk", `desk-${i}`),
    position: [i * 3, 0],
    footprint: [1, 1, 0],
  }));
  const scene = createAssetScene(assets, 3, models);
  assert.equal(scene.meshes.length, template.parts.length);
  assert.ok(scene.meshes.length < 5);
  scene.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(0, 4, 0),
    new THREE.Vector3(0, -1, 0),
  );
  assert.equal(assetHit(ray.intersectObjects(scene.meshes)[0]), "desk-0");
  scene.update(false, undefined, []);
  assert.equal(ray.intersectObjects(scene.meshes).length, 0);
  scene.update(false, "desk-0", []);
  assert.equal(assetHit(ray.intersectObjects(scene.meshes)[0]), "desk-0");
  scene.dispose();
  template.dispose();
});

test("Models load once per type; a missing file and unfamiliar equipment retain working fallbacks", async (t) => {
  t.mock.method(console, "warn", () => {});
  const calls = [];
  const assets = [
    asset("chair", "a"),
    asset("chair", "b"),
    asset("table"),
    asset("unseen_sensor"),
  ];
  const models = await loadAssetModels(assets, "/models/", async (url) => {
    calls.push(url);
    if (url.endsWith("table.glb")) throw new Error("404");
    return readModel("chair");
  });
  assert.deepEqual(calls.sort(), ["/models/chair.glb", "/models/table.glb"]);
  assert.equal(models.size, 1);
  assert.equal(modelForType("unseen_sensor"), undefined);
  const scene = createAssetScene(assets, 3, models);
  assert.equal(scene.bounds.size, 4);
  assert.ok(
    scene.meshes.some((mesh) =>
      mesh.userData.assetIds.includes("unseen_sensor"),
    ),
  );
  assert.ok(
    scene.meshes.some((mesh) => mesh.userData.assetIds.includes("table")),
  );
  scene.dispose();
  models.forEach((model) => model.dispose());
});
