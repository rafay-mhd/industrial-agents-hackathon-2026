/** The map character as a 2D sprite: a front-view render of the same pixel-art GLB that walks the 3D
 * routes (walker_sprite.png), or of the wheelchair user when step-free routing is on. */
const SPRITES = {
  walker: "/models/walker_sprite.png",
  wheelchair: "/models/wheelchair_user_sprite.png",
};

export function PixelPerson({
  wheelchair = false,
  className = "",
  title = "Your map character",
  inMap = false,
}: {
  /** Kept for existing callers; there is one character now. */
  variant?: number;
  wheelchair?: boolean;
  className?: string;
  title?: string;
  inMap?: boolean;
}) {
  const href = wheelchair ? SPRITES.wheelchair : SPRITES.walker;
  const label = wheelchair ? `${title} (wheelchair user)` : title;
  if (inMap)
    return (
      <g role="img" aria-label={label}>
        <image
          href={href}
          x={0}
          y={0}
          width={16}
          height={22}
          preserveAspectRatio="xMidYMax meet"
          style={{ imageRendering: "pixelated" }}
        />
      </g>
    );
  return (
    <img
      src={href}
      alt={label}
      className={`pixel-person ${className}`}
      draggable={false}
      style={{ objectFit: "contain", objectPosition: "center bottom" }}
    />
  );
}
