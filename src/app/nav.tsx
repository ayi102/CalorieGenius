"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Navigation, responsive by structure rather than by hiding things.
 *
 * On a phone this is a fixed bottom tab bar: it is where thumbs already are, it
 * survives scrolling, and it is the pattern people expect from an app they log
 * meals into several times a day. On wider screens the same links render inline
 * in the header, where a bottom bar would be strange.
 *
 * Both render the same list, so there is no second nav to keep in sync.
 */

const LINKS = [
  { href: "/", label: "Today", icon: "◍" },
  { href: "/month", label: "Month", icon: "▦" },
  { href: "/insights", label: "Insights", icon: "◔" },
  { href: "/settings", label: "Settings", icon: "⚙" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/day/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DesktopNav() {
  const pathname = usePathname();
  return (
    <nav className="hidden gap-1 text-sm sm:flex">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={isActive(pathname, l.href) ? "page" : undefined}
          className={`rounded-md px-3 py-1.5 transition-colors ${
            isActive(pathname, l.href)
              ? "bg-accent-soft font-medium text-foreground"
              : "text-muted hover:bg-surface-raised hover:text-foreground"
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      // pb + safe-area keeps the last tab clear of the iPhone home indicator.
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Main"
    >
      <ul className="mx-auto flex max-w-lg">
        {LINKS.map((l) => {
          const active = isActive(pathname, l.href);
          return (
            <li key={l.href} className="flex-1">
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                // min-h-14 keeps every tab a comfortable thumb target.
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${
                  active ? "text-foreground" : "text-muted"
                }`}
              >
                <span aria-hidden="true" className="text-base leading-none">
                  {l.icon}
                </span>
                <span className={active ? "font-medium" : undefined}>{l.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
