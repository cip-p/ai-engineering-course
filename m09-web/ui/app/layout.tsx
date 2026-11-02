import type { Metadata } from "next";
import { IBM_Plex_Mono, Literata } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Two voices: a reading serif for what people write and read (questions, answers), and a
// monospace for what the machine reports (the trace, tool calls, design names).
// next/font downloads them once and serves them from this app, not from Google.
const reading = Literata({ subsets: ["latin"], variable: "--font-reading", display: "swap" });
const machine = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-machine", display: "swap" });

export const metadata: Metadata = {
  title: "Study Buddy",
  description: "Your AI engineering course assistant, running on your laptop's model",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${reading.variable} ${machine.variable}`}>
      <body>{children}</body>
    </html>
  );
}
