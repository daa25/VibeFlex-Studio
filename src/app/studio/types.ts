import type { AiAnalysis, DeterministicAnalysis } from "@/lib/artwork-analysis";

export type Artwork = {
  assetId: string;
  url: string;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
};

export type UploadResponse = {
  artwork: Artwork;
  storage: {
    provider: "supabase" | "local";
    ephemeral: boolean;
    bytes: number;
    checksum: string;
    warning?: string;
  };
  analysis: {
    deterministic: DeterministicAnalysis;
    ai: AiAnalysis | null;
    aiStatus: "ok" | "not_configured" | "failed";
    aiMessage?: string;
  };
  persistence: { persisted: boolean; reason?: string; id?: string };
};

export type StudioStep = "upload" | "configure" | "review";

export const STEPS: { id: StudioStep; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "configure", label: "Customize" },
  { id: "review", label: "Review" },
];
