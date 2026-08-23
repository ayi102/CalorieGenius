"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  analyzeEntry,
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

export function EntryBox({ parsesRemaining }: { parsesRemaining: number }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [eatenAt, setEatenAt] = useState(nowLocalInput);
  const [restaurant, setRestaurant] = useState("");
  const [showRestaurant, setShowRestaurant] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [preview, setPreview] = useState<AnalyzeResult | null>(null);
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, startAnalyze] = useTransition();
  const [saving, startSave] = useTransition();

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

  if (scanning) {
    return (
      <BarcodeScanner onDetected={onScanned} onClose={() => setScanning(false)} />
    );
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      {!preview ? (
        <form action={onAnalyze} className="flex flex-col gap-3">
          <label htmlFor="rawText" className="text-sm font-medium">
            What did you eat?
          </label>
          <textarea
            id="rawText"
            name="rawText"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            autoFocus
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

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">When</span>
              <input
                type="datetime-local"
                name="eatenAt"
                value={eatenAt}
                onChange={(e) => setEatenAt(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
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
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
              </label>
            ) : (
              <button
                type="button"
                onClick={() => setShowRestaurant(true)}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground"
              >
                Ate out?
              </button>
            )}

            <button
              type="button"
              onClick={() => setScanning(true)}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground"
              title="Scan a packaged item's barcode — exact label nutrition, and it doesn't use a parse"
            >
              Scan barcode
            </button>

            <button
              type="submit"
              disabled={analyzing || text.trim() === ""}
              className="ml-auto rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-50"
            >
              {analyzing ? "Reading…" : "Add"}
            </button>
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
                <li key={index} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {item.name}
                    {item.brand && <span className="text-muted"> · {item.brand}</span>}
                  </span>

                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${badge.className}`}
                    title={item.provenance}
                  >
                    {badge.label}
                  </span>

                  {/* Grams is editable because portion size is the biggest
                      source of error in the whole pipeline. */}
                  <label className="flex items-center gap-1 text-xs text-muted">
                    <input
                      type="number"
                      min={1}
                      max={5000}
                      value={Math.round(item.grams)}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        if (!Number.isFinite(next)) return;
                        setItems((prev) =>
                          prev.map((it, i) => (i === index ? rescale(it, next) : it)),
                        );
                      }}
                      className="tnum w-16 rounded border border-border bg-background px-1.5 py-1 text-right text-xs"
                      aria-label={`Grams of ${item.name}`}
                    />
                    g
                  </label>

                  <span className="tnum w-20 text-right text-sm">
                    {Math.round(item.kcal)} kcal
                  </span>

                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                    className="text-xs text-muted hover:text-negative"
                    aria-label={`Remove ${item.name}`}
                  >
                    remove
                  </button>
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

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onSave}
              disabled={saving || items.length === 0}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setScanning(true)}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted hover:text-foreground"
            >
              Scan another
            </button>
            <button
              type="button"
              onClick={onDiscard}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted hover:text-foreground"
            >
              Discard
            </button>
            {error && <span className="text-sm text-negative">{error}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
