import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Asset } from "../types";
import { describeAsset, objectParts } from "./assetCatalog.ts";
import type { Part } from "./assetCatalog.ts";
import { modelForType } from "./assetModels.ts";
import type { ModelName, ModelTemplate } from "./assetModels.ts";

type Batch = {
  mesh: THREE.InstancedMesh;
  ids: string[];
  matrices: THREE.Matrix4[];
};
/** Batches primitive parts, rather than issuing a draw call for every piece of furniture. */
export function createAssetScene(
  assets: Asset[],
  floorHeight: number,
  models?: ReadonlyMap<ModelName, ModelTemplate>,
) {
  const group = new THREE.Group();
  const geometry = {
    box: new THREE.BoxGeometry(),
    round: new RoundedBoxGeometry(1, 1, 1, 2, 0.045),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
    sphere: new THREE.SphereGeometry(0.5, 12, 10),
    pot: new THREE.CylinderGeometry(0.5, 0.35, 1, 16),
  };
  const colors = {
    wood: "#b49a72",
    metal: "#b5bec1",
    dark: "#343e4a",
    fabric: "#718795",
    white: "#f4efe3",
    blue: "#456ba0",
    glass: "#54747e",
    green: "#567b55",
    red: "#ab3645",
    gold: "#c69b46",
  };
  const grainData = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      const value = Math.round(
          236 +
            11 * Math.sin(y * 0.72 + Math.sin(x * 0.05) * 0.7) +
            5 * Math.sin(y * 3.1 + x * 0.07),
        ),
        i = (y * 128 + x) * 4;
      grainData.set([value, value, value, 255], i);
    }
  const grain = new THREE.DataTexture(grainData, 128, 128);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.magFilter = THREE.LinearFilter;
  grain.minFilter = THREE.LinearMipmapLinearFilter;
  grain.generateMipmaps = true;
  grain.needsUpdate = true;
  const materials = Object.fromEntries(
    Object.entries(colors).map(([key, color]) => [
      key,
      new THREE.MeshStandardMaterial({
        color,
        map: key === "wood" ? grain : null,
        metalness: key === "metal" ? 0.62 : key === "glass" ? 0.25 : 0.04,
        roughness: key === "metal" ? 0.32 : key === "glass" ? 0.18 : 0.72,
      }),
    ]),
  ) as Record<Part["material"], THREE.MeshStandardMaterial>;
  const buckets = new Map<
    string,
    {
      geometry: THREE.BufferGeometry;
      material: THREE.Material | THREE.Material[];
      matrices: THREE.Matrix4[];
      ids: string[];
    }
  >();
  const templateCache = new Map<string, THREE.Matrix4[]>();
  const bounds = new Map<string, THREE.Box3>();
  for (const asset of assets) {
    const d = describeAsset(asset, floorHeight),
      key = asset.type ?? "unknown",
      parts = objectParts(d.family, key);
    const parent = assetTransform(asset, floorHeight);
    bounds.set(
      asset.id,
      new THREE.Box3(
        new THREE.Vector3(-0.5, 0, -0.5),
        new THREE.Vector3(0.5, 1, 0.5),
      ).applyMatrix4(parent),
    );
    const modelName = modelForType(asset.type);
    const model = modelName && models?.get(modelName);
    if (model) {
      model.parts.forEach((part, i) => {
        const batchKey = `model:${modelName}:${i}`;
        if (!buckets.has(batchKey))
          buckets.set(batchKey, {
            geometry: part.geometry,
            material: part.material,
            matrices: [],
            ids: [],
          });
        const bucket = buckets.get(batchKey)!;
        bucket.matrices.push(parent.clone());
        bucket.ids.push(asset.id);
      });
      continue;
    }
    let locals = templateCache.get(key);
    if (!locals) {
      locals = parts.map((p) =>
        new THREE.Matrix4().compose(
          new THREE.Vector3(...p.at),
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(...(p.rotate ?? [0, 0, 0])),
          ),
          new THREE.Vector3(...p.size),
        ),
      );
      const envelope = new THREE.Box3();
      const unit = new THREE.Box3(
        new THREE.Vector3(-0.5, -0.5, -0.5),
        new THREE.Vector3(0.5, 0.5, 0.5),
      );
      for (const m of locals) envelope.union(unit.clone().applyMatrix4(m));
      const size = envelope.getSize(new THREE.Vector3()),
        center = envelope.getCenter(new THREE.Vector3());
      // Every model's outer bounds match its supplied footprint, including protruding handles.
      const normalize = new THREE.Matrix4()
        .makeScale(1 / size.x, 1 / size.y, 1 / size.z)
        .multiply(
          new THREE.Matrix4().makeTranslation(
            -center.x,
            -envelope.min.y,
            -center.z,
          ),
        );
      locals = locals.map((m) => normalize.clone().multiply(m));
      templateCache.set(key, locals);
    }
    parts.forEach((p, i) => {
      const batchKey = p.shape + ":" + p.material;
      if (!buckets.has(batchKey))
        buckets.set(batchKey, {
          geometry: geometry[p.shape],
          material: materials[p.material],
          matrices: [],
          ids: [],
        });
      const bucket = buckets.get(batchKey)!;
      bucket.matrices.push(parent.clone().multiply(locals![i]));
      bucket.ids.push(asset.id);
    });
  }
  const batches: Batch[] = [];
  for (const bucket of buckets.values()) {
    const mesh = new THREE.InstancedMesh(
      bucket.geometry,
      bucket.material,
      bucket.ids.length,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.assetIds = bucket.ids;
    bucket.matrices.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, new THREE.Color("white"));
    });
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    group.add(mesh);
    batches.push({
      mesh,
      ids: bucket.ids,
      matrices: bucket.matrices,
    });
  }
  let previous = "";
  const zero = new THREE.Matrix4().makeScale(0, 0, 0),
    white = new THREE.Color("white"),
    gold = new THREE.Color("#ffd778");
  return {
    group,
    bounds,
    meshes: batches.map((b) => b.mesh),
    update(
      showAll: boolean,
      selected: string | undefined,
      highlighted: string[],
    ) {
      const key = JSON.stringify([showAll, selected, highlighted]);
      if (key === previous) return;
      previous = key;
      const visible = new Set(highlighted);
      if (selected) visible.add(selected);
      for (const batch of batches) {
        batch.ids.forEach((id, i) => {
          batch.mesh.setMatrixAt(
            i,
            showAll || visible.has(id) ? batch.matrices[i] : zero,
          );
          batch.mesh.setColorAt(i, visible.has(id) ? gold : white);
        });
        batch.mesh.instanceMatrix.needsUpdate = true;
        if (batch.mesh.instanceColor)
          batch.mesh.instanceColor.needsUpdate = true;
        // Keep the full, stable bounds: zero-scaled hidden instances must not pull bounds to origin.
      }
    },
    dispose() {
      grain.dispose();
      for (const batch of batches) batch.mesh.dispose();
      Object.values(geometry).forEach((g) => g.dispose());
      Object.values(materials).forEach((m) => m.dispose());
    },
  };
}
export function assetTransform(asset: Asset, floorHeight = Infinity) {
  const d = describeAsset(asset, floorHeight);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(asset.position[0], 0, -asset.position[1]),
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      (d.rotation * Math.PI) / 180,
    ),
    new THREE.Vector3(d.width, d.height, d.depth),
  );
}
export function assetHit(hit: THREE.Intersection): string | undefined {
  return hit.instanceId === undefined
    ? undefined
    : hit.object.userData.assetIds?.[hit.instanceId];
}
