import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  await requireUser();
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold">Insights</h1>
      <p className="text-sm text-muted">
        Arrives once there are entries to summarize.
      </p>
    </div>
  );
}
