import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

export default [
  // src/lib est intégralement généré par openapi-generator (npm run openapi-generator) :
  // le linter y signalait une centaine d'erreurs qu'aucune correction manuelle ne peut tenir,
  // puisque la prochaine régénération les réécrit.
  {
    ignores: ['**/src/lib/**'],
  },
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  ...baseConfig,
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
