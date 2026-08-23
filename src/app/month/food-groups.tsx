import type { FoodGroup } from "@/lib/nutrition/types";

/**
 * Calories by food group.
 *
 * Food groups are NOMINAL — reordering them changes nothing — so this is a
 * magnitude comparison, not an identity one. That means one hue for every bar
 * and a sort by size, rather than ten categorical colours. Ten hues would fail
 * colour-vision separation outright, and colouring nominal bars by their value
 * spends the identity channel re-encoding what bar length already shows.
 *
 * Sorted descending with direct labels, so no legend is needed — the heading
 * names the measure.
 */

const GROUP_LABEL: Record<FoodGroup, string> = {
  protein: "Protein",
  grain: "Grains",
  vegetable: "Vegetables",
  fruit: "Fruit",
  dairy: "Dairy",
  fat: "Fats & oils",
  sweet: "Sweets",
  beverage: "Drinks",
  mixed_dish: "Mixed dishes",
  alcohol: "Alcohol",
};

export function FoodGroupChart({
  groups,
}: {
  groups: { group: FoodGroup; kcal: number; share: number }[];
}) {
  if (groups.length === 0) {
    return (
      <div className="card p-4">
        <h2 className="text-sm font-semibold">What you ate</h2>
        <p className="mt-2 text-sm text-muted">
          No entries this month yet.
        </p>
      </div>
    );
  }

  const max = groups[0].kcal;

  return (
    <div className="card p-4">
      <h2 className="text-sm font-semibold">Calories by food group</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {groups.map((g) => (
          <li key={g.group} className="text-xs">
            {/* Label and figure share a line above the bar on narrow screens —
                three fixed columns left the bar a few pixels wide on a phone. */}
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate">{GROUP_LABEL[g.group] ?? g.group}</span>
              <span className="tnum shrink-0 text-muted">
                {g.kcal.toLocaleString()}
                <span className="ml-1 opacity-70">
                  {Math.round(g.share * 100)}%
                </span>
              </span>
            </div>
            <span
              // 4px rounded data-end anchored to the baseline; a floor width
              // keeps a tiny value from vanishing entirely.
              className="mt-1 block h-2.5 rounded-r bg-heat-3"
              style={{ width: `${Math.max(2, (g.kcal / max) * 100)}%` }}
              role="img"
              aria-label={`${GROUP_LABEL[g.group]}: ${g.kcal} cal, ${Math.round(g.share * 100)}%`}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
