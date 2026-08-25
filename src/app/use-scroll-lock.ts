"use client";

import { useEffect } from "react";

/**
 * Lock background scrolling while a modal is open, in a way iOS Safari respects.
 *
 * `document.body.style.overflow = "hidden"` is the usual one-liner and it does
 * NOT work on iOS: the page keeps scrolling behind the modal, and worse, the
 * rubber-banding can steal the gesture from a scrollable panel inside the modal
 * so it feels like the panel cannot scroll at all.
 *
 * Pinning the body with `position: fixed` and a negative top offset is what
 * actually holds, and restoring the offset on close keeps the user where they
 * were instead of throwing them back to the top.
 */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;

    const { body } = document;
    const scrollY = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";

    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      // Restoring position removes the offset, so put the scroll back manually.
      window.scrollTo(0, scrollY);
    };
  }, [active]);
}
