import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Build-time constants of vite.config.ts that source files read bare. Tests run the default
  // (Verse8) edition.
  define: { __VX__: 'true' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
