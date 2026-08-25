import { requireUser } from "@/lib/auth";
import { getProfile, getUsageSummary, targetsForProfile } from "@/lib/queries";
import { SettingsForm } from "./settings-form";
import { UsageCard } from "./usage-card";
import { env } from "@/lib/env";
import { todayIso } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // requireUser() first, always — this is the authorization boundary.
  const user = await requireUser();
  const profile = await getProfile(user.userId);
  if (!profile) {
    return <p className="text-negative">Profile not found.</p>;
  }

  const targets = targetsForProfile(profile);
  const usage = await getUsageSummary(
    user.userId,
    todayIso(profile.timezone),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="display text-2xl">Settings</h1>
        <p className="text-sm text-muted">
          Your targets and how days are measured.
        </p>
      </div>
      <SettingsForm profile={profile} targets={targets} />

      <div className="border-t border-border pt-6">
        <UsageCard usage={usage} dailyLimit={env.dailyParseLimit()} />
      </div>
    </div>
  );
}
