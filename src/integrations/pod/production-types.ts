// Provider-neutral PRODUCTION contracts.
//
// VibeFlex Studio is VibeFlex Sports' own product-creation and production-
// management platform. It owns the canonical lifecycle end to end:
//
//   Artwork -> Product -> Variant -> Mockup -> Pricing -> Shopify Listing ->
//   Order -> Production Job -> Fulfillment -> Tracking
//
// A ProductionProvider is any "machine" Studio can send a production job to.
// VibeFlexLocalProvider (in-house) and PrintfulProvider (external) are PEERS
// behind this interface. Printful is one optional fulfillment provider, not the
// core of the system: if Printful is unavailable, Studio still produces through
// VibeFlexLocalProvider.
//
// Shopify remains the storefront / checkout / commerce system of record.
// VibeFlex Studio remains the production and product-intelligence control system.

import type { ProviderCapabilities } from "./types";

export type ProviderKind = "local" | "external";

// Production-time capability matrix. Extends the catalog/mockup-oriented
// ProviderCapabilities with the facts a router needs to place a real order.
export type ProductionCapabilities = ProviderCapabilities & {
  /** True for an in-house line under VibeFlex's own operational control. */
  localProduction: boolean;
  /** True when submitting an order bills money to an outside party. */
  externalPaidFulfillment: boolean;
  /** Decoration methods this provider can actually run (lowercased). */
  techniques: string[]; // e.g. "embroidery", "dtg", "dtf", "screenprint"
  /** Units/day this provider will commit to. null = effectively unbounded. */
  dailyCapacity: number | null;
  /** ISO country codes this provider ships to. Empty = unrestricted. */
  shipsTo: string[];
};

export type ProductionJobState =
  | "PENDING_APPROVAL" // external order awaiting explicit owner authorization
  | "QUEUED" // accepted, not yet in production
  | "IN_PRODUCTION"
  | "FULFILLED" // produced, handed to carrier
  | "SHIPPED"
  | "CANCELLED"
  | "FAILED";

export type PrintPlacementPosition = {
  area_width: number;
  area_height: number;
  width: number;
  height: number;
  top: number;
  left: number;
};

export type ProductionLineItem = {
  sku: string;
  quantity: number;
  /** Provider-specific variant id (Printful variant id, or a local variant sku). */
  providerVariantId: string;
  artworkUrl: string;
  /** Decoration method required for this item (lowercased). */
  technique: string;
  printAreaId: string;
  /** Optional print geometry; required by some external providers. */
  position?: PrintPlacementPosition;
};

export type ShipTo = {
  name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  country?: string; // ISO code
  zip?: string;
  email?: string;
  phone?: string;
};

export type ProductionOrderInput = {
  /** Studio's own order id. Used as the idempotency key at the provider. */
  studioOrderId: string;
  shopifyOrderId?: string;
  lineItems: ProductionLineItem[];
  shipTo: ShipTo;
};

export type TrackingInfo = {
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
};

export type ProductionJob = {
  providerJobId: string;
  providerName: string;
  providerKind: ProviderKind;
  studioOrderId: string;
  state: ProductionJobState;
  /** Set when the provider requires explicit owner approval before producing. */
  requiresApproval: boolean;
  message?: string;
  tracking?: TrackingInfo;
};

export type SubmitOptions = {
  /**
   * Explicit owner authorization to bill an external provider. NEVER defaulted
   * to true. Absent or false means: an external provider returns a
   * PENDING_APPROVAL job and bills nothing.
   */
  ownerApproved?: boolean;
};

export type UnitCostEstimate = {
  baseCost: number;
  estimatedShipping: number;
  currency: string;
};

// The canonical production interface. Every provider — local or external —
// implements exactly this, so routing and the rest of Studio never depend on a
// specific vendor's API shape.
export interface ProductionProvider {
  readonly providerName: string;
  readonly kind: ProviderKind;
  readonly capabilities: ProductionCapabilities;

  /** Can this provider actually make this item (technique + destination)? */
  canProduce(item: ProductionLineItem, destinationCountry?: string): boolean;

  /** Landed unit cost for routing/margin decisions. */
  estimateUnitCost(
    item: ProductionLineItem,
    destinationCountry: string
  ): Promise<UnitCostEstimate>;

  /**
   * Submit a production order.
   *
   * External providers MUST NOT bill a paid order without opts.ownerApproved
   * === true; they return a PENDING_APPROVAL job instead of submitting.
   *
   * Local production does not bill an outside party and may queue directly.
   * (Live SHIPPED status and any customer-facing publication stay policy-gated
   * upstream — this method only commits the job to a production line.)
   */
  submitProductionOrder(
    input: ProductionOrderInput,
    opts?: SubmitOptions
  ): Promise<ProductionJob>;

  getProductionJob(providerJobId: string): Promise<ProductionJob>;
  getTracking(providerJobId: string): Promise<TrackingInfo | null>;
}
