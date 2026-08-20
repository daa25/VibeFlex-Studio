import Link from "next/link";
import Image from "next/image";
import { getProducts } from "@/integrations/shopify/storefront-client";

// This page is fully headless: it renders your own custom UI, but every
// product shown here comes live from Shopify via the Storefront API.
// Add/edit/remove a product in Shopify (or publish one from the Product
// Studio) and it shows up here automatically — no code change, no redeploy.
export const revalidate = 60;

export default async function StorePage() {
  // Storefront credentials are optional at build time: without them the page
  // renders an empty state instead of failing the build.
  const products = await getProducts({ first: 24 }).catch(() => []);

  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="mb-6 text-2xl font-semibold">Shop</h1>

      {products.length === 0 ? (
        <p className="text-neutral-400">
          No products published yet. Publish one from the Product Studio or
          Shopify Admin — it will appear here automatically.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <Link
              key={product.id}
              href={`/store/product/${product.handle}`}
              className="group block"
            >
              <div className="aspect-square overflow-hidden rounded-lg bg-neutral-900">
                {product.featuredImage && (
                  <Image
                    src={product.featuredImage.url}
                    alt={product.featuredImage.altText ?? product.title}
                    width={400}
                    height={400}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                )}
              </div>
              <h2 className="mt-2 text-sm font-medium">{product.title}</h2>
              <p className="text-sm text-neutral-400">
                ${product.priceRange.minVariantPrice.amount}
              </p>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
