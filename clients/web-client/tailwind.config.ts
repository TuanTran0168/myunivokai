import type { Config } from "tailwindcss";

// Mirrors notes/stitch_personal_universe_3d_v2/personal_universe_3d/DESIGN.md.
// These are the single source of truth for the cosmic "command deck" look; the
// UI-overhaul branches (U1-U4) compose layouts from these tokens rather than
// reaching for raw hex values or ad-hoc text-[..] sizes.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#0e1323",
        "surface-lowest": "#080d1d",
        "surface-low": "#161b2b",
        "surface-container": "#1a1f30",
        "surface-high": "#25293a",
        "surface-bright": "#34394a",
        "on-surface": "#dee1f9",
        "on-surface-variant": "#cbc3d7",
        outline: "#958ea0",
        "outline-variant": "#494454",
        primary: "#d0bcff",
        "primary-container": "#a078ff",
        "primary-fixed": "#e9ddff",
        "on-primary-fixed": "#23005c",
        secondary: "#4cd7f6",
        "secondary-container": "#03b5d3",
        "secondary-fixed": "#acedff",
        "on-secondary-fixed": "#001f26",
        tertiary: "#eec200",
        error: "#ffb4ab",
        "error-container": "#93000a"
      },
      fontSize: {
        "display-lg": ["48px", { lineHeight: "1.1", letterSpacing: "0.05em", fontWeight: "700" }],
        "display-lg-mobile": ["32px", { lineHeight: "1.2", letterSpacing: "0.05em", fontWeight: "700" }],
        "headline-md": ["24px", { lineHeight: "1.3", letterSpacing: "0.02em", fontWeight: "600" }],
        "body-lg": ["18px", { lineHeight: "1.6", fontWeight: "400" }],
        "label-caps": ["12px", { lineHeight: "1", letterSpacing: "0.1em", fontWeight: "500" }],
        "stat-lg": ["28px", { lineHeight: "1", fontWeight: "600" }]
      },
      maxWidth: {
        "container-max": "1440px"
      },
      spacing: {
        "margin-mobile": "16px",
        "margin-desktop": "48px",
        gutter: "24px"
      },
      boxShadow: {
        glow: "0 0 24px rgba(160, 120, 255, 0.28)",
        cyan: "0 0 24px rgba(76, 215, 246, 0.22)"
      },
      fontFamily: {
        display: ["var(--font-space-grotesk)", "var(--font-inter)", "sans-serif"],
        body: ["var(--font-inter)", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "monospace"]
      }
    }
  },
  plugins: []
};

export default config;
