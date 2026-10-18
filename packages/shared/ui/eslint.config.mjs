import nx from '@nx/eslint-plugin';
import baseConfig from '../../../eslint.config.mjs';

export default [
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: ['{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}'],
          // Outillage de build et de test (cibles nx, postcss, specs vitest) : ces paquets
          // ne font pas partie de l'API de @talisoft/ui. En peerDependencies, ils
          // obligeraient tout consommateur de la librairie à installer la chaîne de build
          // du monorepo.
          ignoredDependencies: [
            'tailwindcss',
            'vite',
            '@nx/vite',
            '@nx/angular',
            '@analogjs/vite-plugin-angular',
          ],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'off'
      ],
      '@angular-eslint/component-selector': [
        'off'
      ],
    },
  },
  {
    files: ['**/*.html'],
    // Override or add rules here
    rules: {},
  },
];
