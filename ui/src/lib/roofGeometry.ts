import * as THREE from "three";
import {
  footprintEdges,
  projectToEdge,
  intersectFootprints,
} from "./envelopeLayout.ts";
import type { Footprint } from "./envelopeLayout";
import type { Point } from "./model";
import { boundsOf, polygonArea } from "./model.ts";

/** Illustrative planar hip roof, clipped to the footprint rather than a draped mesh.
 * Four analytic slopes share exact ridgelines. Cut-in edges have metal upstands;
 * courtyards and outdoor exclusions stay open, including on irregular plans.
 */
export function roofGeometry(footprint: Footprint, eave: number, rise: number) {
  const b = boundsOf(footprint.outer),
    half = Math.min(b.width, b.height) / 2;
  const a: Point = [b.minX, b.minY],
    bb: Point = [b.maxX, b.minY],
    c: Point = [b.maxX, b.maxY],
    d: Point = [b.minX, b.maxY];
  let r1: Point, r2: Point, faces: Point[][];
  if (b.width <= b.height) {
    r1 = [(b.minX + b.maxX) / 2, b.minY + half];
    r2 = [(b.minX + b.maxX) / 2, b.maxY - half];
    faces = [
      [a, bb, r1],
      [bb, c, r2, r1],
      [c, d, r2],
      [d, a, r1, r2],
    ];
  } else {
    r1 = [b.minX + half, (b.minY + b.maxY) / 2];
    r2 = [b.maxX - half, (b.minY + b.maxY) / 2];
    faces = [
      [a, bb, r2, r1],
      [bb, c, r2],
      [c, d, r1, r2],
      [d, a, r1],
    ];
  }
  const yAt = ([x, y]: Point) =>
    eave +
    (half > 1e-6
      ? (Math.max(0, Math.min(x - b.minX, b.maxX - x, y - b.minY, b.maxY - y)) /
          half) *
        rise
      : 0);
  const positions: number[] = [],
    uv: number[] = [];
  const vertex = (p: Point, height = yAt(p)) => {
    positions.push(p[0], height, -p[1]);
    uv.push(p[0] * 1.15, p[1] * 1.15);
  };
  const boundary = footprintEdges([footprint]);
  for (const face of faces) {
    if (polygonArea(face) < 1e-8) continue;
    for (const piece of intersectFootprints(
      [footprint],
      [{ outer: face, holes: [] }],
    )) {
      const shape = new THREE.Shape(
        piece.outer.map(([x, y]) => new THREE.Vector2(x, y)),
      );
      shape.holes = piece.holes.map(
        (h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))),
      );
      const flat = new THREE.ShapeGeometry(shape),
        points = flat.getAttribute("position"),
        indices = flat.index!;
      for (let i = 0; i < indices.count; i++) {
        const k = indices.getX(i);
        vertex([points.getX(k), points.getY(k)]);
      }
      flat.dispose();
      // Close the roof volume at cut-ins. Internal hip seams receive no vertical wall.
      for (const edge of footprintEdges([piece])) {
        if (Math.max(yAt(edge.a), yAt(edge.b)) - eave < 1e-5) continue;
        if (
          !boundary.some(
            (original) =>
              projectToEdge(edge.a, original).distance < 0.0002 &&
              projectToEdge(edge.b, original).distance < 0.0002,
          )
        )
          continue;
        vertex(edge.a);
        vertex(edge.a, eave);
        vertex(edge.b, eave);
        vertex(edge.a);
        vertex(edge.b, eave);
        vertex(edge.b);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}
