"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  analyzeEntry,
  relogEntry,
  saveEntry,
  scanBarcode,
  type AnalyzeResult,
  type PreviewItem,
} from "@/lib/actions";
import { BarcodeScanner } from "./barcode-scanner";

/** Datetime-local value for "now", in the browser's own clock. */
function nowLocalInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const SOURCE_BADGE: Record<string, { label: string; className: string }> = {
  usda: { label: "USDA", className: "bg-positive/15 text-positive" },
  openfoodfacts: { label: "OFF", className: "bg-positive/15 text-positive" },
  user: { label: "yours", className: "bg-accent/15 text-accent" },
  estimate: { label: "estimate", className: "bg-warning/15 text-warning" },
};

/**
 * Rescale an item's nutrition when the user edits its portion.
 *
 * Nutrition is stored for the whole portion, so changing grams has to move the
 * numbers with it — otherwise the figures on screen stop matching the weight
 * beside them, and the saved row would be internally inconsistent.
 */
function rescale(item: PreviewItem, nextGrams: number): PreviewItem {
  if (item.grams <= 0 || nextGrams <= 0) return { ...item, grams: nextGrams };
  const f = nextGrams / item.grams;
  return {
    ...item,
    grams: nextGrams,
    kcal: item.kcal * f,
    protein: item.protein * f,
    carbs: item.carbs * f,
    fat: item.fat * f,
    fiber: item.fiber * f,
    sugar: item.sugar * f,
    sodium: item.sodium * f,
  };
}

/**
 * Set an item's portion by number of servings.
 *
 * Packaged food is labelled per serving, so asking for grams there is asking
 * someone to weigh a cereal box. Fractional values matter: half a serving is
 * common and rounding it to 1 would overstate the day by a real amount.
 */
function rescaleServings(item: PreviewItem, servings: number): PreviewItem {
  if (!item.servingGrams || item.servingGrams <= 0) return item;
  const next = rescale(item, item.servingGrams * servings);
  return { ...next, quantity: servings, unit: "serving" };
}

/** Servings this item currently represents, given its label serving size. */
function currentServings(item: PreviewItem): number {
  if (!item.servingGrams || item.servingGrams <= 0) return item.quantity;
  return item.grams / item.servingGrams;
}

