type Segment = { a: [number, number]; b: [number, number] };
/** Remove overlapping collinear boundary pieces without shifting source coordinates. */
export function wallCoverage() {
  const lines = new Map<string, [number, number][]>();
  return (segment: Segment): Segment[] => {
    let dx = segment.b[0] - segment.a[0],
      dy = segment.b[1] - segment.a[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) return [];
    dx /= length;
    dy /= length;
    if (dx < -0.000001 || (Math.abs(dx) < 0.000001 && dy < 0)) {
      dx = -dx;
      dy = -dy;
    }
    const offset = -dy * segment.a[0] + dx * segment.a[1];
    const key = `${dx.toFixed(5)}:${dy.toFixed(5)}:${offset.toFixed(4)}`;
    const start = dx * segment.a[0] + dy * segment.a[1],
      end = dx * segment.b[0] + dy * segment.b[1];
    let pieces: [number, number][] = [
      [Math.min(start, end), Math.max(start, end)],
    ];
    const previous = lines.get(key) ?? [];
    for (const [lo, hi] of previous) {
      const next: [number, number][] = [];
      for (const [a, b] of pieces) {
        if (hi <= a + 1e-6 || lo >= b - 1e-6) next.push([a, b]);
        else {
          if (lo > a + 1e-6) next.push([a, lo]);
          if (hi < b - 1e-6) next.push([hi, b]);
        }
      }
      pieces = next;
    }
    const merged: [number, number][] = [];
    for (const [a, b] of [...previous, ...pieces].sort((a, b) => a[0] - b[0])) {
      const last = merged.at(-1);
      if (last && a <= last[1] + 1e-6) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    lines.set(key, merged);
    const point = (t: number): [number, number] => [
      segment.a[0] + dx * (t - start),
      segment.a[1] + dy * (t - start),
    ];
    return pieces.map(([a, b]) => ({ a: point(a), b: point(b) }));
  };
}
