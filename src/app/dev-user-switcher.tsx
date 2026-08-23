"use client";

import { switchDevUser } from "@/lib/actions";

/**
 * Dev-only account switcher.
 *
 * Exists so the pilot can hop between the two seeded users and actually see
 * per-user data isolation working. It disappears the moment AUTH_MODE is not
 * "dev", and the action behind it refuses to run under real auth.
 */
export function DevUserSwitcher({
  profiles,
  currentUserId,
}: {
  profiles: { userId: string; email: string; name: string | null }[];
  currentUserId: string;
}) {
  if (profiles.length === 0) return null;

  return (
    <form action={switchDevUser} className="flex items-center gap-2">
      <span
        className="rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning"
        title="AUTH_MODE=dev — this session is a seeded local user, not real auth."
      >
        dev
      </span>
      <select
        name="userId"
        defaultValue={currentUserId}
        // Submitting on change keeps it one interaction instead of two.
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
        aria-label="Acting as"
      >
        {profiles.map((p) => (
          <option key={p.userId} value={p.userId}>
            {p.name ?? p.email}
          </option>
        ))}
      </select>
      {/* Fallback for no-JS: the onChange above normally submits. */}
      <noscript>
        <button type="submit" className="rounded-md border border-border px-2 py-1 text-sm">
          Switch
        </button>
      </noscript>
    </form>
  );
}
