// Prints the shape of a circuit along the lap: for every 2 % of the lap, how tight the road is
// (S = straight, r = turning radius in metres, sign = right / left), the height, and what the
// definition already puts there. For deciding where a ramp or a tram can go.
//   node tools/track-profile.mjs [http://localhost:5178] [--track <id>|all]
import { createRequire } from 'node:module';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');
const argv = process.argv.slice(2);
const BASE = argv.find((a) => a.startsWith('http')) || 'http://localhost:5178';
const i = argv.indexOf('--track');
const TRACK = i >= 0 ? argv[i + 1] : 'all';
const browser = await puppeteer.launch({ headless: 'new', args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=metal', '--mute-audio'] });
const page = await browser.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__turboKartRush);
const out = await page.evaluate(async (which) => {
  const THREE = await import('/@id/three');
  const g = window.__turboKartRush;
  const lines = [];
  for (const def of g.mainMenu.tracks) {
    if (which !== 'all' && !which.split(',').includes(def.id)) continue;
    const curve = new THREE.CatmullRomCurve3(def.controlPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z)), true, 'centripetal', 0.5);
    curve.arcLengthDivisions = 2000;
    const L = curve.getLength();
    lines.push(`\n== ${def.id}  ${L.toFixed(0)} m  theme ${def.theme}  hw ${def.halfWidth}  wall x${def.wallHalfWidthFactor}`);
    lines.push(`   void ${JSON.stringify(def.voidRanges ?? [])}  pads ${JSON.stringify(def.boostPads)}  boxes ${JSON.stringify(def.itemBoxRows)}  cp ${def.controlPoints.length}`);
    lines.push(`   ramps ${JSON.stringify(def.ramps ?? [])} zones ${JSON.stringify(def.zones ?? [])} movers ${JSON.stringify(def.movers ?? [])}`);
    let row = '';
    for (let k = 0; k < 50; k++) {
      const t = k / 50;
      const d = 6 / L;
      const a = curve.getTangentAt((t - d + 1) % 1);
      const b = curve.getTangentAt((t + d) % 1);
      let turn = Math.atan2(b.x, b.z) - Math.atan2(a.x, a.z);
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      const r = Math.abs(turn) < 0.03 ? 'S' : `${turn > 0 ? 'L' : 'R'}${Math.round(12 / Math.abs(turn))}`;
      const p = curve.getPointAt(t);
      row += `${t.toFixed(2)}:${r}/${p.y.toFixed(1)}  `;
      if (k % 10 === 9) {
        lines.push('   ' + row);
        row = '';
      }
    }
  }
  return lines.join('\n');
}, TRACK);
console.log(out);
await browser.close();
