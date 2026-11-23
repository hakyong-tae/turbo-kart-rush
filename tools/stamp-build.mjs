// Stamps src/buildInfo with the current source commit and time (KST) right before a Verse8 push; commit the
// stamp with it. It is how a build made without a git checkout knows which commit it is: vite.config.ts (`buildTag`)
// reads it for the small "build MM/DD HH:MM · <sha>" badge the game shows until the first tap or key press. A build
// made from a checkout goes by its own HEAD, and names this commit after it (`· src <sha>`) when the checkout is
// another repository's, as the Verse8 one is.
// Usage: node tools/stamp-build.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const sha = execSync('git rev-parse --short HEAD').toString().trim();
const t = new Date(Date.now() + 9 * 3600 * 1000);
const p = (n) => String(n).padStart(2, '0');
const at = `${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
const file = new URL('../src/buildInfo.ts', import.meta.url);
const src = fs.readFileSync(file, 'utf8')
  .replace(/SOURCE_COMMIT = '[^']*'/, `SOURCE_COMMIT = '${sha}'`)
  .replace(/STAMPED_AT = '[^']*'/, `STAMPED_AT = '${at}'`);
fs.writeFileSync(file, src);
console.log('stamped', sha, at);
