/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Noto Sans Devanagari"', 'system-ui', 'sans-serif'],
      },
      colors: {
        khadi: {
          50: '#fdf8ec', 100: '#f9edc9', 200: '#f2d98e', 300: '#ebc053',
          400: '#e5a92d', 500: '#d98b1c', 600: '#c06a15', 700: '#9f4d15',
          800: '#813d18', 900: '#6a3317',
        },
        leaf: { 600: '#15803d', 700: '#166534' },
      },
    },
  },
  plugins: [],
};
