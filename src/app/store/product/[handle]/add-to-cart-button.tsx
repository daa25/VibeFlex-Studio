"use client";

import { useState } from "react";

type Variant = {
  id: string;
  title: string;
  availableForSale: boolean;
  price: { amount: string; currencyCode: string };
  selectedOptions: { name: string; value: string }[];
};

export function AddToCartButton({ variants }: { variants: Variant[] }) {
  const [selectedVariantId, setSelectedVariantId] = useState(variants[0]?.id ?? "");
  const [status, setStatus] = useState<"idle" | "adding" | "added" | "error">("idle");

  async function handleAddToCart() {
    setStatus("adding");
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchandiseId: selectedVariantId }),
      });
      if (!res.ok) throw new Error("Failed to add to cart");
      const { checkoutUrl } = await res.json();
      window.location.href = checkoutUrl;
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <select
        value={selectedVariantId}
        onChange={(e) => setSelectedVariantId(e.target.value)}
        className="rounded border border-neutral-700 bg-neutral-900 p-2"
        aria-label="Select variant"
      >
        {variants.map((v) => (
          <option key={v.id} value={v.id} disabled={!v.availableForSale}>
            {v.title} {!v.availableForSale ? "(sold out)" : ""}
          </option>
        ))}
      </select>

      <button
        onClick={handleAddToCart}
        disabled={status === "adding"}
        className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {status === "adding" ? "Adding..." : "Add to Cart"}
      </button>

      {status === "error" && (
        <p className="text-sm text-red-400">
          Something went wrong adding this to your cart — try again.
        </p>
      )}
    </div>
  );
}
