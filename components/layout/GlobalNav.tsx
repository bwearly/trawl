"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import DevIdentitySwitcher from "@/components/dev/DevIdentitySwitcher";
import AuthNavControls from "@/components/auth/AuthNavControls";
import AlertsBellLink from "@/components/alerts/AlertsBellLink";
import GlobalSearch from "@/components/search/GlobalSearch";

const baseNavItems = [
  { href: "/", label: "Home" },
  { href: "/signals", label: "Signals" },
  { href: "/politicians", label: "Politicians" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/alerts", label: "Alerts" },
] as const;

export default function GlobalNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navItems = session?.user?.id
    ? [...baseNavItems, { href: "/account", label: "Account" as const }]
    : baseNavItems;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2.5 px-3 py-3 sm:gap-3 sm:px-6">
        <Link
          href="/"
          className="soft-hover soft-focus mr-1 rounded-full px-2 py-1 text-base font-semibold tracking-tight text-gray-950 transition hover:text-gray-700"
          onClick={() => setMobileMenuOpen(false)}
        >
          Trawl
        </Link>

        <nav className="hidden flex-wrap items-center gap-1.5 md:flex md:gap-2" aria-label="Primary">
          {navItems.map((item) => {
            const active = isActive(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`soft-hover soft-focus rounded-full px-3 py-1.5 text-sm font-medium ${
                  active
                    ? "bg-gray-900 text-white"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden md:block">
            <GlobalSearch />
          </div>
          <AlertsBellLink />
          <div className="hidden sm:block">
            <AuthNavControls />
          </div>
          {process.env.NODE_ENV !== "production" ? (
            <div className="hidden lg:block">
              <DevIdentitySwitcher />
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation-panel"
            className="soft-hover soft-focus inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-sm transition hover:border-gray-300 hover:bg-gray-50 md:hidden"
          >
            <span className="sr-only">Open navigation menu</span>
            <span className="relative h-4 w-5" aria-hidden="true">
              <span
                className={`absolute left-0 top-0 h-0.5 w-5 rounded-full bg-current transition duration-200 ${
                  mobileMenuOpen ? "translate-y-[7px] rotate-45" : ""
                }`}
              />
              <span
                className={`absolute left-0 top-[7px] h-0.5 w-5 rounded-full bg-current transition duration-200 ${
                  mobileMenuOpen ? "opacity-0" : ""
                }`}
              />
              <span
                className={`absolute left-0 top-[14px] h-0.5 w-5 rounded-full bg-current transition duration-200 ${
                  mobileMenuOpen ? "-translate-y-[7px] -rotate-45" : ""
                }`}
              />
            </span>
          </button>
        </div>
      </div>
      </header>

      <div
        className={`fixed inset-0 z-50 md:hidden ${mobileMenuOpen ? "pointer-events-auto" : "pointer-events-none"}`}
        aria-hidden={!mobileMenuOpen}
      >
        <button
          type="button"
          className={`absolute inset-0 bg-gray-950/35 backdrop-blur-[2px] transition-opacity duration-200 ${
            mobileMenuOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Close navigation menu"
        />

        <aside
          id="mobile-navigation-panel"
          className={`absolute right-0 top-0 flex h-dvh w-[min(22rem,88vw)] flex-col overflow-y-auto border-l border-gray-200 bg-white p-4 shadow-2xl transition-transform duration-300 ease-out ${
            mobileMenuOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 pb-4">
            <div>
              <p className="text-sm font-semibold tracking-tight text-gray-950">Trawl</p>
              <p className="mt-0.5 text-xs text-gray-500">Navigate your research workspace</p>
            </div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="soft-hover soft-focus inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-lg leading-none text-gray-600 transition hover:bg-gray-50"
            >
              <span className="sr-only">Close navigation menu</span>
              ×
            </button>
          </div>

          <div className="mt-4">
            <GlobalSearch variant="mobile" onNavigate={() => setMobileMenuOpen(false)} />
          </div>

          <nav className="mt-4 space-y-1" aria-label="Mobile primary navigation">
            {navItems.map((item) => {
              const active = isActive(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`soft-hover soft-focus flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                    active
                      ? "bg-gray-900 text-white shadow-md"
                      : "text-gray-700 hover:bg-gray-100 hover:text-gray-950"
                  }`}
                >
                  <span>{item.label}</span>
                  <span className="text-xs opacity-60">→</span>
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto border-t border-gray-100 pt-4 sm:hidden">
            <AuthNavControls />
          </div>
        </aside>
      </div>
    </>
  );
}
