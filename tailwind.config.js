/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./server.js"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          500: '#0ea5e9',
          600: '#0284c7',
          900: '#0c4a6e',
        },
        dark: {
          900: '#080808',
          800: '#121212',
          700: '#1E1E1E'
        }
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out forwards',
        'fade-in-up': 'fadeInUp 0.8s ease-out forwards',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
        'shimmer': 'shimmer 3s linear infinite',
        'typewriter': 'typewriter 2s steps(20) forwards',
        'cursor-blink': 'cursorBlink 1s step-end infinite',
        'progress-load': 'progressLoad 2s ease-out forwards',
        'slide-up-fade': 'slideUpFade 0.5s ease-out forwards',
        'slide-up-wait': 'slideUpWait 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'pulse-blue': 'pulseBlue 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        glowPulse: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.8', transform: 'scale(1.05)' },
        },
        shimmer: {
          from: { backgroundPosition: '0 0' },
          to: { backgroundPosition: '-200% 0' },
        },
        typewriter: {
          from: { width: '0' },
          to: { width: '100%' }
        },
        cursorBlink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' }
        },
        progressLoad: {
          '0%': { width: '0%' },
          '100%': { width: '100%' }
        },
        slideUpFade: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        slideUpWait: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        pulseBlue: {
          '0%, 100%': { boxShadow: '0 0 0 1px rgba(59, 130, 246, 0.5), 0 0 10px rgba(59, 130, 246, 0.3)' },
          '50%': { boxShadow: '0 0 0 1px rgba(59, 130, 246, 0.8), 0 0 25px rgba(59, 130, 246, 0.6)' },
        }
      }
    },
  },
  plugins: [],
}