export function EntryBox({
  parsesRemaining,
  knownMeals = [],
}: {
  parsesRemaining: number;
  /** Past meal texts, for the typeahead. Ranked by how often they were logged. */
  knownMeals?: { entryId: string; rawText: string; kcal: number; timesLogged: number }[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [eatenAt, setEatenAt] = useState(nowLocalInput);
  const [restaurant, setRestaurant] = useState("");
  const [showRestaurant, setShowRestaurant] = useState(false);

  const [scanning, setScanning] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const scanBtnRef = useRef<HTMLButtonElement>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [preview, setPreview] = useState<AnalyzeResult | null>(null);
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, startAnalyze] = useTransition();
  const [saving, startSave] = useTransition();

  /**
   * Focus the entry box on desktop only.
   *
   * `autoFocus` opened the on-screen keyboard on page load, covering half a
   * phone screen unasked — and it was what pulled focus back (re-opening the
   * keyboard) whenever the scanner overlay closed.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isDesktop = window.matchMedia("(min-width: 640px) and (pointer: fine)").matches;
    if (isDesktop && !preview && !scanning) textRef.current?.focus();
    // Run on mount only; refocusing on every state change would fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Past meals matching what has been typed so far.
   *
   * Substring matching on every whitespace-separated token, so "chicken rice"
   * finds "grilled chicken breast with a cup of white rice". Deliberately not
   * fuzzy: a wrong suggestion that logs the wrong food is worse than no
   * suggestion, and the user can always just finish typing.
   */
  const suggestions =
    text.trim().length < 2
      ? []
      : (() => {
          const needles = text.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
          return knownMeals
            .filter((m) => {
              const hay = m.rawText.toLowerCase();
              return needles.every((n) => hay.includes(n));
            })
            .slice(0, 4);
        })();

  function onRelog(entryId: string) {
    setError(null);
    startAnalyze(async () => {
      const r = await relogEntry(entryId, new Date(eatenAt).toISOString());
      if (!r.ok) {
        setError(r.error ?? "Could not add that.");
        return;
      }
      setText("");
      setShowSuggestions(false);
      router.refresh();
    });
  }

  const totals = items.reduce(
    (acc, i) => ({
      kcal: acc.kcal + i.kcal,
      protein: acc.protein + i.protein,
      carbs: acc.carbs + i.carbs,
      fat: acc.fat + i.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );

  function onAnalyze(formData: FormData) {
    setError(null);
    startAnalyze(async () => {
      const result = await analyzeEntry(formData);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        setPreview(null);
        setItems([]);
        return;
      }
      setPreview(result);
      setItems(result.items ?? []);
    });
  }

  function onSave() {
    if (!preview?.rawText || !preview.eatenAtIso) return;
    setError(null);
    startSave(async () => {
      const result = await saveEntry({
        rawText: preview.rawText!,
        eatenAtIso: preview.eatenAtIso!,
        restaurantName: preview.restaurantName ?? null,
        source: preview.restaurantName ? "restaurant" : "text",
        items,
      });
      if (!result.ok) {
        setError(result.error ?? "Could not save.");
        return;
      }
      // Reset for the next meal and pull the refreshed day from the server.
      setText("");
      setPreview(null);
      setItems([]);
      setShowSuggestions(false);
      setEatenAt(nowLocalInput());
      setRestaurant("");
      setShowRestaurant(false);
      router.refresh();
    });
  }

  function onDiscard() {
    setPreview(null);
    setItems([]);
    setError(null);
  }

  /**
   * A scanned barcode becomes a normal preview item.
   *
   * Scanning costs no model tokens and no parse quota — it is a label lookup —
   * so it goes straight into the same confirm-then-save flow as typed text, and
   * adds to an existing preview rather than replacing it (people scan several
   * items for one meal).
   */
  function onScanned(barcode: string) {
    setScanning(false);
    setError(null);
    startAnalyze(async () => {
      const result = await scanBarcode(barcode);
      if (!result.ok || !result.item) {
        setError(result.error ?? "Could not look that up.");
        return;
      }
      const item = result.item;
      setItems((prev) => [...prev, item]);
      setPreview((prev) =>
        prev
          ? { ...prev, cached: false }
          : {
              ok: true,
              items: [item],
              restaurantName: null,
              note: "",
              isFood: true,
              cached: false,
              parsesRemaining: parsesRemaining,
              rawText: item.brand ? `${item.brand} ${item.name}` : item.name,
              eatenAtIso: new Date(eatenAt).toISOString(),
            },
      );
    });
  }

  const anyEstimate = items.some((i) => i.nutritionSource === "estimate");
  const anyUnavailable = items.some((i) => i.lookupUnavailable);

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      {scanning && (
        <BarcodeScanner
          onDetected={onScanned}
          onClose={() => {
            setScanning(false);
            // Return focus to a button, never a text field: focusing an input
            // here is what re-opens the phone keyboard on close.
            requestAnimationFrame(() => scanBtnRef.current?.focus());
          }}
        />
      )}

      {!preview ? (
        <form action={onAnalyze} className="flex flex-col gap-3">
          <label htmlFor="rawText" className="text-sm font-medium">
            What did you eat?
          </label>
          <textarea
            id="rawText"
            name="rawText"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setShowSuggestions(true);
            }}
            ref={textRef}
            rows={2}
            placeholder="2 eggs, toast with butter, and a large iced coffee"
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            onKeyDown={(e) => {
              // Enter submits; Shift+Enter makes a new line. Logging a meal
              // should not require reaching for the mouse.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />

          {/* Typeahead over past meals. Re-logging one is free — it copies
              stored nutrition instead of parsing again. */}
          {showSuggestions && suggestions.length > 0 && (
            <ul className="-mt-1 flex flex-col divide-y divide-border rounded-md border border-border bg-surface-raised">
              {suggestions.map((m) => (
                <li key={m.entryId} className="flex items-center gap-2 px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs">{m.rawText}</p>
                    <p className="tnum text-[11px] text-muted">
                      {m.kcal} kcal
                      {m.timesLogged > 1 && ` · logged ${m.timesLogged}×`}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={analyzing}
                    onClick={() => onRelog(m.entryId)}
                    className="min-h-9 shrink-0 rounded-md border border-border bg-surface px-2.5 text-[11px] font-medium hover:border-accent disabled:opacity-50"
                  >
                    Log again — free
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">When</span>
              <input
                type="datetime-local"
                name="eatenAt"
                value={eatenAt}
                onChange={(e) => setEatenAt(e.target.value)}
                className="min-h-11 rounded-md border border-border bg-background px-2 text-sm"
              />
            </label>

            {showRestaurant ? (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Restaurant</span>
                <input
                  name="restaurantName"
                  value={restaurant}
                  onChange={(e) => setRestaurant(e.target.value)}
                  placeholder="Chipotle"
                  className="min-h-11 w-full rounded-md border border-border bg-background px-2 text-sm sm:w-auto"
                />
              </label>
            ) : (
              <button
                type="button"
                onClick={() => setShowRestaurant(true)}
                className="min-h-11 rounded-md border border-border px-3 text-sm text-muted hover:text-foreground"
              >
                Ate out?
              </button>
            )}

            <div className="flex gap-2 sm:ml-auto sm:contents">
              <button
                ref={scanBtnRef}
                type="button"
                onClick={() => {
                  // Dismiss the keyboard before the camera opens, or iOS keeps it
                  // over the video.
                  textRef.current?.blur();
                  setScanning(true);
                }}
                className="min-h-11 flex-1 rounded-md border border-border px-3 text-sm text-muted hover:text-foreground sm:flex-none"
                title="Scan a packaged item's barcode — exact label nutrition, and it doesn't use a parse"
              >
                Scan
              </button>

              <button
                type="submit"
                disabled={analyzing || text.trim() === ""}
                className="min-h-11 flex-[2] rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-50 sm:ml-auto sm:flex-none"
              >
                {analyzing ? "Reading…" : "Add"}
              </button>
            </div>
          </div>

          <p className="text-xs text-muted">
            {parsesRemaining} parses left today. Repeats are free.
          </p>

          {error && <p className="text-sm text-negative">{error}</p>}
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium">
              Check this before saving
              {preview.cached && (
                <span className="ml-2 text-xs font-normal text-muted">
                  (from cache — no API call)
                </span>
              )}
            </h2>
            <div className="tnum text-sm text-muted">
              {Math.round(totals.kcal)} kcal · {Math.round(totals.protein)} g protein
            </div>
          </div>

          {preview.note && (
            <p className="rounded-md bg-surface-raised px-3 py-2 text-xs text-muted">
              {preview.note}
            </p>
          )}

          <ul className="flex flex-col divide-y divide-border">
            {items.map((item, index) => {
              const badge = SOURCE_BADGE[item.nutritionSource] ?? SOURCE_BADGE.estimate;
              return (
                <li key={index} className="py-2.5">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 text-sm">
                      {item.name}
                      {item.brand && <span className="text-muted"> · {item.brand}</span>}
                    </span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${badge.className}`}
                      title={item.provenance}
                    >
                      {badge.label}
                    </span>
                  </div>

                  <div className="mt-1.5 flex items-center gap-3">
                    {/* Portion is editable because it is the biggest source of
                        error in the whole pipeline. Scanned items are measured in
                        servings (what the label states); typed items in grams. */}
                    {item.servingGrams && item.servingGrams > 0 ? (
                      <label className="flex items-center gap-1.5 text-xs text-muted">
                        <input
                          type="number"
                          min={0.25}
                          max={50}
                          step={0.25}
                          inputMode="decimal"
                          value={Number(currentServings(item).toFixed(2))}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            if (!Number.isFinite(next) || next <= 0) return;
                            setItems((prev) =>
                              prev.map((it, i) =>
                                i === index ? rescaleServings(it, next) : it,
                              ),
                            );
                          }}
                          className="tnum min-h-9 w-20 rounded border border-border bg-background px-2 text-right"
                          aria-label={`Servings of ${item.name}`}
                        />
                        <span>
                          {currentServings(item) === 1 ? "serving" : "servings"}
                          <span className="ml-1 opacity-70">
                            ({Math.round(item.servingGrams)} g each)
                          </span>
                        </span>
                      </label>
                    ) : (
                      <label className="flex items-center gap-1 text-xs text-muted">
                        <input
                          type="number"
                          min={1}
                          max={5000}
                          inputMode="numeric"
                          value={Math.round(item.grams)}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            if (!Number.isFinite(next)) return;
                            setItems((prev) =>
                              prev.map((it, i) => (i === index ? rescale(it, next) : it)),
                            );
                          }}
                          className="tnum min-h-9 w-20 rounded border border-border bg-background px-2 text-right"
                          aria-label={`Grams of ${item.name}`}
                        />
                        g
                      </label>
                    )}

                    <span className="tnum text-sm">{Math.round(item.kcal)} kcal</span>

                    <button
                      type="button"
                      onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                      className="ml-auto min-h-9 px-2 text-xs text-muted hover:text-negative"
                      aria-label={`Remove ${item.name}`}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {anyUnavailable && (
            <p className="text-xs text-warning">
              The food database was unreachable for some items, so those numbers are
              estimates. Discarding and retrying may improve them.
            </p>
          )}
          {!anyUnavailable && anyEstimate && (
            <p className="text-xs text-muted">
              Items marked <span className="text-warning">estimate</span> had no database
              match. Adjust the grams if a portion looks off.
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <button
              type="button"
              onClick={onSave}
              disabled={saving || items.length === 0}
              className="min-h-12 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-50 sm:min-h-11"
            >
              {saving ? "Saving…" : `Save ${items.length} item${items.length === 1 ? "" : "s"}`}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setScanning(true)}
                className="min-h-11 flex-1 rounded-md border border-border px-3 text-sm text-muted hover:text-foreground sm:flex-none"
              >
                Scan another
              </button>
              <button
                type="button"
                onClick={onDiscard}
                className="min-h-11 flex-1 rounded-md border border-border px-3 text-sm text-muted hover:text-foreground sm:flex-none"
              >
                Discard
              </button>
            </div>
            {error && <span className="text-sm text-negative">{error}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
