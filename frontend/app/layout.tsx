import type { Metadata } from "next";
import { AudioEngine } from "../components/AudioEngine";
import "./globals.css";

export const metadata: Metadata = {
  title: "Freakuency — sound, off the grid",
  description: "A new frequency for the things you love to hear.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <AudioEngine />
      </body>
    </html>
  );
}
