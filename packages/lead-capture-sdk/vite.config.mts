/// <reference types='vitest' />
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/lead-capture-sdk',
  test: {
    name: 'lead-capture-sdk',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.ts'],
    reporters: ['default'],
  },
}));
