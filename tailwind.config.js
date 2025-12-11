/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                background: "var(--background)",
                foreground: "var(--foreground)",
                "brand-primary": "#F8FE62",
                "brand-dark": "#0E0F13",
                "brand-white": "#FFFEFE",
            },
            fontFamily: {
                clash: ["ClashDisplay", "sans-serif"],
            },
        },
    },
    plugins: [],
};
