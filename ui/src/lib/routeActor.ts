import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/** A visible preview character, deliberately separate from the user's selected real location.
 *
 * The pixel-art GLB figures (walker.glb, wheelchair_user.glb) replace the original box figure as soon
 * as they load; the boxes stay as the fallback if a file is missing. setWheelchair(true) swaps to the
 * wheelchair user. tick(dt) drives the walk/roll animation while the group moves and idle otherwise. */

const FEET_Y = 0.03; // sole height of the original box figure; the GLBs stand at the same level
const SKINS = ["#e6b185", "#a86943", "#f0c7a7", "#794f3b"];
const COATS = ["#29478e", "#ae3549", "#97703a", "#4e7567"];
const STILL_AFTER_S = 0.2;
const FADE_S = 0.2;

type Figure = {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  materials: Map<string, THREE.Material>;
  moveClip: string;
  dispose(): void;
};
type Loaded = { scene: THREE.Group; animations: THREE.AnimationClip[] };

export function createRouteActor(
  load: (url: string) => Promise<Loaded> = (url) => new GLTFLoader().loadAsync(url),
) {
  const group = new THREE.Group(),
    body = new THREE.Group(),
    boxes = new THREE.Group();
  group.add(body);
  body.add(boxes);
  group.visible = false;
  const geometry = new THREE.BoxGeometry(),
    skin = new THREE.MeshStandardMaterial({ color: SKINS[0], roughness: 0.8 }),
    coat = new THREE.MeshStandardMaterial({ color: COATS[0], roughness: 0.8 }),
    dark = new THREE.MeshStandardMaterial({ color: "#30364b", roughness: 0.8 }),
    hair = new THREE.MeshStandardMaterial({ color: "#3e302d", roughness: 0.9 });
  // Navigation is an overlay: keep the character visible behind railings and furniture.
  const overlay = (material: THREE.Material) => {
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = true;
  };
  [skin, coat, dark, hair].forEach(overlay);
  const box = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
  ) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.scale.set(w, h, d);
    m.castShadow = true;
    m.renderOrder = 20;
    boxes.add(m);
  };
  box(0, 1.04, 0, 0.36, 0.36, 0.32, skin);
  box(0, 1.25, 0.015, 0.39, 0.13, 0.35, hair);
  box(0, 0.68, 0, 0.39, 0.4, 0.23, coat);
  for (const x of [-0.26, 0.26]) {
    box(x, 0.68, 0, 0.12, 0.36, 0.18, coat);
    box(x, 0.44, 0, 0.12, 0.13, 0.18, skin);
  }
  for (const x of [-0.12, 0.12]) {
    box(x, 0.25, 0, 0.15, 0.35, 0.18, dark);
    box(x, 0.08, -0.04, 0.17, 0.1, 0.26, dark);
    box(x * 0.7, 1.06, -0.17, 0.04, 0.055, 0.025, dark);
  }
  const ringGeometry = new THREE.RingGeometry(0.32, 0.45, 40),
    ringMaterial = new THREE.MeshBasicMaterial({
      color: "#d4ab52",
      side: THREE.DoubleSide,
      depthTest: false,
    });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.renderOrder = 8;
  group.add(ring);

  const figures: Partial<Record<"walker" | "wheelchair_user", Figure>> = {};
  let wheelchair = false,
    variant = 0,
    current: Figure | null = null,
    playing: THREE.AnimationAction | null = null,
    disposed = false,
    still = STILL_AFTER_S;
  const lastPosition = new THREE.Vector3();

  const tint = (figure: Figure | null) => {
    const skinColor = SKINS[variant % 4],
      coatColor = COATS[variant % 4];
    skin.color.set(skinColor);
    coat.color.set(coatColor);
    if (!figure) return;
    for (const [name, material] of figure.materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      if (name === "Skin") material.color.set(skinColor);
      if (name === "Coat") material.color.set(coatColor);
    }
  };
  const play = (figure: Figure, name: string) => {
    const next = figure.actions[name] ?? figure.actions["idle"];
    if (!next || next === playing) return;
    next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(FADE_S).play();
    playing?.fadeOut(FADE_S);
    playing = next;
  };
  const apply = () => {
    const wanted = wheelchair ? figures.wheelchair_user : figures.walker;
    if (wanted === current) return;
    if (current) {
      body.remove(current.root);
      current.mixer.stopAllAction();
    }
    playing = null;
    current = wanted ?? null;
    boxes.visible = !current;
    if (current) {
      body.add(current.root);
      tint(current);
      play(current, "idle");
    }
  };
  const prepare = (gltf: Loaded, moveClip: string): Figure => {
    const root = gltf.scene;
    const bounds = new THREE.Box3().setFromObject(root),
      center = bounds.getCenter(new THREE.Vector3());
    root.position.set(-center.x, FEET_Y - bounds.min.y, -center.z);
    const wrapper = new THREE.Group();
    wrapper.rotation.y = Math.PI; // the GLBs face +Z; the scene's figure faces -Z like the boxes
    wrapper.add(root);
    const materials = new Map<string, THREE.Material>();
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.renderOrder = 20;
        const list = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of list) {
          overlay(material);
          if (material.name) materials.set(material.name, material);
        }
      }
    });
    const mixer = new THREE.AnimationMixer(root);
    const actions: Record<string, THREE.AnimationAction> = {};
    for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);
    return {
      root: wrapper,
      mixer,
      actions,
      materials,
      moveClip,
      dispose() {
        mixer.stopAllAction();
        root.traverse((object) => {
          if (object instanceof THREE.Mesh) object.geometry.dispose();
        });
        materials.forEach((material) => material.dispose());
      },
    };
  };
  for (const [name, moveClip] of [
    ["walker", "walk"],
    ["wheelchair_user", "roll"],
  ] as const) {
    load(`/models/${name}.glb`)
      .then((gltf) => {
        if (disposed) return;
        figures[name] = prepare(gltf, moveClip);
        apply();
      })
      .catch(() => {
        /* The box figure remains for this variant. */
      });
  }

  return {
    group,
    setAvatar(next: number) {
      variant = next;
      tint(current);
    },
    setHeading(heading: number) {
      body.rotation.y = -heading;
    },
    setWheelchair(on: boolean) {
      wheelchair = on;
      apply();
    },
    /** Advance the animation; call once per frame with the frame time in seconds. */
    tick(dt: number) {
      if (!current) return;
      const moved = group.position.distanceToSquared(lastPosition) > 1e-6;
      lastPosition.copy(group.position);
      still = moved ? 0 : Math.min(still + dt, STILL_AFTER_S);
      play(current, still < STILL_AFTER_S ? current.moveClip : "idle");
      current.mixer.update(dt);
    },
    dispose() {
      disposed = true;
      geometry.dispose();
      ringGeometry.dispose();
      [skin, coat, dark, hair, ringMaterial].forEach((m) => m.dispose());
      Object.values(figures).forEach((figure) => figure?.dispose());
    },
  };
}
