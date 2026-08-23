"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signIn, signUp, type AuthResult } from "@/lib/auth-actions";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent";

/**
 * Email + password form for both sign-in and sign-up.
 *
 * One component for both because the fields and failure modes are identical —
 * two near-duplicate forms would drift apart.
 */
export function AuthForm({ mode }: { mode: "signin" | "signup" }) {
  const action = mode === "signup" ? signUp : signIn;
  const [result, formAction, pending] = useActionState<AuthResult | null, FormData>(
    async (_prev, formData) => action(formData),
    null,
  );

  if (result?.needsConfirmation) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-medium">Check your email</h2>
        <p className="mt-2 text-sm text-muted">
          Your account was created. Click the confirmation link we sent, then sign
          in.
        </p>
        <Link
          href="/login"
          className="mt-4 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          autoFocus
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Password</span>
        <input
          type="password"
          name="password"
          // Tells the browser's password manager which flow this is, so it offers
          // to generate on sign-up and autofill on sign-in.
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
          minLength={8}
          className={inputClass}
        />
        {mode === "signup" && (
          <span className="text-xs text-muted">At least 8 characters.</span>
        )}
      </label>

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-60"
      >
        {pending
          ? mode === "signup"
            ? "Creating account…"
            : "Signing in…"
          : mode === "signup"
            ? "Create account"
            : "Sign in"}
      </button>

      {result && !result.ok && result.error && (
        <p className="text-sm text-negative" role="alert">
          {result.error}
        </p>
      )}

      <p className="mt-2 text-sm text-muted">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-accent underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/signup" className="text-accent underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
