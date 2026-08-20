// Provider-neutral contracts. Every POD integration (Printful, Printify, etc.)
// implements PodProviderAdapter so the rest of the app never depends on a
// specific vendor's API shape.

export type PodProduct = {
  externalId: string;
  name: string;
  brand?: string;
  model?: string;
  category?: string;
  description?: string;
  printAreas: string[];
  attributes: Record<string, unknown>;
};

export type PodVariant = {
  externalId: string;
  color?: string;
  colorHex?: string;
  size?: string;
  baseCost: number;
  currency: string;
  availability: "in_stock" | "backorder" | "discontinued";
};

export type ArtworkValidationInput = {
  fileUrl: string;
  width: number;
  height: number;
  dpi?: number;
  printAreaId: string;
};

export type ArtworkValidationResult = {
  valid: boolean;
  warnings: string[];
  minRequiredDpi?: number;
};

export type MockupJobInput = {
  catalogProductExternalId: string;
  variantExternalIds: string[];
  printAreaId: string;
  artworkFileUrl: string;
};

export type MockupJob = {
  providerJobId: string;
  status: "queued" | "processing" | "completed" | "failed";
};

export type MockupJobStatus = MockupJob & {
  mockupUrls?: string[];
  errorMessage?: string;
};

export type FulfillmentProductInput = {
  name: string;
  catalogProductExternalId: string;
  variantExternalIds: string[];
  printAreaId: string;
  artworkFileUrl: string;
  retailPriceByVariant: Record<string, number>;
};

export type FulfillmentProduct = {
  providerProductId: string;
  variantMap: Record<string, string>; // our variant key -> provider variant id
};

export type CostEstimateInput = {
  catalogProductExternalId: string;
  variantExternalId: string;
  destinationCountry: string;
};

export type CostEstimate = {
  baseCost: number;
  estimatedShipping: number;
  currency: string;
};

export interface PodProviderAdapter {
  readonly providerName: string;

  getCatalog(): Promise<PodProduct[]>;
  getProduct(productId: string): Promise<PodProduct>;
  getVariants(productId: string): Promise<PodVariant[]>;
  validateArtwork(input: ArtworkValidationInput): Promise<ArtworkValidationResult>;
  createMockupJob(input: MockupJobInput): Promise<MockupJob>;
  getMockupJob(jobId: string): Promise<MockupJobStatus>;
  createFulfillmentProduct(input: FulfillmentProductInput): Promise<FulfillmentProduct>;
  updateFulfillmentProduct(
    id: string,
    input: FulfillmentProductInput
  ): Promise<FulfillmentProduct>;
  archiveFulfillmentProduct(id: string): Promise<void>;
  estimateCost(input: CostEstimateInput): Promise<CostEstimate>;
}

// Capability matrix so the rest of the app can branch on what a given
// provider actually supports instead of assuming feature parity.
export type ProviderCapabilities = {
  catalog: boolean;
  mockups: boolean;
  insideLabels: boolean;
  embroidery: boolean;
  customPackaging: boolean;
  fulfillmentProductCreation: boolean;
  orderRouting: boolean;
  webhooks: boolean;
};
