import Image from "next/image";
import { notFound } from "next/navigation";
import { getProductByHandle } from "@/integrations/shopify/storefront-client";
import { AddToCartButton } from "./add-to-cart-button";

export const revalidate = 60;

export default async function ProductPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const product = await getProductByHandle(handle).catch(() => null);

  if (!product) notFound();

  return (
    <main className="mx-auto grid max-w-5xl gap-10 p-8 md:grid-cols-2">
      <div className="grid gap-4">
        {product.images.map((image, i) => (
          <Image
            key={i}
            src={image.url}
            alt={image.altText ?? product.title}
            width={800}
            height={800}
            className="rounded-lg"
          />
        ))}
      </div>

      <div>
        <h1 className="text-2xl font-semibold">{product.title}</h1>
        <p className="mt-2 text-lg text-neutral-300">
          ${product.priceRange.minVariantPrice.amount}{" "}
          {product.priceRange.minVariantPrice.currencyCode}
        </p>

        <div
          className="prose prose-invert mt-6 max-w-none"
          dangerouslySetInnerHTML={{ __html: product.descriptionHtml }}
        />

        <div className="mt-8">
          <AddToCartButton variants={product.variants} />
        </div>
      </div>
    </main>
  );
}
