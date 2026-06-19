import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });
const jetBrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

// The fixed header is 57px tall; pages rely on this exact offset
// (pt-[57px] below, and `calc(100vh-57px)` in the create/share pages), so the
// header's vertical padding must not change without updating those call sites.
const HEADER_OFFSET_PIXELS = 57;
const COPYRIGHT_YEAR = 2026;

export const metadata: Metadata = {
  title: "Myunivokai",
  description: "Personal 3D universe generator"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} ${jetBrainsMono.variable}`}>
      <body>
        {/* Ambient AI-pulse orbs — one cosmic glow per corner, mounted once for
            every page (frozen under prefers-reduced-motion via globals.css). */}
        <div className="pulse-bg left-[-120px] top-[-100px] h-[500px] w-[500px] bg-primary-container" aria-hidden="true" />
        <div
          className="pulse-bg bottom-[-200px] right-[-120px] h-[600px] w-[600px] bg-secondary"
          style={{ animationDelay: "-4s" }}
          aria-hidden="true"
        />

        <div className="relative flex min-h-screen flex-col">
          <header className="fixed top-0 z-50 w-full border-b border-white/10 bg-surface/70 shadow-[0_0_20px_rgba(139,92,246,0.1)] backdrop-blur-xl">
            <div className="mx-auto flex w-full max-w-container-max items-center justify-between px-margin-mobile py-3 md:px-margin-desktop">
              <Link href="/" className="font-display text-xl font-bold tracking-wide text-primary">
                Personal Universe
              </Link>
              <nav className="flex items-center gap-3 sm:gap-6">
                <Link
                  href="/gallery"
                  className="font-mono text-xs uppercase tracking-widest text-on-surface-variant transition hover:text-secondary"
                >
                  Gallery
                </Link>
                <Link
                  href="/"
                  className="focus-ring btn-gradient rounded-full px-4 py-1.5 text-sm font-semibold"
                >
                  Create Universe
                </Link>
              </nav>
            </div>
          </header>

          <div className="flex-1" style={{ paddingTop: `${HEADER_OFFSET_PIXELS}px` }}>
            {children}
          </div>

          <footer className="relative z-10 mt-auto border-t border-white/5 bg-surface-lowest/60 backdrop-blur-sm">
            <div className="mx-auto flex w-full max-w-container-max flex-col items-center justify-between gap-2 px-margin-mobile py-8 text-center md:flex-row md:px-margin-desktop md:text-left">
              <span className="font-display text-body-lg font-bold text-primary">Personal Universe</span>
              <span className="font-body text-sm text-on-surface-variant">
                © {COPYRIGHT_YEAR} Personal Universe 3D — turn your personality into a living 3D universe.
              </span>
              <span className="font-mono text-xs uppercase tracking-widest text-secondary">MVP</span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
