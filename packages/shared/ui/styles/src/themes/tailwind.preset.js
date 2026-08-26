const defaultTheme = require('tailwindcss/defaultTheme')

function withOpacity(variableName) {
  return ({ opacityValue }) => {
    if (opacityValue !== undefined) {
      return `rgba(var(${variableName}, ${opacityValue}))`;
    }
    return `rgb(var(${variableName}))`;
  }
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    fontFamily: {
      inter: "'Inter', sans-serif",
    },
    extend: {
      fontFamily: {
        sans: ['"Inter"', ...defaultTheme.fontFamily.sans],
      },
      colors: {
        primary: withOpacity('--tas-color-primary'),
        accent: withOpacity('--tas-color-accent'),
        warn: withOpacity('--tas-color-warn'),
        neutral: withOpacity('--tas-color-neutral'),

      //   Functional notification colors
        "functional-error": "var(--tas-color-functional-error)",
        "functional-error-100":  "var(--tas-color-functional-error-100)",
        "functional-success":  "var(--tas-color-functional-success)",
        "functional-success-100":  "var(--tas-color-functional-success-100)",
        "functional-warning": "var(--tas-color-functional-warning)",
        "functional-warning-100": "var(--tas-color-functional-warning-100)",
        "functional-info":  "var(--tas-color-functional-info)",
        "functional-info-100":  "var(--tas-color-functional-info-100)",

        black: withOpacity('--tas-color-black'),
      },
      backgroundColor: {
        "surface": withOpacity('--tas-color-surface'),
      },
      container: {
        center: true
      }
    },
  },
  plugins: [
    require('@tailwindcss/forms', {
      strategy: 'class'
    }),
  ]
};
