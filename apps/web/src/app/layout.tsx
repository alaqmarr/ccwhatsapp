import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const plusJakarta = localFont({
  src: "./fonts/PlusJakartaSans-Variable.woff2",
  variable: "--font-jakarta",
  display: "swap",
  weight: "200 800",
});

const outfit = localFont({
  src: "./fonts/Outfit-Variable.woff2",
  variable: "--font-outfit",
  display: "swap",
  weight: "100 900",
});

const jetbrainsMono = localFont({
  src: "./fonts/JetBrainsMono-Variable.woff2",
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: "100 800",
});

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
    <html
      lang="en"
      className={`${plusJakarta.variable} ${outfit.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-screen w-full bg-neutral-50 text-slate-900 font-sans antialiased selection:bg-[#00a884]/15 selection:text-[#006d57]">
        {children}
      </body>
    </html>
  );
}
