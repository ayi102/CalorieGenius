import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { authMode } from "@/lib/env";
import { listDevProfiles } from "@/lib/queries";
import { switchDevUser } from "@/lib/actions";
import { AuthForm } from "../auth-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/");

  if (authMode() === "dev") {
    const profiles = await listDevProfiles();

    return (
      <div className="mx-auto max-w-sm py-12">
        <h1 className="text-xl font-semibold">CalorieGenius</h1>
        <p className="mt-2 text-sm text-muted">
          Running with <code>AUTH_MODE=dev</code> — pick a seeded local account.
        </p>

        {profiles.length === 0 ? (
          <p className="mt-6 text-sm text-warning">
            No profiles yet. Run <code>npm run db:seed</code>.
          </p>
        ) : (
          <div className="mt-6 flex flex-col gap-2">
            {profiles.map((p) => (
              <form key={p.userId} action={switchDevUser}>
                <input type="hidden" name="userId" value={p.userId} />
                <button
                  type="submit"
                  className="w-full rounded-md border border-border bg-surface px-4 py-3 text-left text-sm hover:border-accent"
                >
                  <span className="font-medium">{p.name ?? p.email}</span>
                  <span className="block text-xs text-muted">{p.email}</span>
                </button>
              </form>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm py-12">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Welcome back.</p>
      <AuthForm mode="signin" />
    </div>
  );
}
