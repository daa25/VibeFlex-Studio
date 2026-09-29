export type OriginalPlacement = {
  areaId: "front" | "back" | "left-sleeve" | "right-sleeve";
  label: string;
  artworkFile: string;
  targetWidthIn?: number;
  targetHeightIn?: number;
  notes: string;
  status: "READY" | "PENDING_MASTER";
};

export type VibeFlexOriginal = {
  id: string;
  name: string;
  collection: string;
  status: "PROTOTYPE_APPROVED" | "PRODUCTION_READY_WITH_PENDING_ASSET";
  productId: string;
  colorId: string;
  garmentColor: string;
  prototypeNotes: string;
  productionNotes: string[];
  placements: OriginalPlacement[];
};

export const VIBEFLEX_ORIGINALS: VibeFlexOriginal[] = [
  {
    id: "uncooked-490-longsleeve",
    name: "UNCOOKED 490 Long Sleeve",
    collection: "490 Movement / UNCOOKED",
    status: "PRODUCTION_READY_WITH_PENDING_ASSET",
    productId: "vf-longsleeve",
    colorId: "navy",
    garmentColor: "Navy / royal athletic blue",
    prototypeNotes:
      "Physical prototype approved: UNCOOKED Still Loading chest, distressed 490 running vertically on both sleeves, cream athletic sleeve stripes.",
    productionNotes: [
      "Keep the front graphic centered and intentionally smaller than a full-front streetwear print.",
      "Run 490 vertically from below the sleeve stripes toward the cuff on both sleeves.",
      "Use the same distressed cream/navy treatment across both sleeve prints.",
      "Upper-back VibeFlex neck mark remains optional until the final transparent master is locked.",
    ],
    placements: [
      {
        areaId: "front",
        label: "Front chest",
        artworkFile: "uncooked-still-loading-master.png",
        targetWidthIn: 8.25,
        notes: "Centered; approximately 3–3.5 inches below collar.",
        status: "READY",
      },
      {
        areaId: "left-sleeve",
        label: "Left sleeve",
        artworkFile: "490-distressed-navy-master.png",
        targetHeightIn: 8.5,
        notes: "Vertical 490; begin below sleeve stripes; read shoulder-to-wrist.",
        status: "READY",
      },
      {
        areaId: "right-sleeve",
        label: "Right sleeve",
        artworkFile: "490-distressed-navy-master.png",
        targetHeightIn: 8.5,
        notes: "Mirror placement geometry from left sleeve, not the artwork itself.",
        status: "READY",
      },
      {
        areaId: "back",
        label: "Upper back neck",
        artworkFile: "vibeflex-neck-mark-master.png",
        targetWidthIn: 2.75,
        notes: "Optional small VibeFlex Sports mark centered below back collar.",
        status: "PENDING_MASTER",
      },
    ],
  },
  {
    id: "uncooked-discipline-tee",
    name: "UNCOOKED Discipline Tee",
    collection: "UNCOOKED / Built Different",
    status: "PROTOTYPE_APPROVED",
    productId: "vf-tee-classic",
    colorId: "heritage-teal",
    garmentColor: "Heritage teal / deep green",
    prototypeNotes:
      "Physical repair prototype validated the cream/green UNCOOKED treatment. Production version intentionally removes the inherited 490/crest ghosting from the repaired test shirt.",
    productionNotes: [
      "Use the clean transparent UNCOOKED Discipline grunge master as the only front artwork.",
      "Do not reproduce the old background 4/9/0 or lower crest remnants visible on the repaired prototype.",
      "Target a wide chest print that visually fills the garment without touching the sleeve seams.",
      "Preserve the distressed cream texture and deep-green perimeter so it blends into the garment.",
    ],
    placements: [
      {
        areaId: "front",
        label: "Front chest",
        artworkFile: "uncooked-discipline-grunge-master.png",
        targetWidthIn: 10.5,
        notes: "Centered; wide collegiate placement approximately 3 inches below collar.",
        status: "READY",
      },
    ],
  },
];

export function getVibeFlexOriginal(id: string): VibeFlexOriginal | undefined {
  return VIBEFLEX_ORIGINALS.find((product) => product.id === id);
}
