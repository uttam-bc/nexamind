/** @type {import('tailwindcss').Config} */

// Every colour class reads a CSS variable from src/styles/palette.css, so light/dark theme and the
// Solo/Group accent switch without touching components. `indigo` is the workspace accent.
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const PALETTES = ['slate', 'rose', 'emerald', 'amber', 'purple', 'violet', 'sky', 'blue', 'cyan', 'orange', 'green', 'red', 'teal', 'yellow', 'solo', 'group'];

const scale = (prefix, name) =>
  Object.fromEntries(SHADES.map((k) => [k, `rgb(var(--${prefix}-${name}-${k}) / <alpha-value>)`]));

const palette = (prefix) => ({
  inherit: 'inherit',
  current: 'currentColor',
  transparent: 'transparent',
  black: '#000',
  // A white background is the card surface (dark grey in dark mode); white text stays white.
  white: prefix === 'bg' ? 'rgb(var(--bg-white) / <alpha-value>)' : '#fff',
  ...Object.fromEntries(PALETTES.map((name) => [name, scale(prefix, name)])),
  gray: scale(prefix, 'slate'),
  indigo: scale(prefix, 'accent'),
  accent: scale(prefix, 'accent'),
  // Semantic surfaces for new code.
  canvas: 'var(--color-canvas)',
  surface: 'var(--color-surface)',
  raised: 'var(--color-raised)',
  line: 'var(--color-border)',
  'line-strong': 'var(--color-border-strong)',
  ink: 'var(--color-text)',
  muted: 'var(--color-text-muted)',
  rail: 'var(--color-rail)',
});

const textPalette = palette('tx');

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    colors: palette('bg'),
    textColor: textPalette,
    placeholderColor: textPalette,
    caretColor: textPalette,
    textDecorationColor: textPalette,
    fill: textPalette,
    stroke: textPalette,
    extend: {
      fontFamily: {
        sans: ['"Instrument Sans"', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        // Greetings and landing headlines only.
        serif: ['"Instrument Serif"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      // Panels use the 22px card radius; controls are pills.
      borderRadius: {
        '2xl': '22px',
        '3xl': '28px',
        pill: '9999px',
      },
      transitionDuration: {
        fast: 'var(--dur-fast)',
        base: 'var(--dur-base)',
        panel: 'var(--dur-panel)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        in: 'var(--ease-in)',
        'in-out': 'var(--ease-in-out)',
      },
      // Surfaces are flat at rest: small shadows are removed, only floating layers keep depth.
      boxShadow: {
        sm: 'none',
        DEFAULT: 'none',
        xs: 'none',
        glow: 'var(--shadow-glow)',
        card: 'var(--shadow-card)',
        panel: 'var(--shadow-panel)',
      },
      animation: {
        'fade-in': 'fadeIn var(--dur-base) var(--ease-out)',
        'slide-up': 'slideUp var(--dur-panel) var(--ease-out)',
        'slide-in-right': 'slideInRight var(--dur-panel) var(--ease-out)',
        'scale-in': 'scaleIn var(--dur-panel) var(--ease-out)',
        rise: 'rise 600ms var(--ease-out) both',
        // Opacity only: a transform here would trap the screen's fixed dialogs while it runs.
        'tab-in': 'fadeIn 120ms var(--ease-out)',
        // App screens settle in quickly; the longer rise is for the landing page.
        settle: 'settle 280ms var(--ease-out) both',
        // `animate-in` was used without its plugin; it now gives the same short entrance.
        in: 'fadeIn var(--dur-base) var(--ease-out)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.97)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        settle: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        rise: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
