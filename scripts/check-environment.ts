import { loadEnvConfig } from "@next/env";
import { serviceStatuses, env } from "../src/lib/env";

// Load local configuration without logging its contents.
loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const services = serviceStatuses().map(({ key, configured, missing }) => ({
  service: key,
  configured,
  missing,
}));
const warnings: string[] = [];
if (!env.adminPassword()) warnings.push("Staff access password is not configured.");
if (env.autoSubmitFulfillment()) warnings.push("Automatic paid fulfillment submission is enabled.");
if (env.shopDomain() && !["59bf48-92.myshopify.com", "vibeflex-813.myshopify.com"].includes(env.shopDomain()!)) {
  warnings.push("Shop domain differs from the two current business stores; verify ownership before connecting.");
}
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  mode: "configuration-only; credentials are not tested and values are never displayed",
  services,
  warnings,
  allConfigured: services.every((service) => service.configured),
}, null, 2));
