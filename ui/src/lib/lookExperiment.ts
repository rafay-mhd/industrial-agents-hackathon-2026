/** Interior look experiment and shared wheel-zoom tuning.
 *
 * LOOK flags change how the 3D interior is drawn. All false = the Interface owner's original cutaway
 * convention (walls lowered to 0.7 m, no ceilings, exterior shell only in Exterior mode). The
 * `look-experiment` branch sets them to true; flip them here to switch back. */
export const LOOK = {
  /** Walls at their source floor height in Cutaway, Exploded and Inside instead of the 0.7 m cutaway. */
  fullHeightWalls: false,
  /** A translucent ceiling slab per room in the interior modes. */
  ceilings: false,
  /** The exterior shell drawn translucent around the interior so upper floors do not float. */
  ghostEnvelope: false,
  ceilingOpacity: 0.18,
  envelopeOpacity: 0.12,
};

/** Per-second approach rate for accumulated wheel zoom; higher = snappier, lower = floatier. */
export const ZOOM_SMOOTHING = 11;

/** Wheel event -> zoom step in log space, to be accumulated and applied over several frames.
 * Trackpad pinch arrives as a wheel event with ctrlKey and small deltas; two-finger scrolling sends
 * much larger deltas, so the two get different gains. Positive = zoom out, as before. */
export function wheelZoomStep(event: WheelEvent, viewportHeight: number): number {
  const delta =
    event.deltaY *
    (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportHeight : 1);
  const gain = event.ctrlKey ? 0.0045 : 0.0011;
  return Math.max(-0.12, Math.min(0.12, delta * gain));
}
