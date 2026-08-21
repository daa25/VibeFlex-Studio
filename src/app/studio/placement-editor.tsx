"use client";

import { useCallback, useRef, useState } from "react";
import type { CatalogProduct, PrintArea } from "@/lib/catalog";

type Placement = { centerX: number; centerY: number; scale: number; rotation: number };

type Props = {
  product: CatalogProduct;
  colorHex: string;
  printArea: PrintArea;
  artworkUrl: string | null;
  artworkAspect: number; // height / width
  placement: Placement;
  onChange: (next: Placement) => void;
  renderGarment: (colorHex: string) => React.ReactNode;
};

/**
 * Drag-to-position artwork on the garment.
 *
 * Positions are stored as fractions of the PRINT AREA, not pixels, so the same
 * numbers drive this preview and the inches-based print geometry sent to the
 * printer. Pointer events cover mouse, touch and pen with one code path;
 * arrow keys give a keyboard-accessible nudge.
 */
export function PlacementEditor({
  colorHex,
  printArea,
  artworkUrl,
  artworkAspect,
  placement,
  onChange,
  renderGarment,
}: Props) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const moveTo = useCallback(
    (clientX: number, clientY: number) => {
      const box = areaRef.current?.getBoundingClientRect();
      if (!box) return;
      onChange({
        ...placement,
        centerX: clamp((clientX - box.left) / box.width, 0, 1),
        centerY: clamp((clientY - box.top) / box.height, 0, 1),
      });
    },
    [onChange, placement]
  );

  // Artwork width as a % of the print area; height derives from the aspect and
  // the print area's own aspect so proportions stay physically correct.
  const widthPct = placement.scale * 100;
  const areaAspect = printArea.heightIn / printArea.widthIn;
  const heightPct = widthPct * artworkAspect * (1 / areaAspect);

  return (
    <div className="relative w-full select-none">
      <div className="relative mx-auto aspect-[400/480] w-full max-w-md">
        {renderGarment(colorHex)}

        {/* print area */}
        <div
          ref={areaRef}
          className={`absolute rounded-sm transition-colors ${
            artworkUrl ? "border border-dashed border-white/25" : "border border-dashed border-white/15"
          }`}
          style={{
            top: `${printArea.box.top}%`,
            left: `${printArea.box.left}%`,
            width: `${printArea.box.width}%`,
            height: `${printArea.box.height}%`,
          }}
          onPointerDown={(e) => {
            if (!artworkUrl) return;
            (e.target as Element).setPointerCapture?.(e.pointerId);
            setDragging(true);
            moveTo(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (dragging) moveTo(e.clientX, e.clientY);
          }}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
        >
          {artworkUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- artwork comes
            // from Supabase or the local upload route; next/image adds no value
            // for a user upload we already know the intrinsic size of.
            <img
              src={artworkUrl}
              alt="Your artwork on the garment"
              draggable={false}
              tabIndex={0}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 0.05 : 0.01;
                const moves: Record<string, [number, number]> = {
                  ArrowLeft: [-step, 0],
                  ArrowRight: [step, 0],
                  ArrowUp: [0, -step],
                  ArrowDown: [0, step],
                };
                const delta = moves[e.key];
                if (!delta) return;
                e.preventDefault();
                onChange({
                  ...placement,
                  centerX: clamp(placement.centerX + delta[0], 0, 1),
                  centerY: clamp(placement.centerY + delta[1], 0, 1),
                });
              }}
              className={`absolute origin-center touch-none object-contain outline-none ring-offset-0 focus-visible:ring-2 focus-visible:ring-blue-400 ${
                dragging ? "cursor-grabbing" : "cursor-grab"
              }`}
              style={{
                width: `${widthPct}%`,
                height: `${heightPct}%`,
                left: `${placement.centerX * 100}%`,
                top: `${placement.centerY * 100}%`,
                transform: `translate(-50%, -50%) rotate(${placement.rotation}deg)`,
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-2 text-center text-[10px] uppercase tracking-widest text-white/30">
              Print area
            </div>
          )}
        </div>
      </div>

      <p className="mt-2 text-center text-[11px] text-neutral-500">
        {artworkUrl
          ? "Drag to position · arrow keys to nudge · slider to resize"
          : `${printArea.widthIn}in × ${printArea.heightIn}in printable area`}
      </p>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
