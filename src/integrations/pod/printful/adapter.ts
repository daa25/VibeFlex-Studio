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

const PRINTFUL_API_BASE = "https://api.printful.com";

/**
 * Printful store platforms whose sync-product API can be used to CREATE a
 * fulfillment product. A Shopify/Etsy/etc. store is driven by Printful's own
 * integration instead, and rejects /store/products with HTTP 400.
 */
export const SYNC_API_PLATFORMS = ["native", "manual", "api"];

/** Raised when a store's platform cannot support API-created sync products. */
export class PrintfulPlatformError extends Error {
  readonly code = "PRINTFUL_PLATFORM_UNSUPPORTED";
  constructor(
    readonly storeId: string,
    readonly platform: string
  ) {
    super(
      `Printful store ${storeId} is a "${platform}" platform store, so a fulfillment ` +
        `product cannot be created through the API. Printful owns product sync for ` +
        `this store type: create the product in Printful and let it push to Shopify, ` +
        `or match the existing Shopify product in Printful's Shopify app. Writing to a ` +
        `different store on the account would produce a fulfillment path that does not ` +
        `serve this storefront.`
    );
    this.name = "PrintfulPlatformError";
  }
}

export const printfulCapabilities: ProviderCapabilities = {
  catalog: true,
  mockups: true,
  insideLabels: true,
  embroidery: true,
  customPackaging: false,
  fulfillmentProductCreation: true,
  orderRouting: true,
  webhooks: true,
};

export class PrintfulAdapter implements PodProviderAdapter {
  readonly providerName = "printful";

