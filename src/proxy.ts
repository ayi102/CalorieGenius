/**
 * Proxy — Next 16's rename of Middleware. Must be named `proxy.ts` and sit
 * beside `app/`.
 *
 * Two jobs:
 *  1. Issue a per-request CSP nonce. Next attaches it to its own scripts as long
 *     as the page is dynamically rendered (all of ours are).
 *  2. Optimistically bounce signed-out visitors to /login.
 *
 * Job 2 is a convenience, NOT the security boundary. It runs on prefetches, and
 * Next has shipped proxy-bypass advisories before. Real enforcement is
 * requireUser() in src/lib/auth.ts, called by every page and every action.
 *
 * Deliberately does no database work: the proxy runs on every matched request,
 * so opening a Prisma connection here would tax navigation for no security gain.
 */

import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";

  return (
    [
      `default-src 'self'`,
      // 'strict-dynamic' lets Next's nonced bootstrap load the rest of the
      // bundle. 'unsafe-eval' is dev-only, where React uses eval to rebuild
      // server error stacks.
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
      // Recharts sets inline style attributes, which a nonce cannot cover
      // (style attributes fall under style-src-attr). Inline styles are a far
      // weaker vector than inline scripts, so scripts stay strictly nonce-gated.
      `style-src 'self' 'unsafe-inline'`,
      // blob:/data: cover meal photos previewed before upload. No remote hosts:
      // the browser never talks to USDA, Open Food Facts, or Anthropic —
      // every one of those calls is server-side.
      `img-src 'self' blob: data:`,
      `font-src 'self' data:`,
      `connect-src 'self'`,
      `object-src 'none'`,
      `base-uri 'self'`,
      `form-action 'self'`,
      `frame-ancestors 'none'`,
      `upgrade-insecure-requests`,
    ].join("; ") + ";"
  );
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  // Next reads the nonce out of the CSP on the *request* during SSR.
  headers.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);

  const { pathname } = request.nextUrl;

  // Route handlers authenticate themselves; a redirect would turn an API call
  // into a confusing 307 + HTML.
  if (pathname.startsWith("/api/")) return response;

  // Under AUTH_MODE=dev the app resolves a seeded user with or without a cookie,
  // so there is no signed-out state to bounce. Redirecting here would just make
  // /login unreachable.
  if ((process.env.AUTH_MODE ?? "dev") === "dev") return response;

  // Supabase writes its session to sb-*-auth-token cookies. Presence is not
  // proof of validity — that is requireUser()'s job — it is only enough to skip
  // a pointless round trip to a page that would redirect anyway.
  const hasSession = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));

  if (!hasSession && !isPublic(pathname)) {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    to.search = "";
    const redirect = NextResponse.redirect(to);
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  }

  return response;
}

export const config = {
  // Everything except static assets and the files a browser fetches before
  // login. None of those routes serve private data.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|manifest\\.webmanifest|.*\\.png$|.*\\.svg$).*)",
  ],
};
