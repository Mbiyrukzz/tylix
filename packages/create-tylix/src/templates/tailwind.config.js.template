/** @type {import('tailwindcss').Config} */

// Tylix UI colours. Each one reads a CSS variable from app/tailwind-input.css
// (light values on :root, dark values on .dark), so `bg-panel` or
// `text-muted` is right in both themes without a dark: variant.
const token = (name) => `rgb(var(--tx-${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./app/**/*.tyx"],
  theme: {
    extend: {
      colors: {
        canvas: token("canvas"),
        panel: token("panel"),
        raised: token("raised"),
        well: token("well"),
        line: { DEFAULT: token("line"), strong: token("line-strong") },
        ink: token("ink"),
        soft: token("soft"),
        muted: token("muted"),
        brand: { DEFAULT: token("brand"), hover: token("brand-hover"), deep: "#0034CA" },
        link: token("link"),
        mint: token("mint"),
        coral: token("coral"),
        peach: token("peach"),
        signal: token("signal"),
        aqua: token("aqua"),
      },
      fontFamily: {
        sans: "var(--tx-font)",
        mono: "var(--tx-mono)",
      },
    },
  },
  plugins: [],
};
