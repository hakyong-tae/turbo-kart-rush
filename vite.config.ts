import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/**
 * A stamp the running game can show.
 *
 * QA and the build they are holding kept drifting apart: a round of findings came back against a
 * version that predated the fixes for them, and neither side could tell. The lobby now prints
 * this, so a screenshot says which build it is.
 */
function buildId(): string {
  let sha = 'nogit';
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    // Tracked files only. `npm install` leaves an untracked package-lock.json behind, and counting
    // that would put a "+" on every clean build the Verse8 builder makes — a marker that cries
    // wolf is worse than no marker.
    const dirty = execSync('git status --porcelain --untracked-files=no', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (dirty) sha += '+';
  } catch {
    /* building outside a checkout (the Verse8 builder may do this) — the date still identifies it */
  }
  const d = new Date();
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${day}-${sha}`;
}

export default defineConfig({
  base: './',
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  server: { port: 5178, strictPort: false, open: false },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
});
