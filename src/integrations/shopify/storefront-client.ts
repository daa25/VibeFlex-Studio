// Headless storefront client — talks to Shopify's public Storefront API
// (not the Admin API). This is what the custom frontend uses to render
// products. It never touches write operations or secrets beyond a
// public/unauthenticated storefront token.
//
// Why this makes updates "easy": the Product Studio (Admin API side) keeps
// publishing/updating products in Shopify as normal. This client just reads
// whatever is currently in Shopify — so changing a price, swapping an image,
// or editing copy in Shopify Admin (or via the Studio) shows up on the
// storefront immediately, with zero frontend code changes or redeploys.

const SHOPIFY_STOREFRONT_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN as string;
const SHOPIFY_STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN as string;
const SHOPIFY_STOREFRONT_API_VERSION =
  process.env.SHOPIFY_STOREFRONT_API_VERSION ?? "2025-01";

if (!SHOPIFY_STOREFRONT_DOMAIN) {
  // Thrown lazily at call time in dev if envs aren't set yet — keeps this
  // file importable during scaffold review without a live store.
}

async function storefrontRequest<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  if (!SHOPIFY_STOREFRONT_DOMAIN || !SHOPIFY_STOREFRONT_TOKEN) {
    throw new Error(
      "SHOPIFY_SHOP_DOMAIN and SHOPIFY_STOREFRONT_ACCESS_TOKEN must be set to query the storefront."
    );
  }

  const res = await fetch(
    `https://${SHOPIFY_STOREFRONT_DOMAIN}/api/${SHOPIFY_STOREFRONT_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": SHOPIFY_STOREFRONT_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
      // Revalidate frequently rather than caching indefinitely, so a product
      // edit in Shopify shows up on the storefront within seconds/minutes
      // instead of requiring a manual rebuild.
      next: { revalidate: 60 },
    }
  );

  if (!res.ok) {
    throw new Error(`Shopify Storefront API error (${res.status}): ${await res.text()}`);
  }

  const json = await res.json();

  if (json.errors) {
    throw new Error(`Shopify Storefront GraphQL error: ${JSON.stringify(json.errors)}`);
  }

  return json.data as T;
}

export type StorefrontProductSummary = {
  id: string;
  handle: string;
  title: string;
  featuredImage: { url: string; altText: string | null } | null;
  priceRange: {
    minVariantPrice: { amount: string; currencyCode: string };
  };
};

export type StorefrontProductDetail = StorefrontProductSummary & {
  descriptionHtml: string;
  images: { url: string; altText: string | null }[];
  variants: {
    id: string;
    title: string;
    availableForSale: boolean;
    price: { amount: string; currencyCode: string };
    selectedOptions: { name: string; value: string }[];
  }[];
};

const PRODUCT_SUMMARY_FIELDS = `
  id
  handle
  title
  featuredImage {
    url
    altText
  }
  priceRange {
    minVariantPrice {
      amount
      currencyCode
    }
  }
`;

export async function getProducts(options?: {
  first?: number;
  collectionHandle?: string;
}): Promise<StorefrontProductSummary[]> {
  const first = options?.first ?? 24;

  if (options?.collectionHandle) {
    const data = await storefrontRequest<{
      collectionByHandle: { products: { nodes: StorefrontProductSummary[] } } | null;
    }>(
      `query CollectionProducts($handle: String!, $first: Int!) {
        collectionByHandle(handle: $handle) {
          products(first: $first) {
            nodes { ${PRODUCT_SUMMARY_FIELDS} }
          }
        }
      }`,
      { handle: options.collectionHandle, first }
    );
    return data.collectionByHandle?.products.nodes ?? [];
  }

  const data = await storefrontRequest<{ products: { nodes: StorefrontProductSummary[] } }>(
    `query AllProducts($first: Int!) {
      products(first: $first, sortKey: CREATED_AT, reverse: true) {
        nodes { ${PRODUCT_SUMMARY_FIELDS} }
      }
    }`,
    { first }
  );

  return data.products.nodes;
}

export async function getProductByHandle(
  handle: string
): Promise<StorefrontProductDetail | null> {
  const data = await storefrontRequest<{ productByHandle: StorefrontProductDetail | null }>(
    `query ProductByHandle($handle: String!) {
      productByHandle(handle: $handle) {
        ${PRODUCT_SUMMARY_FIELDS}
        descriptionHtml
        images(first: 10) {
          nodes { url altText }
        }
        variants(first: 50) {
          nodes {
            id
            title
            availableForSale
            price { amount currencyCode }
            selectedOptions { name value }
          }
        }
      }
    }`,
    { handle }
  );

  if (!data.productByHandle) return null;

  return {
    ...data.productByHandle,
    images: (data.productByHandle as any).images.nodes,
    variants: (data.productByHandle as any).variants.nodes,
  };
}

// Cart is created client-side against the Storefront API directly (it's a
// public, unauthenticated mutation), so no admin credentials are ever
// exposed to the browser.
export async function createCart(merchandiseId: string, quantity = 1) {
  const data = await storefrontRequest<{
    cartCreate: { cart: { id: string; checkoutUrl: string } };
  }>(
    `mutation CartCreate($lines: [CartLineInput!]!) {
      cartCreate(input: { lines: $lines }) {
        cart { id checkoutUrl }
      }
    }`,
    { lines: [{ merchandiseId, quantity }] }
  );

  return data.cartCreate.cart;
}
