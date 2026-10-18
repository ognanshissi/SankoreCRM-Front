import nx from '@nx/eslint-plugin';
import { templatePlugin } from 'angular-eslint';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'off',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            {
              sourceTag: 'scope:common',
              onlyDependOnLibsWithTags: ['scope:common', 'scope:shared'],
            },
            {
              sourceTag: 'scope:crm',
              onlyDependOnLibsWithTags: ['scope:crm', 'scope:shared'],
            },
            {
              sourceTag: 'scope:admin',
              onlyDependOnLibsWithTags: ['scope:admin', 'scope:shared'],
            }
          ],
        },
      ],
    },
  },
  {
    // Les templates utilisent `x != null` comme test nullish : passer à `!==` ne couvrirait
    // plus `undefined`, et un `0` légitime (taux, probabilité, latence) ne peut pas être
    // testé par simple truthiness. L'option de la règle est faite pour ce cas.
    files: ['**/*.html'],
    plugins: { '@angular-eslint/template': templatePlugin },
    rules: {
      '@angular-eslint/template/eqeqeq': [
        'error',
        { allowNullOrUndefined: true },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {
      // Les modèles de formulaire exposent une fabrique statique et ferment le
      // constructeur pour qu'on passe par elle : ce constructeur vide est l'intention,
      // pas un oubli. L'autorisation reste limitée à ce cas.
      '@typescript-eslint/no-empty-function': [
        'error',
        { allow: ['private-constructors'] },
      ],
    },
  },
];
