import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';

/**
 * A stamp the running game can show.
 *
 * QA and the build they are holding kept drifting apart: a round of findings came back against a
 * version that predated the fixes for them, and neither side could tell. The lobby now prints
 * this, so a screenshot says which build it is.
 */
/** Short hash of everything that goes into the bundle. Identifies the source with no git at all. */
function sourceHash(): string {
  const h = createHash('sha1');
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|css|html|js)$/.test(name)) {
        h.update(name);
        h.update(readFileSync(full));
      }
    }
  };
  try {
    walk('src');
    for (const f of ['index.html', 'server.js']) {
      try {
        h.update(readFileSync(f));
      } catch {
        /* optional */
      }
    }
  } catch {
    return 'unknown';
  }
  return h.digest('hex').slice(0, 7);
}

function buildId(): string {
  // The source hash is always present, because it is the only part both sides can compare: the
  // Verse8 builder has no git (it reported a bare `nogit`, which told us the date and nothing
  // else), while a local checkout does. Quoting `s<hash>` from a deployed title screen and
  // matching it against a build of this tree settles "is the fix live?" with no guessing.
  const parts = [`s${sourceHash()}`];
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    // Tracked files only. `npm install` leaves an untracked package-lock.json behind, and counting
    // that would put a "+" on every clean build the Verse8 builder makes — a marker that cries
    // wolf is worse than no marker.
    const dirty = execSync('git status --porcelain --untracked-files=no', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    parts.unshift(dirty ? `${sha}+` : sha);
  } catch {
    /* no checkout — the source hash alone identifies it */
  }
  const d = new Date();
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${day}-${parts.join('-')}`;
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
