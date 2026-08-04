import type { Config } from "tailwindcss";

const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: token("paper"),
        surface: {
          DEFAULT: token("surface"),
          2: token("surface-2"),
        },
        ink: token("ink"),
        muted: token("muted"),
        line: {
          DEFAULT: token("line"),
          strong: token("line-strong"),
        },
        seal: {
          DEFAULT: token("seal"),
          ink: token("seal-ink"),
          soft: token("seal-soft"),
        },
        ok: {
          DEFAULT: token("ok"),
          soft: token("ok-soft"),
        },
        wait: {
          DEFAULT: token("wait"),
          soft: token("wait-soft"),
        },
        danger: token("danger"),
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Escala tipográfica fija — nada fuera de ella.
        micro: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.08em" }],
        xs: ["0.75rem", { lineHeight: "1.1rem" }],
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],
        base: ["0.9375rem", { lineHeight: "1.55rem" }],
        lg: ["1.0625rem", { lineHeight: "1.6rem" }],
        xl: ["1.375rem", { lineHeight: "1.7rem" }],
        "2xl": ["1.75rem", { lineHeight: "2.1rem" }],
        "3xl": ["2.375rem", { lineHeight: "2.6rem" }],
      },
      borderRadius: {
        // Radios contenidos: papel y sellos, no burbujas.
        sm: "3px",
        DEFAULT: "5px",
        md: "6px",
        lg: "8px",
        xl: "12px",
      },
      boxShadow: {
        card: "0 1px 2px rgb(var(--ink) / 0.04), 0 8px 24px -12px rgb(var(--ink) / 0.10)",
        pop: "0 4px 12px rgb(var(--ink) / 0.08), 0 16px 40px -16px rgb(var(--ink) / 0.22)",
      },
    },
  },
  plugins: [],
};
export default config;
