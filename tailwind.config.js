/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
    "./public/index.html",
  ],
  theme: {
    extend: {
      colors: {
        'paper-blue': '#1877f2',
        'paper-gray': '#f0f2f5',
      },
      fontFamily: {
        'paper': ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
