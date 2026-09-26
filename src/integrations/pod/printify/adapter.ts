import type {
  ArtworkValidationInput,
  ArtworkValidationResult,
  CostEstimate,
  CostEstimateInput,
  FulfillmentProduct,
  FulfillmentProductInput,
  MockupJob,
  MockupJobInput,
  MockupJobStatus,
  PodProduct,
  PodProviderAdapter,
  PodVariant,
  ProviderCapabilities,
} from "../types";

const PRINTIFY_API_BASE = "https://api.printify.com/v1";

/**
 * Printify has no concept of a "Shopify platform store" the way Printful
 * does — every Printify shop can create products through this API regardless
 * of which sales channel it is later published to. There is no equivalent
 * PrintifyPlatformError: product creation always goes through
 * /shops/{shop_id}/products.json, and pushing to the connected Shopify store
 * is Studio's own publish-draft flow, not this adapter's job.
 */

export const printifyCapabilities: ProviderCapabilities = {
  catalog: true,
  mockups: true,
  insideLabels: false,
  embroidery: true,
  customPackaging: false,
  fulfillmentProductCreation: true,
  orderRouting: true,
  webhooks: true,
};

type PrintifyVariant = {
  id: number;
  title: string;
  options?: { color?: string; size?: string };
  cost?: number; // cents
  price?: number; // cents, print provider's suggested retail — not used as our cost
  is_available?: boolean;
};

type PrintifyPlaceholder = {
  position: string;
  height: number;
  width: number;
};

type PrintifyBlueprintVariantsResponse = {
  variants: PrintifyVariant[];
};

type PrintifyProductImage = {
  src: string;
  variant_ids: number[];
  is_default?: boolean;
};

type PrintifyProduct = {
  id: string;
  title: string;
  variants: { id: number; price: number; is_enabled: boolean }[];
  images: PrintifyProductImage[];
};

export class PrintifyAdapter implements PodProviderAdapter {
  readonly providerName = "printify";

