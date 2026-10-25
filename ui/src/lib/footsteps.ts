import * as THREE from "three";
import type { PlaybackFrame, RoutePlan } from "./routePlayback";
import { footprintTrail } from "./walking.ts";

export function createFootsteps() {
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-0.045, -0.12);
  shape.bezierCurveTo(-0.07, -0.02, -0.07, 0.12, -0.015, 0.16);
  shape.bezierCurveTo(0.065, 0.18, 0.07, 0.06, 0.045, -0.02);
  shape.lineTo(0.035, -0.12);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color: "white",
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  let mesh: THREE.InstancedMesh | null = null,
    plan: RoutePlan | null = null,
    prints: ReturnType<typeof footprintTrail> = [];
  const object = new THREE.Object3D(),
    gold = new THREE.Color("#ae7926"),
    blue = new THREE.Color("#3150a2");
  return {
    group,
    update(
      frame: PlaybackFrame,
      offset: (floor: string) => number,
      visible: (floor: string) => boolean,
    ) {
      if (plan !== frame.plan) {
        if (mesh) {
          group.remove(mesh);
          mesh.dispose();
        }
        plan = frame.plan;
        prints = footprintTrail(plan);
        mesh = new THREE.InstancedMesh(
          geometry,
          material,
          Math.max(1, prints.length),
        );
        mesh.count = prints.length;
        mesh.frustumCulled = false;
        group.add(mesh);
      }
      if (!mesh) return;
      prints.forEach((foot, i) => {
        object.position.set(
          foot.point[0],
          foot.point[1] + offset(foot.floorId) + 0.365,
          foot.point[2],
        );
        object.rotation.set(0, -foot.heading, 0);
        object.scale.setScalar(visible(foot.floorId) ? 1 : 0);
        object.updateMatrix();
        mesh!.setMatrixAt(i, object.matrix);
        mesh!.setColorAt(i, foot.distance <= frame.distance ? gold : blue);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    dispose() {
      mesh?.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
