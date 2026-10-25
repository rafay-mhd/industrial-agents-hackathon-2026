import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Asset } from "../types";

/** Team-authored Blender assets. Only known matching types use a model;
 * unfamiliar equipment keeps its procedural representation. */
export const modelNames = [
  "appliance",
  "bed",
  "bookshelf",
  "cabinet",
  "chair",
  "cnc_mill",
  "desk",
  "filing_cabinet",
  "fire_extinguisher",
  "forklift",
  "locker",
  "machine",
  "meeting_table",
  "office_chair",
  "pallet_rack",
  "panel",
  "plant",
  "server_rack",
  "sink",
  "sofa",
  "table",
  "toilet",
] as const;
export type ModelName = (typeof modelNames)[number];
const names = new Set<string>(modelNames);
const aliases: Record<string, ModelName> = {
  single_bed: "bed",
  dining_chair: "chair",
  outdoor_chair: "chair",
  dining_table: "table",
  outdoor_table: "table",
  coffee_table: "table",
  shelf: "bookshelf",
  wardrobe: "cabinet",
  electrical_panel: "panel",
  control_panel: "panel",
  washing_machine: "appliance",
  dishwasher: "appliance",
};
export function modelForType(type?: string): ModelName | undefined {
  const key = type?.toLowerCase() ?? "";
  return names.has(key) ? (key as ModelName) : aliases[key];
}
export type ModelTemplate = {
  parts: {
    geometry: THREE.BufferGeometry;
    material: THREE.Material | THREE.Material[];
  }[];
  dispose(): void;
};

/** Bake the Blender hierarchy into a unit footprint, Y-up, with its base at zero.
 * The dataset, never the display mesh, determines position/rotation/dimensions. */
export function prepareModel(root: THREE.Object3D): ModelTemplate {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true);
  const size = box.getSize(new THREE.Vector3()),
    center = box.getCenter(new THREE.Vector3());
  const meshes: THREE.Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) meshes.push(node);
  });
  const materials = new Set(
    meshes.flatMap((mesh) =>
      Array.isArray(mesh.material) ? mesh.material : [mesh.material],
    ),
  );
  const textures = new Set<THREE.Texture>();
  for (const material of materials)
    for (const value of Object.values(material))
      if (value instanceof THREE.Texture) textures.add(value);
  const sourceGeometry = new Set(meshes.map((mesh) => mesh.geometry));
  const releaseSource = () => {
    sourceGeometry.forEach((geometry) => geometry.dispose());
  };
  const releaseMaterials = () => {
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
  };
  if (![size.x, size.y, size.z].every((n) => Number.isFinite(n) && n > 1e-6)) {
    releaseSource();
    releaseMaterials();
    throw new Error("Model has no usable 3D bounds");
  }
  const normalize = new THREE.Matrix4()
    .makeScale(1 / size.x, 1 / size.y, 1 / size.z)
    .multiply(
      new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z),
    );
  const parts = meshes.map((mesh) => ({
    geometry: mesh.geometry
      .clone()
      .applyMatrix4(normalize.clone().multiply(mesh.matrixWorld)),
    material: mesh.material,
  }));
  releaseSource();
  let disposed = false;
  return {
    parts,
    dispose() {
      if (disposed) return;
      disposed = true;
      parts.forEach((part) => part.geometry.dispose());
      releaseMaterials();
    },
  };
}

export async function loadAssetModels(
  assets: Asset[],
  base = "/models/",
  load: (url: string) => Promise<{ scene: THREE.Group }> = (url) =>
    new GLTFLoader().loadAsync(url),
) {
  const wanted = [
    ...new Set(
      assets
        .map((asset) => modelForType(asset.type))
        .filter((name) => name !== undefined),
    ),
  ];
  const models = new Map<ModelName, ModelTemplate>();
  await Promise.all(
    wanted.map(async (name) => {
      try {
        models.set(
          name,
          prepareModel((await load(`${base}${name}.glb`)).scene),
        );
      } catch (error) {
        console.warn(
          `Team model ${name} unavailable; using procedural furniture.`,
          error,
        );
      }
    }),
  );
  return models;
}
