import { NextRequest, NextResponse } from "next/server";

/**
 * Admin gate.
 *
 * /dashboard and the publish endpoint act on the real Shopify store, so they
 * are protected with HTTP Basic auth whenever STUDIO_ADMIN_PASSWORD is set.
 * If it is NOT set the gate stays open but every response carries
 * `x-vibeflex-admin-auth: disabled`, and /dashboard renders a visible warning —
 * silent-but-unprotected is not an acceptable production state.
 *
 * The customer-facing studio (/studio, uploads, cart) is intentionally public.
 */
export function middleware(req: NextRequest) {
  const password = process.env.STUDIO_ADMIN_PASSWORD?.trim();
  if (!password) {
    const res = NextResponse.next();
    res.headers.set("x-vibeflex-admin-auth", "disabled");
    return res;
  }

  const user = process.env.STUDIO_ADMIN_USER?.trim() || "vibeflex";
  const header = req.headers.get("authorization") ?? "";

  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const separator = decoded.indexOf(":");
      const suppliedUser = decoded.slice(0, separator);
      const suppliedPassword = decoded.slice(separator + 1);
      if (suppliedUser === user && constantTimeEqual(suppliedPassword, password)) {
        return NextResponse.next();
      }
    } catch {
      // fall through to the challenge
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="VibeFlex Studio Admin", charset="UTF-8"',
      "Content-Type": "text/plain",
    },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/studio/publish"],
};
