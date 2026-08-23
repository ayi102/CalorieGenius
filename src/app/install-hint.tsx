"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * "Add to Home Screen" prompt.
 *
 * Worth its own component because the two platforms are genuinely different:
 *
 *  - Android/Chrome fires `beforeinstallprompt`, so we can offer a real button
 *    that opens the native install dialog.
 *  - iOS Safari has no such event and never will. The only option is telling
 *    the user where to tap — Share, then Add to Home Screen. Showing an
 *    "Install" button there would be a lie.
 *
 * Hidden once installed, and dismissible — a banner that cannot be closed is
 * worse than no banner.
 */

const DISMISS_KEY = "cg-install-dismissed";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS exposes its own flag rather than supporting display-mode.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac; the touch check separates them.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * Whether the hint applies, read as external browser state.
 *
 * A plain string, not an object: useSyncExternalStore compares snapshots by
 * identity, so returning a fresh object every call would loop forever.
 */
type HintState = "hidden" | "ios" | "installable";

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function notify() {
  for (const l of listeners) l();
}

function getSnapshot(): HintState {
  // Already installed, or dismissed before: say nothing.
  if (isStandalone()) return "hidden";
  try {
    if (localStorage.getItem(DISMISS_KEY) === "1") return "hidden";
  } catch {
    // Blocked storage — fall through and show it.
  }
  return isIos() ? "ios" : "installable";
}

/** The server knows nothing about the device, so it renders nothing. */
function getServerSnapshot(): HintState {
  return "hidden";
}

export function InstallHint() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);

  // Legal in an effect: setState happens inside the event callback, not
  // synchronously in the effect body.
  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Suppress Chrome's own mini-infobar so there is only one prompt.
      e.preventDefault();
      setPromptEvent(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Not persisting a dismissal is a minor annoyance, not a failure.
    }
    notify();
  }

  const ios = state === "ios";

  if (state === "hidden") return null;
  // Non-iOS browsers only get the hint once the install prompt is actually
  // available — otherwise the button would have nothing to open.
  if (!ios && !promptEvent) return null;

  return (
    <aside className="card flex items-start gap-3 p-3.5">
      <span
        aria-hidden="true"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-xs text-accent-fg"
      >
        cg
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Add to your home screen</p>
        {ios ? (
          <p className="mt-0.5 text-xs text-muted">
            Tap <span className="text-foreground">Share</span> at the bottom of
            Safari, then{" "}
            <span className="text-foreground">Add to Home Screen</span>. It opens
            like an app after that.
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-muted">
            Opens like an app, without the browser bars.
          </p>
        )}

        <div className="mt-2.5 flex gap-2">
          {!ios && promptEvent && (
            <button
              type="button"
              onClick={async () => {
                await promptEvent.prompt();
                const { outcome } = await promptEvent.userChoice;
                // Either way the prompt is spent and cannot be reused.
                // Either outcome spends the prompt; hide the banner regardless.
                dismiss();
                if (outcome === "accepted") setPromptEvent(null);
              }}
              className="min-h-9 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg"
            >
              Install
            </button>
          )}
          <button
            type="button"
            onClick={dismiss}
            className="min-h-9 rounded-md border border-border px-3 text-xs text-muted hover:text-foreground"
          >
            {ios ? "Got it" : "Not now"}
          </button>
        </div>
      </div>
    </aside>
  );
}
