"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import DevIdentitySwitcher from "@/components/dev/DevIdentitySwitcher";
import AuthNavControls from "@/components/auth/AuthNavControls";
import AlertsBellLink from "@/components/alerts/AlertsBellLink";

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
  const navItems = session?.user?.id
    ? [...baseNavItems, { href: "/account", label: "Account" as const }]
    : baseNavItems;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2.5 px-3 py-3 sm:gap-3 sm:px-6">
        <Link
          href="/"
          className="mr-1 text-base font-semibold tracking-tight text-gray-950 transition hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900/30"
        >
          Trawl
        </Link>

        <nav className="flex flex-wrap items-center gap-1.5 sm:gap-2" aria-label="Primary">
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
          <AlertsBellLink />
          <AuthNavControls />
          {process.env.NODE_ENV !== "production" ? <DevIdentitySwitcher /> : null}
        </div>
      </div>
    </header>
  );
}
