// Provider registry.
//
// One place that knows which production providers exist and which are usable
// right now. The rest of Studio asks the registry for providers rather than
// importing a specific vendor — so Printful being unavailable degrades to
// "Printful is not registered", never "Studio cannot produce".

import type { ProductionProvider, ProviderKind } from "./production-types";

export class ProviderRegistry {
  private readonly providers = new Map<string, ProductionProvider>();

  register(provider: ProductionProvider): this {
    this.providers.set(provider.providerName, provider);
    return this;
  }

  unregister(providerName: string): this {
    this.providers.delete(providerName);
    return this;
  }

  get(providerName: string): ProductionProvider | undefined {
    return this.providers.get(providerName);
  }

  has(providerName: string): boolean {
    return this.providers.has(providerName);
  }

  list(): ProductionProvider[] {
    return [...this.providers.values()];
  }

  byKind(kind: ProviderKind): ProductionProvider[] {
    return this.list().filter((p) => p.kind === kind);
  }

  /** True when Studio can produce at all — i.e. at least one local provider. */
  hasLocalCapability(): boolean {
    return this.byKind("local").length > 0;
  }
}
