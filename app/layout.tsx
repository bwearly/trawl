import type { Metadata } from "next";
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
          {children}
        </AuthSessionProvider>
      </body>
    </html>
  );
}
