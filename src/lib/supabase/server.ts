/**
 * Server-side Supabase client.
 *
 * Uses the ANON key, never a service-role key: this client only ever acts as the
 * signed-in user for auth purposes, and a service key in the app process would
 * be a standing privilege-escalation risk for no benefit — data access goes
 * through Prisma.
 */

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/** True when both public Supabase variables are present. */
export function supabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set when AUTH_MODE=supabase.",
    );
  }

  const jar = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            jar.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. That is expected: the proxy
          // refreshes the session cookie on every request, so a failure here is
          // harmless rather than a lost session.
        }
      },
    },
  });
}
