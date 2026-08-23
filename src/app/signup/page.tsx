import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { authMode } from "@/lib/env";
import { AuthForm } from "../auth-form";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await getSessionUser()) redirect("/");

  if (authMode() === "dev") {
    return (
      <div className="mx-auto max-w-sm py-12">
        <h1 className="text-xl font-semibold">Sign up</h1>
        <p className="mt-2 text-sm text-muted">
          This instance is running with <code>AUTH_MODE=dev</code>, which uses
          seeded local accounts instead of registration. Set{" "}
          <code>AUTH_MODE=supabase</code> to enable real sign-ups.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm py-12">
      <h1 className="text-xl font-semibold">Create your account</h1>
      <p className="mb-6 mt-1 text-sm text-muted">
        Type what you eat. It works out the calories.
      </p>
      <AuthForm mode="signup" />
    </div>
  );
}
