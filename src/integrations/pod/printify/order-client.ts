// Real HTTP implementation of PrintifyOrderClient.
//
// Printify's raw/unlinked order-line mode places an order directly from a
// blueprint + print provider + variant + one image per print area — no
// pre-created shop product required, mirroring Printful's raw-variant order
// mode. The real, load-bearing difference: this mode has NO position/geometry
// control. print_areas is a flat { placement: imageUrl } map — Printify only
// accepts custom placement geometry when producing from a pre-created shop
// product (via createFulfillmentProduct), not from a raw print-provider order.
// A ProductionLineItem.position is therefore silently unusable here; if exact
// placement matters for a given order, that line needs to go through
// createFulfillmentProduct first rather than this raw path.

import type {
  ProductionJobState,
  ProductionOrderInput,
  ShipTo,
  TrackingInfo,
  UnitCostEstimate,
} from "../production-types";
import type { PrintifyOrderClient } from "../providers/printify-production-provider";

const PRINTIFY_API_BASE = "https://api.printify.com/v1";

const STATUS_MAP: Record<string, ProductionJobState> = {
  pending: "QUEUED",
  "on-hold": "QUEUED",
  "sending-to-production": "QUEUED",
  "in-production": "IN_PRODUCTION",
  fulfilled: "SHIPPED",
  canceled: "CANCELLED",
};

function mapStatus(status: string | undefined): ProductionJobState {
  return STATUS_MAP[status ?? ""] ?? "QUEUED";
}

function addressFrom(shipTo: ShipTo) {
  const [firstName, ...rest] = (shipTo.name ?? "").split(" ");
  return {
    first_name: firstName || "Customer",
    last_name: rest.join(" ") || "-",
    email: shipTo.email,
    phone: shipTo.phone,
    country: shipTo.country,
    region: shipTo.state,
    address1: shipTo.address1,
    address2: shipTo.address2,
    city: shipTo.city,
    zip: shipTo.zip,
  };
}

export function createPrintifyOrderClient(apiKey: string, shopId: string): PrintifyOrderClient {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${PRINTIFY_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Printify API error (${res.status}): ${body}`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async function firstPrintProviderId(blueprintId: string): Promise<number> {
    const providers = await request<{ id: number }[]>(
      `/catalog/blueprints/${blueprintId}/print_providers.json`
    );
    if (!providers.length) {
      throw new Error(`Printify blueprint ${blueprintId} has no print providers.`);
    }
    return providers[0]!.id;
  }

  return {
    async createOrder(input: ProductionOrderInput) {
      const lineItems = await Promise.all(
        input.lineItems.map(async (item) => {
          if (!item.catalogProductExternalId) {
            throw new Error(
              `Printify order line "${item.sku}" has no catalogProductExternalId (blueprint id) — ` +
                "a raw Printify order cannot be placed from a variant id alone."
            );
          }
          const printProviderId = await firstPrintProviderId(item.catalogProductExternalId);
          return {
            print_provider_id: printProviderId,
            blueprint_id: Number(item.catalogProductExternalId),
            variant_id: Number(item.providerVariantId),
            quantity: item.quantity,
            print_areas: { [item.printAreaId]: item.artworkUrl },
          };
        })
      );

      const data = await request<{ id: string; status: string }>(
        `/shops/${shopId}/orders.json`,
        {
          method: "POST",
          body: JSON.stringify({
            external_id: input.studioOrderId,
            line_items: lineItems,
            shipping_method: 1,
            send_shipping_notification: false,
            address_to: addressFrom(input.shipTo),
          }),
        }
      );

      return { providerJobId: data.id, state: mapStatus(data.status) };
    },

    async getOrder(providerJobId: string) {
      const data = await request<{
        status: string;
        shipments?: { carrier?: string; number?: string; url?: string; delivered_at?: string }[];
      }>(`/shops/${shopId}/orders/${providerJobId}.json`);

      const shipment = data.shipments?.[0];
      const tracking: TrackingInfo | undefined = shipment
        ? {
            carrier: shipment.carrier ?? null,
            trackingNumber: shipment.number ?? null,
            trackingUrl: shipment.url ?? null,
            shippedAt: shipment.delivered_at ?? null,
          }
        : undefined;

      return { state: mapStatus(data.status), tracking };
    },

    async estimateCost(item, destinationCountry): Promise<UnitCostEstimate> {
      if (!item.catalogProductExternalId) {
        throw new Error(
          `Cannot estimate Printify cost for "${item.sku}" without catalogProductExternalId.`
        );
      }
      const printProviderId = await firstPrintProviderId(item.catalogProductExternalId);
      const variants = await request<{ variants: { id: number; cost?: number }[] }>(
        `/catalog/blueprints/${item.catalogProductExternalId}/print_providers/${printProviderId}/variants.json`
      );
      const variant = variants.variants.find((v) => String(v.id) === item.providerVariantId);
      const baseCost = typeof variant?.cost === "number" ? variant.cost / 100 : 0;

      const shipping = await request<{ standard?: number }>(
        `/shops/${shopId}/orders/shipping.json`,
        {
          method: "POST",
          body: JSON.stringify({
            line_items: [
              {
                print_provider_id: printProviderId,
                blueprint_id: Number(item.catalogProductExternalId),
                variant_id: Number(item.providerVariantId),
                quantity: 1,
              },
            ],
            address_to: { country: destinationCountry },
          }),
        }
      );

      return {
        baseCost,
        estimatedShipping: typeof shipping.standard === "number" ? shipping.standard / 100 : 0,
        currency: "USD",
      };
    },
  };
}
