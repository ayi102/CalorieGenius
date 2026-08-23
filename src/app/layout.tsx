import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { getSessionUser } from "@/lib/auth";
import { authMode } from "@/lib/env";
import { DevUserSwitcher } from "./dev-user-switcher";
import { DesktopNav, MobileTabBar } from "./nav";
import { listDevProfiles } from "@/lib/queries";
import { signOut } from "@/lib/auth-actions";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CalorieGenius",
  description: "Type what you ate. It works out the rest.",
  // A personal food diary. Never index it, wherever it's linked from.
  robots: { index: false, follow: false, nocache: true },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "CalorieGenius", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Let the page fill the notch area; the layout adds safe-area padding itself.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#141a22" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Display-only: decides whether to render the nav. Access control is enforced
  // by requireUser() in each page and action, not here — layouts do not re-run
  // on every navigation, so they are the wrong place for a security check.
  const user = await getSessionUser();
  const isDev = authMode() === "dev";
  const devProfiles = isDev && user ? await listDevProfiles() : [];

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {user && (
          <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
            <div
              className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5"
              style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}
            >
              <Link href="/" className="flex items-center gap-2 font-semibold">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-xs text-accent-fg">
                  cg
                </span>
                <span className="hidden sm:inline">CalorieGenius</span>
              </Link>

              <DesktopNav />

              <div className="ml-auto flex items-center gap-2 text-sm">
                {isDev ? (
                  <DevUserSwitcher profiles={devProfiles} currentUserId={user.userId} />
                ) : (
                  <>
                    <span className="hidden text-xs text-muted md:inline">
                      {user.email}
                    </span>
                    <form action={signOut}>
                      <button
                        type="submit"
                        className="rounded-md px-2.5 py-1.5 text-sm text-muted hover:bg-surface-raised hover:text-foreground"
                      >
                        Sign out
                      </button>
                    </form>
                  </>
                )}
              </div>
            </div>
          </header>
        )}
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-4 sm:pb-8 sm:pt-6">
          {children}
        </main>
        {user && <MobileTabBar />}
      </body>
    </html>
  );
}
