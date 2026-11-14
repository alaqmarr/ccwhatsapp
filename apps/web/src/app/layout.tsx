import type { Metadata } from "next";
import {
  JetBrains_Mono,
  Outfit,
  Plus_Jakarta_Sans,
} from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
  weight: ["500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: ["400", "500", "600"],
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
