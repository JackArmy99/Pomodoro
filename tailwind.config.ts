import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1d1d1f", // Apple near-black
        paper: "#f5f5f7", // soft Apple grey
        accent: {
          DEFAULT: "#4f46e5", // restrained indigo accent
          hover: "#4338ca",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Text"',
          '"SF Pro Display"',
          "Inter",
          '"Helvetica Neue"',
          "Arial",
          "sans-serif",
        ],
      },
      borderRadius: {
        xl: "12px",
        "2xl": "16px",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)",
        lift: "0 10px 30px rgba(16,24,40,0.10), 0 2px 6px rgba(16,24,40,0.06)",
      },
      transitionTimingFunction: {
        apple: "cubic-bezier(0.25, 0.1, 0.25, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
