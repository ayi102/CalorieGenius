/**
 * The authorization boundary.
 *
 * `requireUser()` is the authoritative check and MUST be the first line of every
 * page and every server action. Server Actions are reachable as HTTP endpoints
 * regardless of what the UI renders, so a check that lives only in the proxy or
 * only in a component is not a boundary at all.
 *
 * Two providers sit behind one interface so the pilot can run without Docker
 * while the seam stays real:
 *
 *   AUTH_MODE=dev       — resolves a seeded local user from a cookie.
 *   AUTH_MODE=supabase  — verifies the Supabase JWT signature.
 *
 * Switching is a config change, not a refactor, because nothing downstream knows
 * which provider ran: every query function takes `userId` explicitly.
 */

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authMode } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";

/** The cookie the dev provider reads. Set by the dev user switcher. */
export const DEV_USER_COOKIE = "cg_dev_user";

export interface SessionUser {
  userId: string;
  email: string;
  name: string | null;
  timezone: string;
}

/**
 * Resolve the current user, or null.
 *
 * Wrapped in React `cache()` so several components in one render pass share a
 * single resolution. Fails closed: any error yields null, never a partial user.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  try {
    const mode = authMode();
    const identity =
      mode === "dev" ? await devIdentity() : await supabaseIdentity();
    if (!identity) return null;

    let profile = await prisma.profile.findUnique({
      where: { userId: identity.userId },
      select: { userId: true, email: true, name: true, timezone: true },
    });

    // First sign-in after registering: the JWT is valid but this app has no row
    // for them yet. Provision one so a new account lands on a working app rather
    // than an error — the alternative is a dead end the user cannot escape.
    if (!profile && mode === "supabase" && identity.email) {
      profile = await provisionProfile(identity.userId, identity.email);
    }

    if (!profile) return null;

    return {
      userId: profile.userId,
      email: profile.email,
      name: profile.name,
      timezone: profile.timezone,
    };
  } catch {
    // Unreachable DB, malformed cookie, misconfigured env — treat as signed out.
    // No session means no access.
    return null;
  }
});

/** Require a signed-in user, or redirect to the login page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/**
 * Provision a Profile for a freshly-registered Supabase user.
 *
 * Uses upsert rather than create: two concurrent requests can both observe the
 * missing row (a page load plus a prefetch, say), and a plain create would make
 * one of them fail with a unique violation on the user's very first visit.
 */
async function provisionProfile(userId: string, email: string) {
  return prisma.profile.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      email,
      // Everything else takes a schema default. The user fills in body metrics
      // on /settings, and until then targets fall back to generic values that
      // the UI labels as not personalized.
    },
    select: { userId: true, email: true, name: true, timezone: true },
  });
}

/**
 * Dev provider: trusts a cookie naming the seeded user.
 *
 * This is deliberately weak — it exists so the pilot needs no hosted auth. The
 * guard against it ever shipping lives in env.ts, which refuses AUTH_MODE=dev
 * when NODE_ENV is production.
 *
 * When no cookie is set, fall back to the first seeded profile so a fresh clone
 * lands on a working app rather than a login wall.
 */
async function devIdentity(): Promise<{ userId: string; email: string | null } | null> {
  const jar = await cookies();
  const fromCookie = jar.get(DEV_USER_COOKIE)?.value;
  if (fromCookie) return { userId: fromCookie, email: null };

  const first = await prisma.profile.findFirst({
    orderBy: { createdAt: "asc" },
    select: { userId: true, email: true },
  });
  return first ? { userId: first.userId, email: first.email } : null;
}

/**
 * Supabase provider: verifies the access token's signature rather than trusting
 * the cookie's contents, and returns the `sub` claim.
 *
 * Wired at deploy time (build order step 7). Throwing here rather than silently
 * returning null makes a half-configured deployment obvious instead of
 * presenting every visitor with a login loop.
 */
async function supabaseIdentity(): Promise<{ userId: string; email: string | null } | null> {
  // An unconfigured deployment has nobody signed in. Returning null (rather than
  // throwing) keeps /login renderable so the misconfiguration is visible instead
  // of every route 500ing.
  if (!supabaseConfigured()) return null;

  const supabase = await createClient();

  // getClaims() verifies the access token's SIGNATURE rather than trusting the
  // cookie's contents — the distinction that makes this a real check. A cookie
  // is attacker-controlled input; a verified signature is not.
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;

  const claims = data.claims as { sub: string; email?: string };
  return { userId: claims.sub, email: claims.email ?? null };
}
