import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

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

/**
 * Build targets (src/core/platform.ts). `vite build` is the Verse8 / ONE store edition and goes to
 * `dist/`. `vite build --mode crazygames` is the CrazyGames edition: no purchase UI, the account
 * kept in the browser. It goes to `dist-crazygames/` so the two never overwrite each other. Both
 * carry the same name, which index.html has as written (title, tab icon, splash).
 */
const TARGETS: Record<string, { outDir: string }> = {
  crazygames: { outDir: 'dist-crazygames' },
};

/** Wording that belongs to the Verse8 edition: the VX pass, rewarded ads, the host itself. */
const OTHER_EDITION = /\bVX\b|\bads?\b|Verse8|광고/i;

/**
 * Rewrites the two locale tables for a target that is not Verse8. An entry with a `<key>@<target>`
 * variant takes the variant's wording, the variants themselves are dropped, and whatever still
 * talks about the VX pass, ads or Verse8 is removed: those lines sit behind buttons this edition
 * does not have, and a build that cannot show them should not ship them either. (If one is ever
 * reached, `t()` prints the bare key, which is a bug that cannot be missed.)
 */
function targetLocales(target: string): Plugin {
  const suffix = `@${target}`;
  return {
    name: 'target-locales',
    enforce: 'pre',
    transform(code, id) {
      if (!/src\/core\/locales\/(en|ko)\.ts$/.test(id.split('?')[0])) return null;
      const start = code.indexOf('{', code.indexOf('export const'));
      const end = code.lastIndexOf('}');
      const table = new Function(`return (${code.slice(start, end + 1)});`)() as Record<string, string>;
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(table)) {
        if (key.includes('@')) continue;
        const text = table[key + suffix] ?? value;
        if (!OTHER_EDITION.test(text)) out[key] = text;
      }
      return { code: code.slice(0, start) + JSON.stringify(out) + code.slice(end + 1), map: null };
    },
  };
}

/**
 * server.js travels inside the page as text (`?raw`, for the in-page server of localServer.ts).
 * Its comments are written for whoever maintains the Verse8 deployment; a build for somewhere else
 * ships the code without them. Whole-line comments only, which is every comment the file has that
 * says anything: nothing here parses JavaScript.
 */
function serverWithoutComments(): Plugin {
  return {
    name: 'server-without-comments',
    enforce: 'pre',
    transform(code, id) {
      if (!/\/server\.js\?raw$/.test(id)) return null;
      // By the time a `?raw` module reaches a plugin it is `export default "<the text>"`.
      const match = /^export default (".*")\s*;?\s*$/s.exec(code);
      if (!match) return null;
      const text = (JSON.parse(match[1]) as string)
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
        .join('\n');
      return { code: `export default ${JSON.stringify(text)};`, map: null };
    },
  };
}

/** Sends the Verse8 SDK imports to the local stand-ins (src/verse8/stubs/sdk.ts). */
const SDK_STUB = fileURLToPath(new URL('./src/verse8/stubs/sdk.ts', import.meta.url));
const SDK_ALIASES = [
  { find: /^@agent8\/gameserver(\/.*)?$/, replacement: SDK_STUB },
  { find: /^@verse8\/platform\/vanilla$/, replacement: SDK_STUB },
  { find: /^@verse8\/ads$/, replacement: SDK_STUB },
];

/** The CrazyGames HTML5 SDK. The same address as `SDK_URL` in src/platform/crazygames.ts. */
const CG_SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const CG_SDK_TAG =
  `<script async src="${CG_SDK_URL}" onerror="this.dataset.failed='1'" ` +
  `onload="try{window.__cgInit=window.CrazyGames.SDK.init().then(function(){return null},function(e){return e||new Error('init failed')})}catch(e){window.__cgInit=Promise.resolve(e)}"></script>`;

export default defineConfig(({ mode }) => {
  const target = TARGETS[mode];
  const withSdk = mode === 'crazygames' && process.env.CG_SDK !== '0';
  return {
    base: './',
    define: {
      __BUILD_ID__: JSON.stringify(buildId()),
      // A bare boolean the minifier can fold: code behind `if (!__VX__) return` leaves the bundle.
      __VX__: JSON.stringify(!target),
      // The CrazyGames edition carries the portal's SDK unless it is built with CG_SDK=0
      // (`CG_SDK=0 npm run build:crazygames`): the way out if the SDK ever gets in QA's way.
      __CG_SDK__: JSON.stringify(withSdk),
    },
    resolve: { alias: target ? SDK_ALIASES : [] },
    // An edition's dev server keeps its pre-bundled dependencies to itself. The editions do not
    // depend on the same packages (the SDK stand-ins above), and two dev servers sharing one cache
    // folder overwrite each other's: the one started first then answers 504 "Outdated Optimize
    // Dep" for its SDK imports and the game never starts.
    cacheDir: target ? `node_modules/.vite-${mode}` : 'node_modules/.vite',
    server: { port: 5178, strictPort: false, open: false },
    build: {
      target: 'es2022',
      sourcemap: false,
      chunkSizeWarningLimit: 2000,
      outDir: target?.outDir ?? 'dist',
    },
    plugins: target
      ? [
          targetLocales(mode),
          serverWithoutComments(),
          {
            name: 'target-page',
            // index.html is written for the default edition; what another edition needs different
            // in the page itself is done here. Its fonts: this edition asks no other host for a
            // font, so the Google Fonts tags go and the copies in src/assets/fonts take their
            // place. `pre`, so that Vite still bundles the stylesheet this adds. And the portal's
            // SDK tag. (The name is the same in every edition and is not touched.)
            transformIndexHtml: {
              order: 'pre',
              handler: (html: string) => {
                const out = html
                  .replace(/\s*<link rel="preconnect"[^>]*>/g, '')
                  .replace(/<link\s+rel="stylesheet"\s+href="https:\/\/fonts\.googleapis\.com[^>]*>/, '<link rel="stylesheet" href="/src/styles/fonts-local.css" />')
                  // The portal's SDK, asked for from the first bytes of the page so that it downloads
                  // alongside the game's own code. `async`: nothing waits for it, and a host that is
                  // blocked or slow costs the first screen nothing. Its init() is started the moment
                  // the script is in, for the same reason: it takes a fifth of a second of waiting,
                  // which is free while the game's bundle is still on its way. `__cgInit` settles to
                  // null, or to the error. src/platform/crazygames.ts picks all of this up (and reads
                  // `data-failed` if the error came before it was listening).
                  .replace(/(<title>[^<]*<\/title>)/, withSdk ? `$1\n    ${CG_SDK_TAG}` : '$1');
                if (withSdk !== out.includes(CG_SDK_URL)) throw new Error('target-page: the SDK tag is not where it should be');
                if (/fonts\.g(oogleapis|static)\.com/.test(out)) throw new Error('target-page: index.html still points at Google Fonts');
                return out;
              },
            },
            // The fonts are under the SIL Open Font License, which asks that its text travel with
            // every copy: the three licence files go out next to the build.
            generateBundle() {
              const dir = 'src/assets/fonts';
              for (const name of readdirSync(dir).filter((f) => f.endsWith('-OFL.txt'))) {
                this.emitFile({ type: 'asset', fileName: `licenses/${name}`, source: readFileSync(join(dir, name)) });
              }
            },
          },
        ]
      : [],
  };
});
