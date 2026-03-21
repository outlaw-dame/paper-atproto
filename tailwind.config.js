/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
    "./index.html",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        glimpse: {
          blue:   '#0A84FF',
          indigo: '#5E5CE6',
          teal:   '#32ADE6',
          green:  '#30D158',
          orange: '#FF9F0A',
          red:    '#FF453A',
          pink:   '#FF375F',
          purple: '#BF5AF2',
        },
      },
      fontFamily: {
        sans: ['-apple-system','BlinkMacSystemFont','"SF Pro Display"','"SF Pro Text"','"Helvetica Neue"','Inter','sans-serif'],
        mono: ['"SF Mono"','"Fira Code"','monospace'],
      },
      borderRadius: {
        card:  '16px',
        chip:  '100px',
        sheet: '20px',
        story: '24px',
      },
      boxShadow: {
        card:    '0 2px 12px rgba(0,0,0,0.08)',
        'card-lg':'0 8px 32px rgba(0,0,0,0.12)',
        sheet:   '0 -2px 24px rgba(0,0,0,0.12)',
      },
      animation: {
        'fade-in':    'fadeIn 0.2s ease-out',
        'slide-up':   'slideUp 0.35s cubic-bezier(0.32,0.72,0,1)',
        'card-enter': 'cardEnter 0.4s cubic-bezier(0.32,0.72,0,1)',
      },
      keyframes: {
        fadeIn:    { from:{opacity:'0'}, to:{opacity:'1'} },
        slideUp:   { from:{transform:'translateY(100%)'}, to:{transform:'translateY(0)'} },
        cardEnter: { from:{transform:'translateY(24px)',opacity:'0'}, to:{transform:'translateY(0)',opacity:'1'} },
      },
    },
  },
  plugins: [],
};
