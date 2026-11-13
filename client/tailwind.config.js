/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        cx: {
          // Original token names, now carrying the light "CensorX for Schools" palette.
          bg: "#ffffff",
          panel: "#ffffff",
          border: "#e5e7eb",
          accent: "#0f6b65",
          accent2: "#0f6b65",
          text: "#111827",
          muted: "#6b7280",
          // Additional light-theme tokens.
          heading: "#0b1220",
          surface: "#f6f8f8",
          hover: "#0b4f4b",
          tint: "#f3faf9",
          bright: "#32b2a9",
          deep: "#071918",
          line: "#eef0f2",
          field: "#d1d5db",
          tint2: "#e3f2f0",
          // Darker teal family used by the sidebar and the school dashboard.
          mid: "#0d5a55",
          dark: "#0a4743",
          night: "#041514",
        },
      },
      borderRadius: {
        xl2: "1rem",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { transform: "translateX(-150%) skewX(-12deg)" },
          "60%, 100%": { transform: "translateX(450%) skewX(-12deg)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        pop: {
          "0%": { opacity: "0", transform: "translateY(-4px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        "fade-up": "fadeUp 0.6s ease-out both",
        shimmer: "shimmer 4.5s ease-in-out infinite",
        float: "float 7s ease-in-out infinite",
        pop: "pop 0.16s ease-out both",
      },
      boxShadow: {
        card: "0 8px 24px rgba(11,18,32,0.06)",
        teal: "0 10px 28px rgba(15,107,101,0.22)",
      },
      fontFamily: {
        // Same stack as censorx.in (--font in censorx-website/src/styles/theme.css).
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
        ],
      },
    },
  },
  plugins: [],
};
