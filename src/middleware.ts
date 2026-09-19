import { NextRequest, NextResponse } from "next/server";

/** Admin endpoints fail closed until a password is configured. */
export function middleware(req: NextRequest) {
  const password = process.env.STUDIO_ADMIN_PASSWORD?.trim();
  if (!password) {
    return new NextResponse("Admin authentication is not configured.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const user = process.env.STUDIO_ADMIN_USER?.trim() || "vibeflex";
  const header = req.headers.get("authorization") ?? "";

  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const separator = decoded.indexOf(":");
      if (separator < 0) throw new Error("Malformed Basic auth");
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
      "Cache-Control": "no-store",
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
