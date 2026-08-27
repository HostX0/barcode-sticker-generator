import type { Metadata } from "next";
import "./globals.css";
import "./phase-a-overlays.css";

export const metadata: Metadata = {
  title: "Barcode Sticker Generator",
  description: "Generate serialised barcode and QR stickers from finished artwork templates.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
