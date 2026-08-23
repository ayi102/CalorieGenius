"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Full-screen barcode scanner.
 *
 * Presented as a modal overlay rather than an inline card: aiming a camera needs
 * as much of the screen as it can get, and a small inline preview makes people
 * hunt for the barcode. The page underneath stays mounted, so closing returns to
 * exactly the state they left.
 *
 * Decoding uses the native `BarcodeDetector` where it exists (Chrome, Android —
 * fast and battery-cheap) and falls back to ZXing's WASM decoder where it does
 * not. That fallback is not optional: Safari on iOS has no BarcodeDetector, and
 * a phone is exactly where groceries get scanned.
 *
 * ZXing is imported dynamically so its bundle only loads when the scanner opens.
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
  const closeRef = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "error">("starting");
  const [message, setMessage] = useState<string | null>(null);
  const [engine, setEngine] = useState<"native" | "zxing" | null>(null);
  const [manual, setManual] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [flash, setFlash] = useState(false);

  // Guards a late async callback firing after unmount or a successful scan,
  // which would otherwise report the same barcode twice.
  const doneRef = useRef(false);

  const finish = useCallback(
    (text: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      // A brief flash confirms the capture — without it a successful scan and a
      // frozen camera look identical.
      setFlash(true);
      onDetected(text);
    },
    [onDetected],
  );

  // Lock background scrolling while the overlay is open, so dragging on the
  // camera view doesn't scroll the page behind it.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let rafId: number | null = null;
    let zxingControls: { stop: () => void } | null = null;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setMessage("This browser can't open the camera. Type the digits instead.");
        setShowManual(true);
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            // Ask for a higher resolution than the default: barcode stripes are
            // fine detail, and 480p decodes noticeably worse.
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (err) {
        setStatus("error");
        setMessage(
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Camera permission denied. Allow it in your browser settings, or type the digits."
            : "Could not open the camera. Type the digits instead.",
        );
        setShowManual(true);
        return;
      }

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      // iOS refuses to play an inline video without both of these.
      video.setAttribute("playsinline", "true");
      video.muted = true;
      await video.play().catch(() => {});

      // --- Preferred: the native detector. ---
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
              // Transient decode failures are normal; keep looking.
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
          const text = result?.getText();
          if (text) finish(text);
        });
      } catch {
        setStatus("error");
        setMessage("Scanning isn't available here. Type the digits instead.");
        setShowManual(true);
      }
    }

    void start();

    return () => {
      doneRef.current = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      zxingControls?.stop();
      // Releasing every track matters: a live camera drains the battery and
      // leaves the indicator light on.
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [finish]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scan a barcode"
      className="fixed inset-0 z-50 flex flex-col bg-black"
    >
      {/* Camera fills the frame. */}
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        playsInline
        muted
        aria-hidden="true"
      />

      {/* Capture confirmation. */}
      {flash && (
        <div className="absolute inset-0 z-20 animate-pulse bg-white/70" aria-hidden="true" />
      )}

      {/* Header: close button, generously sized and clear of the notch. */}
      <div
        className="relative z-10 flex items-center justify-between gap-3 px-4 py-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <span className="rounded-full bg-black/50 px-3 py-1.5 text-sm font-medium text-white backdrop-blur">
          Scan a barcode
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close scanner"
          className="grid h-11 w-11 place-items-center rounded-full bg-black/50 text-xl text-white backdrop-blur"
        >
          ✕
        </button>
      </div>

      {/* Framing guide. The huge translucent border dims everything outside the
          target without a second stacked element. */}
      <div className="relative z-10 flex flex-1 items-center justify-center px-6">
        {status === "scanning" && (
          <div className="w-full max-w-sm" aria-hidden="true">
            <div className="relative aspect-[5/3] w-full rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]">
              {/* Corner ticks read as a target more clearly than a full box. */}
              {[
                "left-0 top-0 border-l-4 border-t-4 rounded-tl-2xl",
                "right-0 top-0 border-r-4 border-t-4 rounded-tr-2xl",
                "left-0 bottom-0 border-l-4 border-b-4 rounded-bl-2xl",
                "right-0 bottom-0 border-r-4 border-b-4 rounded-br-2xl",
              ].map((c) => (
                <span key={c} className={`absolute h-10 w-10 border-white/90 ${c}`} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer: status, then the manual fallback. */}
      <div
        className="relative z-10 flex flex-col gap-3 bg-gradient-to-t from-black/80 to-transparent px-4 pt-8"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <p className="text-center text-sm text-white/90" role="status">
          {status === "starting" && "Opening the camera…"}
          {status === "scanning" &&
            `Fill the frame with the barcode.${engine === "zxing" ? " (Software decoder.)" : ""}`}
          {status === "error" && <span className="text-amber-300">{message}</span>}
        </p>

        {showManual ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const digits = manual.replace(/\D/g, "");
              if (digits.length >= 8) finish(digits);
            }}
            className="flex items-center gap-2"
          >
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              inputMode="numeric"
              autoFocus
              placeholder="Barcode digits"
              aria-label="Barcode digits"
              className="tnum min-h-12 flex-1 rounded-lg border border-white/30 bg-black/60 px-3 text-white placeholder:text-white/50"
            />
            <button
              type="submit"
              disabled={manual.replace(/\D/g, "").length < 8}
              className="min-h-12 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-40"
            >
              Look up
            </button>
          </form>
        ) : (
          // Always reachable, not only after a failure: creased and curved
          // barcodes are common, and typing 12 digits beats fighting the camera.
          <button
            type="button"
            onClick={() => setShowManual(true)}
            className="min-h-11 self-center rounded-full bg-black/50 px-4 text-sm text-white/90 backdrop-blur"
          >
            Enter the digits instead
          </button>
        )}
      </div>
    </div>
  );
}
