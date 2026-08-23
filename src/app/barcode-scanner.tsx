"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Camera barcode scanner.
 *
 * Uses the native `BarcodeDetector` where it exists (Chrome, Android — fast and
 * battery-cheap) and falls back to ZXing's WASM decoder where it doesn't. That
 * fallback is not optional: **Safari on iOS has no BarcodeDetector at all**, and
 * a phone is exactly where someone scans groceries.
 *
 * ZXing is imported dynamically so its bundle only loads when the scanner is
 * actually opened, rather than on every page view.
 */

interface NativeBarcodeDetector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: {
      new (options?: { formats?: string[] }): NativeBarcodeDetector;
      getSupportedFormats?: () => Promise<string[]>;
    };
  }
}

/** Formats that actually appear on packaged food. */
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];

export function BarcodeScanner({
  onDetected,
  onClose,
}: {
  onDetected: (barcode: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "error">("starting");
  const [message, setMessage] = useState<string | null>(null);
  const [engine, setEngine] = useState<"native" | "zxing" | null>(null);
  const [manual, setManual] = useState("");

  // Guards against a late async callback firing after unmount or a successful
  // scan, which would otherwise report the same barcode twice.
  const doneRef = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let rafId: number | null = null;
    let zxingControls: { stop: () => void } | null = null;

    function finish(text: string) {
      if (doneRef.current) return;
      doneRef.current = true;
      onDetected(text);
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setMessage(
          "This browser can't open the camera. Type the barcode digits instead.",
        );
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // The rear camera is what you point at a package.
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (err) {
        setStatus("error");
        setMessage(
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Camera permission was denied. Allow it in your browser settings, or type the digits below."
            : "Could not open the camera. Type the digits below.",
        );
        return;
      }

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      // iOS refuses to play an inline video without both of these.
      video.setAttribute("playsinline", "true");
      video.muted = true;
      await video.play().catch(() => {});

      // --- Preferred path: the native detector. ---
      if (typeof window !== "undefined" && window.BarcodeDetector) {
        try {
          const detector = new window.BarcodeDetector({ formats: FORMATS });
          setEngine("native");
          setStatus("scanning");

          const tick = async () => {
            if (doneRef.current) return;
            try {
              const codes = await detector.detect(video);
              if (codes.length > 0 && codes[0].rawValue) {
                finish(codes[0].rawValue);
                return;
              }
            } catch {
              // A transient decode failure is normal; keep looking.
            }
            rafId = requestAnimationFrame(tick);
          };
          rafId = requestAnimationFrame(tick);
          return;
        } catch {
          // Constructor threw (e.g. unsupported format list) — fall through.
        }
      }

      // --- Fallback: ZXing. Required on iOS Safari. ---
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        setEngine("zxing");
        setStatus("scanning");

        zxingControls = await reader.decodeFromVideoElement(video, (result) => {
          // ZXing's Result keeps `text` private — getText() is the accessor.
          const text = result?.getText();
          if (text) finish(text);
        });
      } catch {
        setStatus("error");
        setMessage("Scanning isn't available here. Type the digits below.");
      }
    }

    void start();

    return () => {
      doneRef.current = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      zxingControls?.stop();
      // Releasing every track matters: a live camera left running drains the
      // battery and leaves the indicator light on.
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onDetected]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Scan a barcode</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-foreground"
        >
          Close
        </button>
      </div>

      <div className="relative overflow-hidden rounded-md bg-black">
        <video
          ref={videoRef}
          className="h-56 w-full object-cover"
          playsInline
          muted
        />
        {status === "scanning" && (
          // A framing guide: people aim much better with a target than without.
          <div
            className="pointer-events-none absolute inset-0 grid place-items-center"
            aria-hidden="true"
          >
            <div className="h-20 w-4/5 rounded border-2 border-white/70" />
          </div>
        )}
      </div>

      <p className="text-xs text-muted" role="status">
        {status === "starting" && "Opening the camera…"}
        {status === "scanning" &&
          `Point the rear camera at the barcode.${engine === "zxing" ? " (Using the software decoder.)" : ""}`}
        {status === "error" && <span className="text-warning">{message}</span>}
      </p>

      {/* Always available, not only on failure: some barcodes are creased,
          curved, or badly lit, and typing 12 digits beats fighting the camera. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const digits = manual.replace(/\D/g, "");
          if (digits.length >= 8) onDetected(digits);
        }}
        className="flex items-end gap-2"
      >
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-muted">Or type the digits</span>
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            inputMode="numeric"
            placeholder="3017624010701"
            className="tnum rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={manual.replace(/\D/g, "").length < 8}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-50"
        >
          Look up
        </button>
      </form>
    </div>
  );
}
