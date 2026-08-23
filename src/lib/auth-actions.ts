"use server";

/**
 * Sign-up, sign-in, and sign-out.
 *
 * These are the only actions that may run without a session — everything else in
 * actions.ts calls requireUser() first. They are deliberately in their own file
 * so that rule stays easy to audit.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authMode } from "@/lib/env";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";

export interface AuthResult {
  ok: boolean;
  error?: string;
  /** Set when the account was created but needs email confirmation. */
  needsConfirmation?: boolean;
}

function assertSupabase(): AuthResult | null {
  if (authMode() !== "supabase") {
    return {
      ok: false,
      error: 'Running with AUTH_MODE="dev" — use the seeded accounts on /login.',
    };
  }
  if (!supabaseConfigured()) {
    return {
      ok: false,
      error:
        "Supabase isn't configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    };
  }
  return null;
}

/**
 * Basic shape checks only.
 *
 * Deliberately not a strict email regex: Supabase is the authority on whether an
 * address is deliverable, and over-eager client validation rejects valid
 * addresses. The password floor matches Supabase's own default.
 */
function validate(email: string, password: string): string | null {
  if (!email.includes("@") || email.length < 3) {
    return "Enter a valid email address.";
  }
  if (password.length < 8) {
    return "Password must be at least 8 characters.";
  }
  return null;
}

export async function signUp(form: FormData): Promise<AuthResult> {
  const guard = assertSupabase();
  if (guard) return guard;

  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");

  const problem = validate(email, password);
  if (problem) return { ok: false, error: problem };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return { ok: false, error: error.message };
  }

  // With email confirmation enabled, Supabase returns a user but no session.
  // Saying so is important: otherwise the user is left staring at a login page
  // wondering whether the account was created.
  if (data.user && !data.session) {
    return { ok: true, needsConfirmation: true };
  }

  // The Profile row is created lazily on first authenticated request — see
  // provisionProfile() in auth.ts — so there is nothing to write here.
  redirect("/settings?welcome=1");
}

export async function signIn(form: FormData): Promise<AuthResult> {
  const guard = assertSupabase();
  if (guard) return guard;

  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");

  if (!email || !password) {
    return { ok: false, error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Supabase deliberately returns the same message for a wrong password and an
    // unknown address, which avoids leaking whether an account exists. Pass it
    // through rather than "helpfully" distinguishing them.
    return { ok: false, error: error.message };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signOut(): Promise<void> {
  if (authMode() === "supabase" && supabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  revalidatePath("/", "layout");
  redirect("/login");
}
