/** Colors are CSS variables (space-separated RGB) so dark and light themes share every class. */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './lib/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        raised: token('raised'),
        line: token('line'),
        'line-strong': token('line-strong'),
        ink: token('ink'),
        'ink-2': token('ink-2'),
        'ink-3': token('ink-3'),
        accent: token('accent'),
        'accent-strong': token('accent-strong'),
        'accent-2': token('accent-2'),
        'on-accent': token('on-accent'),
        track: token('track'),
        good: token('good'),
        bad: token('bad'),
        warn: token('warn'),
        live: token('live'),
        'live-solid': token('live-solid')
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        card: '0 1px 0 0 rgb(var(--highlight) / 0.04) inset, 0 12px 32px -16px rgb(var(--shadow) / 0.5)',
        glow: '0 0 0 1px rgb(var(--accent) / 0.35), 0 12px 40px -12px rgb(var(--accent) / 0.45)'
      },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } },
        // A score that just changed: a quick swell in the second accent, settling back.
        'score-pop': { '0%': { transform: 'scale(1.4)', color: 'rgb(var(--accent-2))' }, '100%': { transform: 'scale(1)' } },
        shake: { '0%, 100%': { transform: 'none' }, '20%, 60%': { transform: 'translateX(-4px)' }, '40%, 80%': { transform: 'translateX(4px)' } }
      },
      animation: {
        'fade-up': 'fade-up 0.35s ease-out both',
        shimmer: 'shimmer 1.6s linear infinite',
        'score-pop': 'score-pop 0.6s cubic-bezier(0.22, 1, 0.36, 1) both',
        shake: 'shake 0.45s ease-in-out both'
      }
    }
  },
  plugins: []
};
