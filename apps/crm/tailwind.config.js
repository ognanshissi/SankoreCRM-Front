const { createGlobPatternsForDependencies } = require('@nx/angular/tailwind');
const { join } = require('path');
// eslint-disable-next-line @nx/enforce-module-boundaries
const talisoftTailwindPreset = require('../../packages/shared/ui/styles/src/themes/tailwind.preset');

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [talisoftTailwindPreset],
  content: [
    join(__dirname, 'src/**/!(*.stories|*.spec).{ts,html}'),
    ...createGlobPatternsForDependencies(__dirname),
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
