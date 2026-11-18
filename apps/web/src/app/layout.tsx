import type { Metadata } from "next";
import { QueryProvider } from "@/components/QueryProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Classic Concepts Internal Staff & Order Portal",
  description:
    "Internal employee CRM and order management portal for Classic Concepts (classicconcepts.in) and Classic Edge 53 (classicedge53.com). Authorized staff only.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Outfit:wght@500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body className="min-h-screen w-full font-sans antialiased bg-slate-50 text-slate-900">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
