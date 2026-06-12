import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });
const jetBrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  title: "Myunivokai",
  description: "Personal 3D universe generator"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} ${jetBrainsMono.variable}`}>
      <body>
        <div className="min-h-screen">
          <header className="fixed top-0 z-50 w-full border-b border-white/10 bg-surface/70 shadow-[0_0_20px_rgba(139,92,246,0.1)] backdrop-blur-xl">
            <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
              <Link href="/" className="font-display text-xl font-bold tracking-wide text-primary">
                Personal Universe
              </Link>
              <nav className="flex items-center gap-5">
                <Link
                  href="/gallery"
                  className="font-mono text-xs uppercase tracking-widest text-on-surface-variant transition hover:text-on-surface"
                >
                  Gallery
                </Link>
                <div className="font-mono text-xs uppercase tracking-widest text-secondary">MVP</div>
              </nav>
            </div>
          </header>
          <div className="pt-[57px]">{children}</div>
        </div>
      </body>
    </html>
  );
}
