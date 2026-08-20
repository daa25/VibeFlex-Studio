// Maps a paid Shopify order line into a POD provider order.
//
// The contract: everything production needs must already be on the order, in
// the line-item properties written by /api/studio/cart. Nothing here queries
// the studio database, so fulfillment still works if the design row is gone.

export type ShopifyLineItemProperty = { name: string; value: string };

export type ShopifyOrderLine = {
  id: number | string;
  title: string;
  quantity: number;
  sku?: string | null;
  variant_id?: number | string | null;
  properties?: ShopifyLineItemProperty[] | null;
};

export type ShopifyOrderPayload = {
  id: number | string;
  name?: string;
  email?: string | null;
  line_items?: ShopifyOrderLine[];
  shipping_address?: {
    name?: string;
    address1?: string;
    address2?: string | null;
    city?: string;
    province_code?: string | null;
    country_code?: string;
    zip?: string;
    phone?: string | null;
  } | null;
};

export type PrintGeometryRecord = {
  printAreaId: string;
  widthIn: number;
  heightIn: number;
  leftIn: number;
  topIn: number;
  rotation: number;
};

export type FulfillmentItem = {
  lineItemId: string;
  quantity: number;
  studioReference?: string;
  artworkUrl?: string;
  provider: string;
  providerVariantId?: string;
  geometry: PrintGeometryRecord[];
  /** Reasons this line cannot be auto-submitted to production. */
  blockers: string[];
};

export type FulfillmentPlan = {
  orderId: string;
  orderName?: string;
  items: FulfillmentItem[];
  /** Lines with no studio customization — ordinary catalog products. */
  skipped: string[];
  submittable: boolean;
};

function prop(line: ShopifyOrderLine, name: string): string | undefined {
  return line.properties?.find((p) => p.name === name)?.value ?? undefined;
}

export function buildFulfillmentPlan(
  order: ShopifyOrderPayload,
  defaultProvider: string
): FulfillmentPlan {
  const items: FulfillmentItem[] = [];
  const skipped: string[] = [];

  for (const line of order.line_items ?? []) {
    const artworkUrl = prop(line, "_artwork_url");
    const reference = prop(line, "Studio reference");

    if (!artworkUrl && !reference) {
      skipped.push(String(line.id));
      continue;
    }

    const blockers: string[] = [];
    let geometry: PrintGeometryRecord[] = [];
    const rawGeometry = prop(line, "_print_geometry_in");
    if (rawGeometry) {
      try {
        geometry = JSON.parse(rawGeometry) as PrintGeometryRecord[];
      } catch {
        blockers.push("Print geometry on the order line is not valid JSON.");
      }
    } else {
      blockers.push("No print geometry on the order line.");
    }

    if (!artworkUrl) blockers.push("No artwork URL on the order line.");
    else if (!/^https:\/\//.test(artworkUrl))
      blockers.push(
        "Artwork URL is not a public https URL, so the printer cannot download it (configure Supabase Storage)."
      );

    items.push({
      lineItemId: String(line.id),
      quantity: line.quantity,
      studioReference: reference,
      artworkUrl,
      provider: prop(line, "_pod_provider") ?? defaultProvider,
      providerVariantId: prop(line, "_provider_variant_id"),
      geometry,
      blockers,
    });
  }

  return {
    orderId: String(order.id),
    orderName: order.name,
    items,
    skipped,
    submittable: items.length > 0 && items.every((i) => i.blockers.length === 0),
  };
}

/** Printful order payload for a fulfillment item (v1 Orders API shape). */
export function toPrintfulOrder(
  order: ShopifyOrderPayload,
  item: FulfillmentItem
): Record<string, unknown> {
  const address = order.shipping_address ?? {};
  return {
    external_id: `${order.id}-${item.lineItemId}`,
    shipping: "STANDARD",
    recipient: {
      name: address.name,
      address1: address.address1,
      address2: address.address2 ?? undefined,
      city: address.city,
      state_code: address.province_code ?? undefined,
      country_code: address.country_code,
      zip: address.zip,
      phone: address.phone ?? undefined,
      email: order.email ?? undefined,
    },
    items: [
      {
        variant_id: item.providerVariantId ? Number(item.providerVariantId) : undefined,
        quantity: item.quantity,
        external_id: item.lineItemId,
        files: item.geometry.map((geo) => ({
          type: geo.printAreaId,
          url: item.artworkUrl,
          position: {
            area_width: geo.widthIn,
            area_height: geo.heightIn,
            width: geo.widthIn,
            height: geo.heightIn,
            top: geo.topIn,
            left: geo.leftIn,
          },
        })),
      },
    ],
  };
}