  constructor(private readonly apiKey: string, private readonly storeId: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${PRINTFUL_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "X-PF-Store-Id": this.storeId,
        ...init?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Printful API error (${res.status}): ${body}`);
    }

    return res.json() as Promise<T>;
  }

  private platformCache: string | null = null;

  /** The configured store's platform, cached. Null when it cannot be determined. */
  async getStorePlatform(): Promise<string | null> {
    if (this.platformCache) return this.platformCache;
    try {
      const data = await this.request<{ result?: Array<{ id: number; type: string }> }>("/stores");
      const store = (data.result ?? []).find((s) => String(s.id) === String(this.storeId));
      this.platformCache = store?.type ?? null;
      return this.platformCache;
    } catch {
      // A lookup failure must not silently unlock creation; the caller treats
      // null as "unknown" and the create path still surfaces Printful's error.
      return null;
    }
  }

  async getCatalog(): Promise<PodProduct[]> {
    const data = await this.request<{ result: any[] }>("/products");
    return data.result.map((item) => ({
      externalId: String(item.id),
      name: item.title ?? item.model,
      brand: item.brand,
      model: item.model,
      category: item.type_name,
      printAreas: (item.files ?? []).map((f: any) => f.type),
      attributes: item,
    }));
  }

  async getProduct(productId: string): Promise<PodProduct> {
    const data = await this.request<{ result: { product: any } }>(
      `/products/${productId}`
    );
    const p = data.result.product;
    return {
      externalId: String(p.id),
      name: p.title ?? p.model,
      brand: p.brand,
      model: p.model,
      category: p.type_name,
      printAreas: [],
      attributes: p,
    };
  }

  async getVariants(productId: string): Promise<PodVariant[]> {
    const data = await this.request<{ result: { variants: any[] } }>(
      `/products/${productId}`
    );
    return data.result.variants.map((v) => ({
      externalId: String(v.id),
      color: v.color,
      colorHex: v.color_code,
      size: v.size,
      baseCost: Number(v.price),
      currency: "USD",
      availability: v.in_stock ? "in_stock" : "backorder",
    }));
  }

  // Printful validates artwork implicitly via mockup generation; this is a
  // lightweight pre-check so obviously bad uploads fail fast in our own UI.
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

  /** Print area geometry and DPI per placement, straight from Printful. */
  async getPrintfiles(productId: string): Promise<{
    availablePlacements: Record<string, string>;
    printfiles: { printfile_id: number; width: number; height: number; dpi: number }[];
    placementToPrintfile: Record<string, number>;
  }> {
    const data = await this.request<{
      result: {
        available_placements?: Record<string, string>;
        printfiles?: { printfile_id: number; width: number; height: number; dpi: number }[];
        variant_printfiles?: { variant_id: number; placements: Record<string, number> }[];
      };
    }>(`/mockup-generator/printfiles/${productId}`);

    return {
      availablePlacements: data.result.available_placements ?? {},
      printfiles: data.result.printfiles ?? [],
      placementToPrintfile: data.result.variant_printfiles?.[0]?.placements ?? {},
    };
  }

  async createMockupJob(input: MockupJobInput): Promise<MockupJob> {
    // The catalog product id belongs in the PATH. Without it Printful 404s, which
    // is why no mockup has ever been generated by this adapter.
    const data = await this.request<{ result: { task_key: string } }>(
      `/mockup-generator/create-task/${input.catalogProductExternalId}`,
      {
        method: "POST",
        body: JSON.stringify({
          variant_ids: input.variantExternalIds.map(Number),
          format: "jpg",
          files: [
            {
              placement: input.printAreaId,
              image_url: input.artworkFileUrl,
              // Printful rejects the task without an explicit position.
              ...(input.position ? { position: input.position } : {}),
            },
          ],
        }),
      }
    );

    return { providerJobId: data.result.task_key, status: "queued" };
  }

  async getMockupJob(jobId: string): Promise<MockupJobStatus> {
    const data = await this.request<{
      result: { status: string; error?: string; mockups?: any[] };
    }>(`/mockup-generator/task?task_key=${jobId}`);

    const statusMap: Record<string, MockupJobStatus["status"]> = {
      pending: "processing",
      in_progress: "processing",
      completed: "completed",
      failed: "failed",
    };

    // `mockup_url` is the customer-facing hero; `extra` holds alternate angles.
    // Keep the hero FIRST — the previous code dropped it whenever extras existed,
    // which is how a ghost/detail shot could end up as the product image.
    const urls: string[] = [];
    for (const m of data.result.mockups ?? []) {
      if (m.mockup_url) urls.push(m.mockup_url);
      for (const e of m.extra ?? []) if (e?.url) urls.push(e.url);
    }

    return {
      providerJobId: jobId,
      status: statusMap[data.result.status] ?? "processing",
      mockupUrls: urls,
      errorMessage: data.result.error,
    };
  }

  /** Polls a mockup task to completion. Returns the last status rather than throwing. */
  async waitForMockups(
    jobId: string,
    options: { attempts?: number; intervalMs?: number } = {}
  ): Promise<MockupJobStatus> {
    const attempts = options.attempts ?? 20;
    const intervalMs = options.intervalMs ?? 3000;
    let last: MockupJobStatus = { providerJobId: jobId, status: "processing" };

    for (let i = 0; i < attempts; i++) {
      await new Promise((r) => setTimeout(r, intervalMs));
      last = await this.getMockupJob(jobId);
      if (last.status === "completed" || last.status === "failed") return last;
    }
    return last;
  }

  async createFulfillmentProduct(
    input: FulfillmentProductInput
  ): Promise<FulfillmentProduct> {
    // Verified against the live account: /store/products returns HTTP 400 for a
    // Shopify-platform store ("This API endpoint applies only to Printful
    // stores based on the Manual Order / API platform"). Printful owns product
    // sync for those stores, so a fulfillment product has to be created on the
    // Printful side and pushed into Shopify.
    //
    // We refuse loudly rather than letting the 400 surface as a generic error,
    // and we never fall back to another store on the account: writing to a
    // different store would create a fulfillment path that does not serve the
    // storefront while reporting success. A false "fulfillment verified" is
    // worse than no fulfillment at all, because it unlocks publication.
    const platform = await this.getStorePlatform();
    if (platform && !SYNC_API_PLATFORMS.includes(platform)) {
      throw new PrintfulPlatformError(this.storeId, platform);
    }

    const data = await this.request<{ result: { id: number; sync_variants: any[] } }>(
      "/store/products",
      {
        method: "POST",
        body: JSON.stringify({
          sync_product: { name: input.name },
          sync_variants: input.variantExternalIds.map((variantId) => ({
            variant_id: Number(variantId),
            retail_price: String(input.retailPriceByVariant[variantId] ?? "0.00"),
            files: [{ placement: input.printAreaId, image_url: input.artworkFileUrl }],
          })),
        }),
      }
    );

    const variantMap: Record<string, string> = {};
    data.result.sync_variants.forEach((sv: any) => {
      variantMap[String(sv.variant_id)] = String(sv.id);
    });

    return { providerProductId: String(data.result.id), variantMap };
  }

  async updateFulfillmentProduct(
    id: string,
    input: FulfillmentProductInput
  ): Promise<FulfillmentProduct> {
    const data = await this.request<{ result: { id: number; sync_variants: any[] } }>(
      `/store/products/${id}`,
      {
        method: "PUT",
        body: JSON.stringify({
          sync_product: { name: input.name },
        }),
      }
    );

    const variantMap: Record<string, string> = {};
    data.result.sync_variants.forEach((sv: any) => {
      variantMap[String(sv.variant_id)] = String(sv.id);
    });

    return { providerProductId: String(data.result.id), variantMap };
  }

  async archiveFulfillmentProduct(id: string): Promise<void> {
    await this.request(`/store/products/${id}`, { method: "DELETE" });
  }

  async estimateCost(input: CostEstimateInput): Promise<CostEstimate> {
    const data = await this.request<{
      result: { costs: { total: string; shipping: string } };
    }>("/orders/estimate-costs", {
      method: "POST",
      body: JSON.stringify({
        recipient: { country_code: input.destinationCountry },
        items: [{ variant_id: Number(input.variantExternalId), quantity: 1 }],
      }),
    });

    const total = Number(data.result.costs.total);
    const shipping = Number(data.result.costs.shipping);

    return {
      baseCost: total - shipping,
      estimatedShipping: shipping,
      currency: "USD",
    };
  }
}
