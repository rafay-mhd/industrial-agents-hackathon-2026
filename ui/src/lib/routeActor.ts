import * as THREE from "three";
/** A visible preview character, deliberately separate from the user's selected real location. */
export function createRouteActor() {
  const group = new THREE.Group(),
    body = new THREE.Group();
  group.add(body);
  group.visible = false;
  const geometry = new THREE.BoxGeometry(),
    skin = new THREE.MeshStandardMaterial({ color: "#e6b185", roughness: 0.8 }),
    coat = new THREE.MeshStandardMaterial({ color: "#29478e", roughness: 0.8 }),
    dark = new THREE.MeshStandardMaterial({ color: "#30364b", roughness: 0.8 }),
    hair = new THREE.MeshStandardMaterial({ color: "#3e302d", roughness: 0.9 });
  // Navigation is an overlay: keep the character visible behind railings and furniture.
  for (const material of [skin, coat, dark, hair]) {
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = true;
  }
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
    body.add(m);
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
  return {
    group,
    setAvatar(variant: number) {
      skin.color.set(["#e6b185", "#a86943", "#f0c7a7", "#794f3b"][variant % 4]);
      coat.color.set(["#29478e", "#ae3549", "#97703a", "#4e7567"][variant % 4]);
    },
    setHeading(heading: number) {
      body.rotation.y = -heading;
    },
    dispose() {
      geometry.dispose();
      ringGeometry.dispose();
      [skin, coat, dark, hair, ringMaterial].forEach((m) => m.dispose());
    },
  };
}
