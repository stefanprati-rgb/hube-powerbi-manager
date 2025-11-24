/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                hube: {
                    green: '#00D655',
                    dark: '#1D1D1F',
                }
            },
        },
    },
    plugins: [],
}
