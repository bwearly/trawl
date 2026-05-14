"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import DevIdentitySwitcher from "@/components/dev/DevIdentitySwitcher";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/signals", label: "Signals" },
  { href: "/politicians", label: "Politicians" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/alerts", label: "Alerts" },
] as const;

export default function GlobalNav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="mr-2 text-base font-semibold tracking-tight text-gray-950 hover:text-gray-700"
        >
          Trawl
        </Link>

        <nav className="flex flex-wrap items-center gap-2" aria-label="Primary">
          {navItems.map((item) => {
            const active = isActive(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
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

        <DevIdentitySwitcher />
      </div>
    </header>
  );
}
