import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { roofGeometry } from "../src/lib/roofGeometry.ts";

const rectangle = (x, y, w, h) => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
test("Pitched roofs remain inside concave outlines and leave courtyard holes open", () => {
  const examples = [
    {
      footprint: {
        outer: rectangle(-10, -10, 20, 20),
        holes: [rectangle(-3, -3, 6, 6)],
      },
      covered: [
        [-7, 0],
        [0, 7],
      ],
      open: [
        [0, 0],
        [12, 0],
      ],
    },
    {
      footprint: {
        outer: [
          [0, 0],
          [12, 0],
          [12, 4],
          [4, 4],
          [4, 12],
          [0, 12],
        ],
        holes: [],
      },
      covered: [
        [2, 9],
        [9, 2],
      ],
      open: [
        [8, 8],
        [-1, 1],
      ],
    },
  ];
  for (const { footprint, covered, open } of examples) {
    const geo = roofGeometry(footprint, 7.16, 0.8);
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geo, material);
    mesh.updateMatrixWorld(true);
    const hit = ([x, y]) =>
      new THREE.Raycaster(
        new THREE.Vector3(x, 20, -y),
        new THREE.Vector3(0, -1, 0),
      ).intersectObject(mesh);
    for (const p of covered) assert.ok(hit(p).length, `Missing roof at ${p}`);
    for (const p of open)
      assert.equal(hit(p).length, 0, `Roof covers excluded area ${p}`);
    geo.computeBoundingBox();
    assert.ok(geo.boundingBox.min.y >= 7.16 - 1e-5);
    assert.ok(geo.boundingBox.max.y <= 7.96 + 1e-5);
    // A courtyard may remove the ridge itself; the remaining slopes still rise.
    assert.ok(geo.boundingBox.max.y > 7.36);
    const normals = geo.getAttribute("normal"),
      slopes = new Set();
    for (let i = 0; i < normals.count; i++)
      if (normals.getY(i) > 0.1)
        slopes.add(
          [normals.getX(i), normals.getY(i), normals.getZ(i)]
            .map((v) => v.toFixed(3))
            .join(","),
        );
    assert.ok(
      slopes.size <= 4,
      "Roof must contain clean planar slopes, not a rippled surface",
    );
    geo.dispose();
    material.dispose();
  }
});

test("Roof edges stay at the eave and shared triangles have no height cracks", () => {
  const geo = roofGeometry(
    { outer: rectangle(-6, -4, 12, 8), holes: [] },
    3.16,
    1.2,
  );
  const vertices = geo.getAttribute("position"),
    seen = new Map();
  const material = new THREE.MeshBasicMaterial(),
    mesh = new THREE.Mesh(geo, material);
  mesh.updateMatrixWorld(true);
  for (const [z, expected] of [
    [0, 4.36],
    [-3, 3.46],
  ]) {
    const hits = new THREE.Raycaster(
      new THREE.Vector3(0, 10, z),
      new THREE.Vector3(0, -1, 0),
    ).intersectObject(mesh);
    assert.ok(hits.length, "Rectangular roof must face upward");
    assert.ok(
      Math.abs(hits[0].point.y - expected) < 1e-5,
      "Roof sides must be planar up to the ridge",
    );
  }
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i),
      y = vertices.getY(i),
      z = vertices.getZ(i);
    assert.ok([x, y, z].every(Number.isFinite));
    const key = `${x.toFixed(5)},${z.toFixed(5)}`;
    if (seen.has(key)) assert.ok(Math.abs(seen.get(key) - y) < 1e-5);
    seen.set(key, y);
    if (Math.abs(x) === 6 || Math.abs(z) === 4)
      assert.ok(Math.abs(y - 3.16) < 1e-5);
  }
  geo.dispose();
  material.dispose();
});
