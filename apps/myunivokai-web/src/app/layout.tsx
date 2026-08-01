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

// The header and the footer are both fixed and both 57px tall (the
// --header-height / --footer-height contract in globals.css). Pages render
// full-bleed *behind* both, so the 3D world runs edge to edge and the chrome
// frames it; floating chrome offsets itself by those heights and scrolling
// pages add their own top and bottom padding to clear them.
//
// Both bars are pointer-transparent except on their own controls. They are
// nearly invisible over a live world now, and a full-width bar that silently
// ate orbit-drags — and, before this, the create page's own toggle — is not a
// bar the user can see any reason for. The toggle could not simply outrank the
// header with a z-index: app/template.tsx wraps every page in an opacity
// animation, which creates a stacking context, so page content can never rise
// above sibling chrome no matter what z-index it asks for.
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
          <header className="immersive-exit immersive-exit-up chrome-bar pointer-events-none fixed top-0 z-50 w-full border-b border-hairline bg-mount/10 backdrop-saturate-[1.25]">
            <div className="mx-auto flex w-full max-w-container-max items-center justify-between px-margin-mobile py-3 md:px-margin-desktop">
              <Link
                href="/"
                className="pointer-events-auto font-display text-xl font-semibold tracking-normal text-paper"
              >
                Myunivokai
              </Link>
              <nav className="pointer-events-auto flex items-center gap-3 sm:gap-6">
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

          {/* Fixed and slim, mirroring the header: the world runs underneath it
              so the chrome frames the scene instead of ending it. It used to be
              a tall in-flow band, which put a hard edge across the bottom of
              every full-bleed page and left the 3D stopping short of the
              viewport. Its rows collapse to one line so 57px is enough at every
              width — the copyright sentence is the part that would have
              wrapped, so it hides on the narrowest screens. */}
          <footer className="immersive-exit chrome-bar pointer-events-none fixed bottom-0 z-50 w-full border-t border-hairline bg-void/10 backdrop-saturate-[1.25]">
            <div className="mx-auto flex w-full max-w-container-max items-center justify-between gap-4 px-margin-mobile py-3 md:px-margin-desktop">
              <span className="pointer-events-auto font-display text-base font-semibold text-paper">Myunivokai</span>
              <span className="pointer-events-auto hidden font-body text-xs text-on-surface-variant sm:inline">
                © {COPYRIGHT_YEAR} Myunivokai — turn your personality into a living 3D world.
              </span>
              <span className="pointer-events-auto font-mono text-xs uppercase tracking-widest text-secondary">MVP</span>
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
