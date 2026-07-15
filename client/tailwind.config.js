/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        cx: {
          bg: "#05070d",
          panel: "#0b0f1a",
          border: "#1b2436",
          accent: "#22d3ee",
          accent2: "#34d399",
          text: "#e6edf3",
          muted: "#8b98ab",
        },
      },
      borderRadius: {
        xl2: "1rem",
      },
    },
  },
  plugins: [],
};
