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

  async createMockupJob(input: MockupJobInput): Promise<MockupJob> {
    const data = await this.request<{ result: { task_key: string } }>(
      "/mockup-generator/create-task",
      {
        method: "POST",
        body: JSON.stringify({
          variant_ids: input.variantExternalIds.map(Number),
          files: [{ placement: input.printAreaId, image_url: input.artworkFileUrl }],
        }),
      }
    );

    return { providerJobId: data.result.task_key, status: "queued" };
  }

  async getMockupJob(jobId: string): Promise<MockupJobStatus> {
    const data = await this.request<{ result: { status: string; mockups?: any[] } }>(
      `/mockup-generator/task?task_key=${jobId}`
    );

    const statusMap: Record<string, MockupJobStatus["status"]> = {
      pending: "processing",
      completed: "completed",
      failed: "failed",
    };

    return {
      providerJobId: jobId,
      status: statusMap[data.result.status] ?? "processing",
      mockupUrls: data.result.mockups?.flatMap((m: any) =>
        m.extra?.map((e: any) => e.url) ?? [m.mockup_url]
      ),
    };
  }

  async createFulfillmentProduct(
    input: FulfillmentProductInput
  ): Promise<FulfillmentProduct> {
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
