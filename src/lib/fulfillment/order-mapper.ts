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
  /** Per-unit price the customer actually paid. Used as retail for margin routing. */
  price?: string | number | null;
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
  /** Printful "sync product"/catalog id, Printify blueprint id. See production-types.ts. */
  catalogProductExternalId?: string;
  /** Decoration method for this line (lowercased). Drives production routing. */
  technique: string;
  /** Per-unit retail the customer paid, for margin routing. */
  unitPrice?: number;
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

    // Without a provider variant id there is nothing for the supplier to
    // manufacture. This has to be a blocker, not a missing field: the payload
    // builder emits `variant_id: undefined`, which serialises away entirely, so
    // a line could otherwise look submittable and then fail at the printer —
    // after the customer has already paid.
    const providerVariantId = prop(line, "_provider_variant_id");
    if (!providerVariantId) {
      blockers.push(
        "No supplier variant id on the order line, so the printer has nothing to produce. " +
          "The Shopify variant is not mapped to a fulfillment variant."
      );
    } else if (!/^\d+$/.test(providerVariantId)) {
      blockers.push(
        `Supplier variant id "${providerVariantId}" is not numeric, so it cannot be a valid Printful variant.`
      );
    }

    const rawPrice = line.price;
    const unitPrice =
      rawPrice === undefined || rawPrice === null || Number.isNaN(Number(rawPrice))
        ? undefined
        : Number(rawPrice);

    items.push({
      lineItemId: String(line.id),
      quantity: line.quantity,
      studioReference: reference,
      artworkUrl,
      provider: prop(line, "_pod_provider") ?? defaultProvider,
      providerVariantId,
      catalogProductExternalId: prop(line, "_provider_catalog_product_id"),
      technique: (prop(line, "_technique") ?? "dtg").toLowerCase(),
      unitPrice,
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
