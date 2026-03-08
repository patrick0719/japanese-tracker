/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
      "./src/**/*.{js,jsx,ts,tsx}",
    ],
    theme: {
      extend: {
        colors: {
          'ios-bg': '#F2F2F7',
          'ios-gray': '#8E8E93',
        }
      },
    },
    plugins: [],
  }