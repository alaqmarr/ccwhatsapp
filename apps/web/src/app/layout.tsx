import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://whatsapp.ccapl.cc"),
  title: "Classic Concepts WhatsApp Desk",
  description:
    "Staff, Admin, and Customer WhatsApp workspace for Classic Concepts (whatsapp.ccapl.cc).",
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
      <body className="min-h-screen w-full bg-neutral-50 text-slate-900 font-sans antialiased selection:bg-[#00a884]/15 selection:text-[#006d57]">
        {children}
      </body>
    </html>
  );
}
