// Runtime assembly of the production providers Studio routes orders to.
//
// The in-house line (VibeFlexLocalProvider) is ALWAYS registered: Studio is
// production-capable on its own, independent of any external vendor. External
// providers (Printful, ...) are registered only when a real client is supplied,
// and even then never auto-submit — their submit path is owner-approval gated.
//
// This is the single place the order flow calls to learn "who can produce right
// now", so the webhook route never imports a specific vendor.

import { ProviderRegistry } from "@/integrations/pod/provider-registry";
import { VibeFlexLocalProvider } from "@/integrations/pod/providers/vibeflex-local-provider";
import {
  PrintfulProductionProvider,
  type PrintfulOrderClient,
} from "@/integrations/pod/providers/printful-production-provider";
import { createPrintfulOrderClient } from "@/integrations/pod/printful/order-client";
import {
  PrintifyProductionProvider,
  type PrintifyOrderClient,
} from "@/integrations/pod/providers/printify-production-provider";
import { createPrintifyOrderClient } from "@/integrations/pod/printify/order-client";
import type { ProductionProvider } from "@/integrations/pod/production-types";
import { env } from "@/lib/env";

export type ProductionRuntimeOptions = {
  /**
   * A live Printful order client. Supplied only when Printful is intended as an
   * external route. Omitted (the default) means Printful is simply not
   * registered — Studio still produces through the in-house line.
   */
  printfulClient?: PrintfulOrderClient;
  /**
   * A live Printify order client. Same additive, approval-gated contract as
   * printfulClient — omit it and Printify is simply not registered.
   */
  printifyClient?: PrintifyOrderClient;
  /** Override the in-house provider (tests inject a deterministic store/clock). */
  localProvider?: VibeFlexLocalProvider;
};

/**
 * Build the provider registry for the current runtime. The in-house line is
 * always present; external providers are additive and approval-gated.
 */
export function buildProductionRegistry(
  opts: ProductionRuntimeOptions = {}
): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(opts.localProvider ?? new VibeFlexLocalProvider());
  if (opts.printfulClient) {
    registry.register(new PrintfulProductionProvider({ client: opts.printfulClient }));
  }
  if (opts.printifyClient) {
    registry.register(new PrintifyProductionProvider({ client: opts.printifyClient }));
  }
  return registry;
}

/** The list of providers to route an order across, in registration order. */
export function getProductionProviders(
  opts: ProductionRuntimeOptions = {}
): ProductionProvider[] {
  return buildProductionRegistry(opts).list();
}

/**
 * The list of providers to route an order across, built from real
 * environment configuration rather than test-injected fakes. This is what the
 * live order webhook calls.
 *
 * Only a provider whose credentials are actually present gets a real client
 * constructed and registered — an unconfigured provider is silently absent,
 * not a startup error, matching this codebase's "nothing throws on missing
 * config" rule. Today that means only Printify registers for this store:
 * Printful has no credentials configured, so PRINTFUL_API_KEY /
 * PRINTFUL_STORE_ID being unset means createPrintfulOrderClient is never
 * called and Printful is simply not in the registry.
 */
export function getConfiguredProductionProviders(): ProductionProvider[] {
  const printfulKey = env.printfulApiKey();
  const printfulStore = env.printfulStoreId();
  const printifyKey = env.printifyApiKey();
  const printifyShop = env.printifyShopId();

  return getProductionProviders({
    printfulClient:
      printfulKey && printfulStore ? createPrintfulOrderClient(printfulKey, printfulStore) : undefined,
    printifyClient:
      printifyKey && printifyShop ? createPrintifyOrderClient(printifyKey, printifyShop) : undefined,
  });
}
