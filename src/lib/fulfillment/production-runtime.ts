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
import {
  PrintifyProductionProvider,
  type PrintifyOrderClient,
} from "@/integrations/pod/providers/printify-production-provider";
import type { ProductionProvider } from "@/integrations/pod/production-types";

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
