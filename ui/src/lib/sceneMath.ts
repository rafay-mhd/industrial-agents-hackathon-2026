export type Vec3 = [number, number, number];

export function easeCamera(t: number) {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
}

/** Respond immediately to scrolling, then settle without a long inertial tail. */
export function easeZoom(t: number) {
  const x = Math.max(0, Math.min(1, t));
  return 1 - (1 - x) ** 3;
}

/** Fits every corner, accounting for portrait viewports and oblique cameras. */
export function fitCameraDistance(
  size: Vec3,
  direction: Vec3,
  aspect: number,
  fov = 36,
) {
  const length = Math.hypot(...direction);
  const [x, y, z] = direction.map((v) => v / length);
  const horizontal = Math.hypot(x, z);
  const right =
    horizontal < 1e-8 ? [1, 0, 0] : [z / horizontal, 0, -x / horizontal];
  const up =
    horizontal < 1e-8
      ? [0, 0, -Math.sign(y)]
      : [(-x * y) / horizontal, horizontal, (-z * y) / horizontal];
  const tanY = Math.tan((fov * Math.PI) / 360);
  const tanX = tanY * Math.max(0.1, aspect);
  let distance = 1;
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const p = [(size[0] * sx) / 2, (size[1] * sy) / 2, (size[2] * sz) / 2];
        const dot = (a: number[]) => p.reduce((sum, v, i) => sum + v * a[i], 0);
        distance = Math.max(
          distance,
          dot([x, y, z]) +
            Math.max(Math.abs(dot(right)) / tanX, Math.abs(dot(up)) / tanY),
        );
      }
  return distance * 1.2;
}
