import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Build-time constants of vite.config.ts that source files read bare. Tests run the default
  // (Verse8) edition. Vitest hands these to the code as globals, not as text replaced
  // at build time, which is how the one test file about the CrazyGames SDK switches `__CG_SDK__`
  // on for itself (src/platform/crazygames.sdk.test.ts).
  define: { __VX__: 'true', __CG_SDK__: 'false', __BUILD_TAG__: "''" },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
