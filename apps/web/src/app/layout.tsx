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
      <body className="min-h-screen w-full bg-neutral-50 text-neutral-900">
        {children}
      </body>
    </html>
  );
}
