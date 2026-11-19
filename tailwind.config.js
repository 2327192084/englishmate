/** @type {import('tailwindcss').Config} */

/**
 * 关键：颜色用 `rgb(var(--x) / <alpha-value>)` 而不是 `var(--x)`。
 *
 * Tailwind 的透明度修饰符（bg-accent/10）是通过把 `<alpha-value>` 替换成通道值实现的。
 * 如果这里写成 `var(--tf-accent)`，Tailwind 无法拆出通道，`bg-accent/10` 这类类名
 * 会被**静默丢弃**——样式不生效但不报错，非常难查。
 * 因此 CSS 变量里存的是 "88 166 255" 这样的通道值，不是 #58a6ff。
 */
const channel = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: channel('--tf-bg'),
        surface: channel('--tf-surface'),
        surface2: channel('--tf-surface-2'),
        line: channel('--tf-border'),
        ink: channel('--tf-text'),
        muted: channel('--tf-muted'),
        accent: channel('--tf-accent'),
        correct: channel('--tf-correct'),
        error: channel('--tf-error'),
        pending: channel('--tf-pending'),
      },
      fontFamily: {
        mono: [
          'ui-monospace',
          'SF Mono',
          'Cascadia Code',
          'JetBrains Mono',
          'Consolas',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
};
