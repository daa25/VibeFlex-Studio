import { NextRequest, NextResponse } from "next/server";
import { createCart } from "@/integrations/shopify/storefront-client";

export async function POST(req: NextRequest) {
  const { merchandiseId, quantity } = await req.json();

  if (!merchandiseId) {
    return NextResponse.json({ error: "merchandiseId is required" }, { status: 400 });
  }

  try {
    const cart = await createCart(merchandiseId, quantity ?? 1);
    return NextResponse.json(cart);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 }
    );
  }
}
