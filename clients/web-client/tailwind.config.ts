import type { Config } from "tailwindcss";

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
        secondary: "#4cd7f6",
        "secondary-container": "#03b5d3",
        tertiary: "#eec200",
        error: "#ffb4ab",
        "error-container": "#93000a"
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
