// Garment silhouettes.
//
// Vector garments rendered in the selected colour, drawn on a 400x480 grid.
// This keeps the preview instant, offline and dependency-free; when Printful
// credentials exist, a photoreal mockup from the provider can be layered on
// top of the same print-area box without changing any placement maths.

export type Silhouette = "tee" | "hoodie" | "tank" | "longsleeve";

const PATHS: Record<Silhouette, string> = {
  tee: "M150 30 L110 46 L44 84 L74 150 L108 132 L108 450 L292 450 L292 132 L326 150 L356 84 L290 46 L250 30 C244 58 224 72 200 72 C176 72 156 58 150 30 Z",
  longsleeve:
    "M150 30 L110 46 L34 92 L74 260 L120 250 L96 140 L108 134 L108 450 L292 450 L292 134 L304 140 L280 250 L326 260 L366 92 L290 46 L250 30 C244 58 224 72 200 72 C176 72 156 58 150 30 Z",
  tank: "M158 30 L128 44 L108 96 L108 450 L292 450 L292 96 L272 44 L242 30 C238 62 222 78 200 78 C178 78 162 62 158 30 Z",
  hoodie:
    "M150 34 L108 52 L36 92 L70 164 L106 146 L106 456 L294 456 L294 146 L330 164 L364 92 L292 52 L250 34 C246 70 226 86 200 86 C174 86 154 70 150 34 Z",
};

export function GarmentSvg({
  silhouette,
  color,
  className,
}: {
  silhouette: Silhouette;
  color: string;
  className?: string;
}) {
  const shadow = shade(color, -0.25);
  const highlight = shade(color, 0.12);

  return (
    <svg
      viewBox="0 0 400 480"
      className={className}
      role="img"
      aria-label={`${silhouette} garment preview`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id={`fabric-${silhouette}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={highlight} />
          <stop offset="55%" stopColor={color} />
          <stop offset="100%" stopColor={shadow} />
        </linearGradient>
      </defs>
      <path
        d={PATHS[silhouette]}
        fill={`url(#fabric-${silhouette})`}
        stroke={shade(color, -0.45)}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* collar */}
      <path
        d="M150 30 C158 62 176 76 200 76 C224 76 242 62 250 30"
        fill="none"
        stroke={shade(color, -0.45)}
        strokeWidth="3"
      />
      {silhouette === "hoodie" && (
        <>
          <path
            d="M150 34 C160 92 176 108 200 108 C224 108 240 92 250 34"
            fill={shade(color, -0.18)}
            stroke={shade(color, -0.45)}
            strokeWidth="2"
          />
          <path d="M186 104 L186 190" stroke={shade(color, -0.5)} strokeWidth="3" />
          <path d="M214 104 L214 190" stroke={shade(color, -0.5)} strokeWidth="3" />
        </>
      )}
      {/* hem */}
      <path
        d={silhouette === "hoodie" ? "M106 436 L294 436" : "M108 432 L292 432"}
        stroke={shade(color, -0.4)}
        strokeWidth="2"
        opacity="0.7"
      />
    </svg>
  );
}

/** Lighten (amount > 0) or darken (amount < 0) a hex colour. */
export function shade(hex: string, amount: number): string {
  const normalized = hex.replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return hex;

  const channels = [(num >> 16) & 255, (num >> 8) & 255, num & 255].map((c) => {
    const next = amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(next)));
  });

  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
