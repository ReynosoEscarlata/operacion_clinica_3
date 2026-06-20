import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ice: '#F7F9FC',
        'blue-100': '#E8F0FE',
        'blue-500': '#2563EB',
        'blue-700': '#1D4ED8',
        'black-900': '#0F172A',
        'black-600': '#475569',
        'black-300': '#CBD5E1',
        success: '#16A34A',
        warning: '#D97706',
        danger: '#DC2626',
        muted: '#94A3B8',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      spacing: {
        4.5: '18px',
      },
      borderRadius: {
        btn: '6px',
        card: '8px',
        modal: '12px',
      },
    },
  },
  plugins: [],
} satisfies Config;
