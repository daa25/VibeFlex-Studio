// Real HTTP implementation of PrintfulOrderClient — the piece that was
// missing entirely: PrintfulProductionProvider's gate logic existed and was
// tested, but nothing ever constructed a real client to hand it, so
// getProductionProviders() was always called with no external client and
// every order routed to the in-house line regardless of POD_PROVIDER.
//
// Printful can place an order directly from a catalog variant id plus inline
// print files — no pre-created "sync product" is required. That is the same
// raw/inline mode toPrintfulOrder() already builds from a Shopify order; this
// client builds the equivalent payload from the provider-neutral
// ProductionOrderInput instead, since by this layer the Shopify-specific shape
// has already been abstracted away.

import type {
  ProductionJobState,
  ProductionOrderInput,
  ShipTo,
  TrackingInfo,
  UnitCostEstimate,
} from "../production-types";
import type { PrintfulOrderClient } from "../providers/printful-production-provider";

const PRINTFUL_API_BASE = "https://api.printful.com";

// Printful's own order.status values, mapped to our shared ProductionJobState.
const STATUS_MAP: Record<string, ProductionJobState> = {
  draft: "QUEUED",
  pending: "QUEUED",
  onhold: "QUEUED",
  inprocess: "IN_PRODUCTION",
  partial: "IN_PRODUCTION",
  fulfilled: "SHIPPED",
  canceled: "CANCELLED",
  failed: "FAILED",
};

function mapStatus(status: string | undefined): ProductionJobState {
  return STATUS_MAP[status ?? ""] ?? "QUEUED";
}

function recipientFrom(shipTo: ShipTo) {
  return {
    name: shipTo.name,
    address1: shipTo.address1,
    address2: shipTo.address2 ?? undefined,
    city: shipTo.city,
    state_code: shipTo.state ?? undefined,
    country_code: shipTo.country,
    zip: shipTo.zip,
    phone: shipTo.phone ?? undefined,
    email: shipTo.email ?? undefined,
  };
}

export function createPrintfulOrderClient(apiKey: string, storeId: string): PrintfulOrderClient {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${PRINTFUL_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-PF-Store-Id": storeId,
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Printful API error (${res.status}): ${body}`);
    }
    return res.json() as Promise<T>;
  }

  return {
    async createOrder(input: ProductionOrderInput) {
      const data = await request<{ result: { id: number; status: string } }>("/orders", {
        method: "POST",
        body: JSON.stringify({
          external_id: input.studioOrderId,
          shipping: "STANDARD",
          recipient: recipientFrom(input.shipTo),
          items: input.lineItems.map((item) => ({
            variant_id: Number(item.providerVariantId),
            quantity: item.quantity,
            external_id: item.sku,
            files: [
              {
                type: item.printAreaId,
                url: item.artworkUrl,
                ...(item.position ? { position: item.position } : {}),
              },
            ],
          })),
        }),
      });

      return {
        providerJobId: String(data.result.id),
        state: mapStatus(data.result.status),
      };
    },

    async getOrder(providerJobId: string) {
      const data = await request<{
        result: {
          status: string;
          shipments?: { carrier?: string; tracking_number?: string; tracking_url?: string; ship_date?: string }[];
        };
      }>(`/orders/${providerJobId}`);

      const shipment = data.result.shipments?.[0];
      const tracking: TrackingInfo | undefined = shipment
        ? {
            carrier: shipment.carrier ?? null,
            trackingNumber: shipment.tracking_number ?? null,
            trackingUrl: shipment.tracking_url ?? null,
            shippedAt: shipment.ship_date ?? null,
          }
        : undefined;

      return { state: mapStatus(data.result.status), tracking };
    },

    async estimateCost(item, destinationCountry): Promise<UnitCostEstimate> {
      const data = await request<{ result: { costs: { total: string; shipping: string } } }>(
        "/orders/estimate-costs",
        {
          method: "POST",
          body: JSON.stringify({
            recipient: { country_code: destinationCountry },
            items: [{ variant_id: Number(item.providerVariantId), quantity: 1 }],
          }),
        }
      );

      const total = Number(data.result.costs.total);
      const shipping = Number(data.result.costs.shipping);
      return { baseCost: total - shipping, estimatedShipping: shipping, currency: "USD" };
    },
  };
}
