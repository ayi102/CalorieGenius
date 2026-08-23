import type { MetadataRoute } from "next";

/**
 * Served at /manifest.webmanifest. This is what makes "Add to Home Screen"
 * launch a standalone app rather than a browser tab — which matters because a
 * calorie tracker is used from a phone several times a day.
 *
 * Deliberately no service worker: an offline cache would put a personal food
 * diary into on-device storage, which cuts against keeping it behind a login.
 * The app is online-only by design.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "CalorieGenius",
    short_name: "Calories",
    description: "Type what you ate. It works out the rest.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f7f6f3",
    theme_color: "#f7f6f3",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