  constructor(
    private readonly apiKey: string,
    private readonly shopId: string
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${PRINTIFY_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Printify API error (${res.status}): ${body}`);
    }

    // Printify returns 200 with an empty body for DELETE.
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async getCatalog(): Promise<PodProduct[]> {
    const data = await this.request<any[]>("/catalog/blueprints.json");
    return data.map((item) => ({
      externalId: String(item.id),
      name: item.title,
      brand: item.brand,
      model: item.model,
      category: item.category ?? undefined,
      printAreas: [],
      attributes: item,
    }));
  }

  async getProduct(productId: string): Promise<PodProduct> {
    const p = await this.request<any>(`/catalog/blueprints/${productId}.json`);
    return {
      externalId: String(p.id),
      name: p.title,
      brand: p.brand,
      model: p.model,
      category: p.category ?? undefined,
      printAreas: [],
      attributes: p,
    };
  }

  /**
   * A Printify blueprint (garment) has variants that differ PER PRINT PROVIDER
   * — the same blueprint printed by two different providers can have different
   * variant ids, costs and stock. This adapter uses the first print provider
   * returned for the blueprint, since Studio's catalog model (like Printful's)
   * has no separate "choose a print provider" step yet. Revisit this if a
   * blueprint needs multiple providers exposed at once.
   */
  private async getFirstPrintProviderId(productId: string): Promise<number> {
    const providers = await this.request<{ id: number; title: string }[]>(
      `/catalog/blueprints/${productId}/print_providers.json`
    );
    if (!providers.length) {
      throw new Error(`Printify blueprint ${productId} has no print providers.`);
    }
    return providers[0]!.id;
  }

  async getVariants(productId: string): Promise<PodVariant[]> {
    const printProviderId = await this.getFirstPrintProviderId(productId);
    const data = await this.request<PrintifyBlueprintVariantsResponse>(
      `/catalog/blueprints/${productId}/print_providers/${printProviderId}/variants.json`
    );

    return data.variants.map((v) => ({
      externalId: String(v.id),
      color: v.options?.color,
      size: v.options?.size,
      // Printify reports variant cost in CENTS; PodVariant.baseCost is a
      // decimal currency amount like Printful's, so this converts.
      baseCost: typeof v.cost === "number" ? v.cost / 100 : 0,
      currency: "USD",
      availability: v.is_available === false ? "discontinued" : "in_stock",
    }));
  }

  // Printify does not expose a print-area DPI/geometry pre-check the way
  // Printful's mockup-generator/printfiles endpoint does; placeholders come
  // back from the print-provider variants call as width/height in pixels with
  // no DPI figure. This stays a lightweight client-side heuristic, same as
  // Printful's — it is not a live Printify API call.
  async validateArtwork(input: ArtworkValidationInput): Promise<ArtworkValidationResult> {
    const warnings: string[] = [];
    const minRequiredDpi = 150;

    if (input.dpi && input.dpi < minRequiredDpi) {
      warnings.push(`Artwork DPI (${input.dpi}) is below the recommended ${minRequiredDpi}.`);
    }
    if (input.width < 1500 || input.height < 1500) {
      warnings.push("Artwork resolution may be too low for large print areas.");
    }

    return { valid: warnings.length === 0, warnings, minRequiredDpi };
  }

  /**
   * Printify's print-area placeholder geometry for a given variant, keyed by
   * placement (e.g. "front", "back"). Printful's equivalent is
   * getPrintfiles(); the shapes differ (pixel width/height per placeholder
   * here vs. a shared printfile + DPI there) so this is not the same return
   * type — callers that need placement geometry go through this method
   * instead of getPrintfiles.
   */
  async getPlaceholders(
    productId: string,
    variantExternalId: string
  ): Promise<Record<string, PrintifyPlaceholder>> {
    const printProviderId = await this.getFirstPrintProviderId(productId);
    const data = await this.request<{
      variants: { id: number; placeholders?: PrintifyPlaceholder[] }[];
    }>(`/catalog/blueprints/${productId}/print_providers/${printProviderId}/variants.json`);

    const variant = data.variants.find((v) => String(v.id) === variantExternalId);
    const byPlacement: Record<string, PrintifyPlaceholder> = {};
    for (const p of variant?.placeholders ?? []) {
      byPlacement[p.position] = p;
    }
    return byPlacement;
  }

  private async uploadImage(imageUrl: string): Promise<string> {
    const uploaded = await this.request<{ id: string }>("/uploads/images.json", {
      method: "POST",
      body: JSON.stringify({
        file_name: imageUrl.split("/").pop() ?? "artwork.png",
        url: imageUrl,
      }),
    });
    return uploaded.id;
  }

  /**
   * Printify has no async mockup-task queue like Printful's
   * mockup-generator/create-task. A real, final mockup image only exists once
   * a product is actually created, and Printify generates it SYNCHRONOUSLY as
   * part of that same call — there is nothing to poll.
   *
   * So this creates a real (unpublished) Printify product as the "mockup job"
   * and returns its product id as providerJobId. getMockupJob then simply
   * re-fetches that product and reads its already-final images array —
   * status is always "completed" the first time it is checked, never
   * "processing". Callers relying on MockupJobStatus.status transitioning
   * from queued -> processing -> completed (true for Printful) will see
   * queued -> completed for Printify, with no intermediate state, which is
   * correct behavior for this provider rather than a bug.
   *
   * The product this creates is real and billable-adjacent (it exists in the
   * shop, unpublished) — callers that only want a preview and do not intend
   * to keep the product should archiveFulfillmentProduct() it afterward.
   */
  async createMockupJob(input: MockupJobInput): Promise<MockupJob> {
    const imageId = await this.uploadImage(input.artworkFileUrl);
    const placeholders = await this.getPlaceholders(
      input.catalogProductExternalId,
      input.variantExternalIds[0] ?? ""
    );
    const placeholder = placeholders[input.printAreaId];
    if (!placeholder) {
      throw new Error(
        `Printify variant ${input.variantExternalIds[0]} has no "${input.printAreaId}" print area.`
      );
    }

    const printProviderId = await this.getFirstPrintProviderId(input.catalogProductExternalId);
    const product = await this.request<PrintifyProduct>(`/shops/${this.shopId}/products.json`, {
      method: "POST",
      body: JSON.stringify({
        title: "Studio mockup preview",
        blueprint_id: Number(input.catalogProductExternalId),
        print_provider_id: printProviderId,
        variants: input.variantExternalIds.map((id) => ({
          id: Number(id),
          price: 0,
          is_enabled: true,
        })),
        print_areas: [
          {
            variant_ids: input.variantExternalIds.map(Number),
            placeholders: [
              {
                position: input.printAreaId,
                images: [{ id: imageId, x: 0.5, y: 0.5, scale: 1, angle: 0 }],
              },
            ],
          },
        ],
      }),
    });

    return { providerJobId: product.id, status: "completed" };
  }

  async getMockupJob(jobId: string): Promise<MockupJobStatus> {
    const product = await this.request<PrintifyProduct>(
      `/shops/${this.shopId}/products/${jobId}.json`
    );

    // Same hero-first ordering discipline as the Printful adapter: put the
    // default/primary image first so an alternate angle can never displace it.
    const sorted = [...product.images].sort((a, b) => Number(b.is_default) - Number(a.is_default));

    return {
      providerJobId: jobId,
      status: "completed",
      mockupUrls: sorted.map((img) => img.src),
    };
  }

  async createFulfillmentProduct(input: FulfillmentProductInput): Promise<FulfillmentProduct> {
    const imageId = await this.uploadImage(input.artworkFileUrl);
    const printProviderId = await this.getFirstPrintProviderId(input.catalogProductExternalId);

    const product = await this.request<PrintifyProduct>(`/shops/${this.shopId}/products.json`, {
      method: "POST",
      body: JSON.stringify({
        title: input.name,
        blueprint_id: Number(input.catalogProductExternalId),
        print_provider_id: printProviderId,
        variants: input.variantExternalIds.map((id) => ({
          id: Number(id),
          // Printify wants retail price in CENTS; our input is a decimal amount.
          price: Math.round((input.retailPriceByVariant[id] ?? 0) * 100),
          is_enabled: true,
        })),
        print_areas: [
          {
            variant_ids: input.variantExternalIds.map(Number),
            placeholders: [
              {
                position: input.printAreaId,
                images: [{ id: imageId, x: 0.5, y: 0.5, scale: 1, angle: 0 }],
              },
            ],
          },
        ],
      }),
    });

    const variantMap: Record<string, string> = {};
    product.variants.forEach((v) => {
      variantMap[String(v.id)] = String(v.id); // Printify keeps one variant id across catalog and product.
    });

    return { providerProductId: product.id, variantMap };
  }

  async updateFulfillmentProduct(
    id: string,
    input: FulfillmentProductInput
  ): Promise<FulfillmentProduct> {
    const product = await this.request<PrintifyProduct>(`/shops/${this.shopId}/products/${id}.json`, {
      method: "PUT",
      body: JSON.stringify({
        title: input.name,
        variants: input.variantExternalIds.map((variantId) => ({
          id: Number(variantId),
          price: Math.round((input.retailPriceByVariant[variantId] ?? 0) * 100),
          is_enabled: true,
        })),
      }),
    });

    const variantMap: Record<string, string> = {};
    product.variants.forEach((v) => {
      variantMap[String(v.id)] = String(v.id);
    });

    return { providerProductId: product.id, variantMap };
  }

  async archiveFulfillmentProduct(id: string): Promise<void> {
    await this.request(`/shops/${this.shopId}/products/${id}.json`, { method: "DELETE" });
  }

  /**
   * Printify has no standalone "estimate an order's cost" endpoint the way
   * Printful's /orders/estimate-costs works from a bare variant id. The
   * closest real equivalent is /shops/{shop_id}/orders/shipping.json, which
   * needs full line items and a destination address and returns shipping
   * cost options — it does NOT return the item's base cost. Base cost comes
   * from the catalog variants call instead (already fetched by getVariants).
   * So estimateCost here does two real calls: catalog cost lookup, then a
   * shipping-only estimate, and combines them — there is no single Printify
   * endpoint that returns both like Printful's does.
   */
  async estimateCost(input: CostEstimateInput): Promise<CostEstimate> {
    const printProviderId = await this.getFirstPrintProviderId(input.catalogProductExternalId);
    const variants = await this.request<PrintifyBlueprintVariantsResponse>(
      `/catalog/blueprints/${input.catalogProductExternalId}/print_providers/${printProviderId}/variants.json`
    );
    const variant = variants.variants.find((v) => String(v.id) === input.variantExternalId);
    const baseCost = typeof variant?.cost === "number" ? variant.cost / 100 : 0;

    const shipping = await this.request<{ standard?: number }>(
      `/shops/${this.shopId}/orders/shipping.json`,
      {
        method: "POST",
        body: JSON.stringify({
          line_items: [
            {
              print_provider_id: printProviderId,
              blueprint_id: Number(input.catalogProductExternalId),
              variant_id: Number(input.variantExternalId),
              quantity: 1,
            },
          ],
          address_to: { country: input.destinationCountry },
        }),
      }
    );

    return {
      baseCost,
      // Printify returns shipping cost in cents.
      estimatedShipping: typeof shipping.standard === "number" ? shipping.standard / 100 : 0,
      currency: "USD",
    };
  }
}
