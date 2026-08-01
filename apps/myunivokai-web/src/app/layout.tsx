import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import { Toaster } from "sonner";
import { gatewayOriginUrl } from "@/lib/gateway";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });
const jetBrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

// The fixed header is 57px tall. Pages now render full-bleed *behind* it so the
// 3D world shows through the glass header/footer; floating chrome offsets itself
// by ~57px (lg:top-[72px] / lg:top-[57px]) and scrolling pages add their own
// top padding to clear it.
const COPYRIGHT_YEAR = 2026;

export const metadata: Metadata = {
  title: "Myunivokai",
  description: "Personal 3D universe generator"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} ${jetBrainsMono.variable}`}>
      <body>
        <div className="relative flex min-h-screen flex-col">
          {/* Floating gallery deck: warm-black Liquid Glass with a faint brass
              bottom edge. Height must stay 57px (HEADER_OFFSET_PIXELS contract). */}
          <header className="immersive-exit immersive-exit-up fixed top-0 z-50 w-full border-b border-white/10 bg-mount/10 shadow-[0_1px_0_0_rgba(201,163,91,0.22)] backdrop-blur-md backdrop-saturate-150">
            <div className="mx-auto flex w-full max-w-container-max items-center justify-between px-margin-mobile py-3 md:px-margin-desktop">
              <Link href="/" className="font-display text-xl font-semibold tracking-normal text-paper">
                Myunivokai
              </Link>
              <nav className="flex items-center gap-3 sm:gap-6">
                <Link
                  href="/gallery"
                  className="font-mono text-xs uppercase tracking-widest text-on-surface-variant transition hover:text-secondary"
                >
                  Gallery
                </Link>
                {/* External: the Go gateway's route index (origin derived from
                    NEXT_PUBLIC_GATEWAY_BASE_URL — never hardcoded). Hidden on the
                    narrowest screens so the 57px header never wraps. */}
                <a
                  href={gatewayOriginUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Myunivokai API Gateway"
                  className="hidden font-mono text-xs uppercase tracking-widest text-on-surface-variant transition hover:text-secondary sm:inline"
                >
                  API
                </a>
                <Link
                  href="/"
                  className="focus-ring btn-gradient rounded-full px-4 py-1.5 text-sm font-semibold"
                >
                  Create World
                </Link>
              </nav>
            </div>
          </header>

          <div className="flex-1">{children}</div>

          <footer className="immersive-exit relative z-10 mt-auto border-t border-white/10 bg-void/10 shadow-[0_-1px_0_0_rgba(201,163,91,0.15)] backdrop-blur-md backdrop-saturate-150">
            <div className="mx-auto flex w-full max-w-container-max flex-col items-center justify-between gap-2 px-margin-mobile py-8 text-center md:flex-row md:px-margin-desktop md:text-left">
              <span className="font-display text-body-lg font-semibold text-paper">Myunivokai</span>
              <span className="font-body text-sm text-on-surface-variant">
                © {COPYRIGHT_YEAR} Myunivokai — turn your personality into a living 3D world.
              </span>
              <span className="font-mono text-xs uppercase tracking-widest text-secondary">MVP</span>
            </div>
          </footer>
        </div>

        {/* Liquid-Glass toasts: brief, auto-dismissing, cleared below the 57px
            header. Styled in globals.css (.lg-toast). */}
        <Toaster
          position="top-center"
          theme="dark"
          duration={2600}
          offset="72px"
          toastOptions={{ className: "lg-toast" }}
        />
      </body>
    </html>
  );
}
