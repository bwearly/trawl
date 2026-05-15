import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import GlobalNav from "@/components/layout/GlobalNav";
import AuthSessionProvider from "@/components/auth/AuthSessionProvider";

export const metadata: Metadata = {
  title: "Trawl",
  description:
    "Public-disclosure stock research signals built from congressional trade filings.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-950">
        <AuthSessionProvider>
          <GlobalNav />
          <div className="flex-1">{children}</div>
          <footer className="border-t border-gray-200 bg-white">
            <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 text-xs text-gray-500 sm:px-6">
              <span>Research tool only — not investment advice.</span>
              <nav className="flex items-center gap-4" aria-label="Legal">
                <Link href="/disclaimer" className="hover:text-gray-700">Disclaimer</Link>
                <Link href="/privacy" className="hover:text-gray-700">Privacy</Link>
                <Link href="/terms" className="hover:text-gray-700">Terms</Link>
              </nav>
            </div>
          </footer>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
