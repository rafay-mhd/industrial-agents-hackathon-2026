export function PixelPerson({
  variant = 0,
  className = "",
  title = "Your map character",
  inMap = false,
}: {
  variant?: number;
  className?: string;
  title?: string;
  inMap?: boolean;
}) {
  const skins = ["#e6b185", "#a86943", "#f0c7a7", "#794f3b"];
  const coats = ["#29478e", "#ae3549", "#97703a", "#4e7567"];
  const artwork = (
    <g shapeRendering="crispEdges">
      <ellipse cx="8" cy="20.5" rx="6" ry="1" fill="#283961" opacity=".12" />
      <path d="M4 3h8v2h1v6H3V5h1z" fill={skins[variant % 4]} />
      <path
        d="M4 2h7v1h2v4h-2V5H5v2H3V4h1z"
        fill={variant === 2 ? "#9b6437" : "#3e302d"}
      />
      <path d="M5 7h1v2H5zm5 0h1v2h-1z" fill="#253247" />
      <path d="M7 10h2v1H7z" fill="#a36352" />
      <path
        d="M4 12h8v6H4zM2 13h2v4H2zm10 0h2v4h-2z"
        fill={coats[variant % 4]}
      />
      <path d="M6 12h4v2H6z" fill="#f2e8cf" />
      <path d="M2 17h2v2H2zm10 0h2v2h-2z" fill={skins[variant % 4]} />
      <path d="M4 18h3v3H3v-1h1zm5 0h3v2h1v1H9z" fill="#2f354d" />
      <path d="M5 14h1v3H5zm5 0h1v3h-1z" fill="#fff" opacity=".16" />
    </g>
  );
  if (inMap)
    return (
      <g role="img" aria-label={title}>
        {artwork}
      </g>
    );
  return (
    <svg
      viewBox="0 0 16 22"
      className={`pixel-person ${className}`}
      role="img"
      aria-label={title}
    >
      {artwork}
    </svg>
  );
}
