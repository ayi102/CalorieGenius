"use client";

import { useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "cg-theme";

/**
 * Apply a theme choice by stamping the root element.
 *
 * "system" removes the attribute entirely so the CSS media query takes over
 * again — setting data-theme to some third value would just fall through to the
 * light defaults and look like a bug.
 */
export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Private browsing or blocked storage: the choice just won't persist.
  }
  notify();
}

/**
 * localStorage as an external store, read through useSyncExternalStore.
 *
 * The right primitive for this: localStorage is genuinely external state, and
 * reading it in an effect then calling setState causes a cascading render (and a
 * lint error that is correct to complain). This also gives cross-tab sync for
 * free — changing the theme in one tab updates the others.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // `storage` fires in OTHER tabs; the local set is announced by notify().
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function notify() {
  for (const l of listeners) l();
}

function getSnapshot(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // Blocked storage — fall through to system.
  }
  return "system";
}

/** The server has no localStorage, so it always renders the system state. */
function getServerSnapshot(): ThemeChoice {
  return "system";
}

/**
 * Runs before paint, from the document head.
 *
 * Inlined as a blocking script on purpose: if the stored theme were applied
 * after hydration the page would paint in the wrong theme first and visibly
 * flash, which is worse than the few milliseconds this costs.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

const OPTIONS: { value: ThemeChoice; label: string; hint: string }[] = [
  { value: "light", label: "Light", hint: "Cream, always" },
  { value: "dark", label: "Dark", hint: "Dark, always" },
  { value: "system", label: "Auto", hint: "Follow your phone" },
];

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  // The server renders "system" and the client corrects on hydration, which is
  // exactly what useSyncExternalStore's two snapshots express.
  const choice = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  function pick(next: ThemeChoice) {
    applyTheme(next);
  }

  if (compact) {
    // Header control: one tap cycles light -> dark -> auto.
    const next: ThemeChoice =
      choice === "light" ? "dark" : choice === "dark" ? "system" : "light";
    const icon = choice === "light" ? "☀" : choice === "dark" ? "☾" : "◐";
    return (
      <button
        type="button"
        onClick={() => pick(next)}
        aria-label={`Theme: ${choice}. Switch to ${next}.`}
        title={`Theme: ${choice} — tap for ${next}`}
        className="grid h-9 w-9 place-items-center rounded-full text-base text-muted hover:bg-surface-raised hover:text-foreground"
      >
        <span aria-hidden="true">{ready ? icon : "◐"}</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Appearance</span>
      <div className="flex gap-1.5">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => pick(o.value)}
            aria-pressed={ready && choice === o.value}
            className={`min-h-11 flex-1 rounded-md border px-3 text-sm transition-colors ${
              ready && choice === o.value
                ? "border-accent bg-accent text-accent-fg"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <span className="text-xs text-muted">
        {OPTIONS.find((o) => o.value === choice)?.hint}. Saved on this device.
      </span>
    </div>
  );
}
