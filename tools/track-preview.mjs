// Draws each circuit from above, one PNG per circuit: the wall corridor, the road, lap-position
// labels every 5 %, and everything the definition puts on it — void stretches, ramps and gaps,
// surface zones, moving obstacles, item rows, boost pads. For laying out a circuit before driving it.
//
//   node tools/track-preview.mjs [http://localhost:5178] [--track <id>|all] [--out marketing/.audit/preview]
//
// Colours: grey road inside a dark wall corridor, dashed outline = no walls (void), yellow = ramp,
// black = gap, cyan = ice, brown = mud, orange = boost strip / pad (pad = short bar), green = item
// row, red = roller run (arrow = its direction), magenta = tram crossing. North (-z) is up.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BASE = argv.find((a) => a.startsWith('http')) || 'http://localhost:5178';
const TRACK = opt('--track', 'all');
const OUT = opt('--out', 'marketing/.audit/preview');
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ headless: 'new', args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=metal', '--mute-audio'] });
const page = await browser.newPage();
// ?lobby: stay on the lobby (a fresh profile would otherwise be sent into its first race).
await page.goto(`${BASE}/?lobby=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__turboKartRush);

const pictures = await page.evaluate(async (which) => {
  const { Centerline } = await import('/src/track/Centerline.ts');
  const THREE = await import('/@id/three');
  const g = window.__turboKartRush;
  const out = [];
  for (const def of g.mainMenu.tracks) {
    if (which !== 'all' && !which.split(',').includes(def.id)) continue;
    const cl = new Centerline(def);
    const L = cl.length;
    const smp = { position: new THREE.Vector3(), tangent: new THREE.Vector3(), normal: new THREE.Vector3(), binormal: new THREE.Vector3(), halfWidth: 0, wallHalfWidth: 0, t: 0 };
    const margin = cl.maxWallHalfWidth + 26;
    const minX = cl.minX - margin;
    const minZ = cl.minZ - margin;
    const w = cl.maxX - cl.minX + margin * 2;
    const h = cl.maxZ - cl.minZ + margin * 2;
    const scale = Math.min(1500 / w, 1100 / h);
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(w * scale);
    cv.height = Math.ceil(h * scale) + 40;
    const c = cv.getContext('2d');
    c.fillStyle = '#101216';
    c.fillRect(0, 0, cv.width, cv.height);
    const X = (x) => (x - minX) * scale;
    const Z = (z) => (z - minZ) * scale + 40;
    const at = (t, lat) => {
      cl.sample(t, smp);
      return [X(smp.position.x + smp.binormal.x * lat), Z(smp.position.z + smp.binormal.z * lat)];
    };
    const isVoid = (t) => (def.voidRanges ?? []).some(([a, b]) => (a <= b ? t >= a && t <= b : t >= a || t <= b));

    /** Fill the band between two lateral offsets (functions of t) over [t0, t1]. */
    const band = (t0, t1, latA, latB, colour) => {
      const span = t1 >= t0 ? t1 - t0 : t1 + 1 - t0;
      const n = Math.max(2, Math.ceil((span * L) / 2));
      c.beginPath();
      for (let k = 0; k <= n; k++) {
        const t = (t0 + (span * k) / n) % 1;
        cl.sample(t, smp);
        const [x, z] = at(t, typeof latA === 'function' ? latA(smp) : latA);
        if (k === 0) c.moveTo(x, z);
        else c.lineTo(x, z);
      }
      for (let k = n; k >= 0; k--) {
        const t = (t0 + (span * k) / n) % 1;
        cl.sample(t, smp);
        const [x, z] = at(t, typeof latB === 'function' ? latB(smp) : latB);
        c.lineTo(x, z);
      }
      c.closePath();
      c.fillStyle = colour;
      c.fill();
    };

    // Wall corridor (where a kart can physically be), then the road on top. Void stretches have
    // no corridor: the road is all there is.
    const STEPS = 400;
    for (let k = 0; k < STEPS; k++) {
      const t0 = k / STEPS;
      const t1 = (k + 1.05) / STEPS;
      if (!isVoid(t0)) band(t0, t1 % 1, (s) => -s.wallHalfWidth, (s) => s.wallHalfWidth, '#2c3a2a');
    }
    for (let k = 0; k < STEPS; k++) {
      const t0 = k / STEPS;
      const t1 = (k + 1.05) / STEPS;
      band(t0, t1 % 1, (s) => -s.halfWidth, (s) => s.halfWidth, isVoid(t0) ? '#6d7386' : '#7a7d84');
    }

    // Surface zones.
    const ZONE = { ice: '#63d6ff', mud: '#8a5a2c', boost: '#ff9a1f' };
    for (const z of def.zones ?? []) {
      const a = z.lateral ? Math.min(...z.lateral) : null;
      const b = z.lateral ? Math.max(...z.lateral) : null;
      band(z.from, z.to, a === null ? (s) => -s.halfWidth : a, b === null ? (s) => s.halfWidth : b, ZONE[z.kind]);
    }
    // Ramps and gaps.
    for (const r of def.ramps ?? []) {
      const len = (r.length ?? 10) / L;
      const lat = r.lateral ?? 0;
      const a = r.halfWidth ? lat - r.halfWidth : null;
      const b = r.halfWidth ? lat + r.halfWidth : null;
      band(r.t, (r.t + len) % 1, a === null ? (s) => -s.halfWidth : a, b === null ? (s) => s.halfWidth : b, '#ffe14a');
      if (r.gap) band((r.t + len) % 1, (r.t + len + r.gap / L) % 1, (s) => -s.halfWidth - 1, (s) => s.halfWidth + 1, '#000000');
    }
    // Item rows and boost pads.
    for (const t of def.itemBoxRows) band(t, (t + 2.5 / L) % 1, (s) => -s.halfWidth, (s) => s.halfWidth, '#3be07a');
    for (const t of def.boostPads) band(t, (t + 5 / L) % 1, -2.5, 2.5, '#ff9a1f');

    // Movers.
    const line = (pts, colour, width, dash) => {
      c.beginPath();
      pts.forEach(([x, z], i) => (i ? c.lineTo(x, z) : c.moveTo(x, z)));
      c.strokeStyle = colour;
      c.lineWidth = width;
      c.setLineDash(dash ?? []);
      c.stroke();
      c.setLineDash([]);
    };
    for (const m of def.movers ?? []) {
      if (m.kind === 'roller') {
        // A run goes from `from` to `to` the short way round: against the traffic when to < from.
        let d = m.to - m.from;
        if (d > 0.5) d -= 1;
        if (d < -0.5) d += 1;
        const pts = [];
        const n = Math.max(2, Math.ceil((Math.abs(d) * L) / 3));
        for (let k = 0; k <= n; k++) pts.push(at((((m.from + (d * k) / n) % 1) + 1) % 1, m.lateral ?? 0));
        line(pts, '#ff3b3b', 3);
        const [ex, ez] = pts[pts.length - 1];
        const [px, pz] = pts[pts.length - 3] ?? pts[0];
        const ang = Math.atan2(ez - pz, ex - px);
        c.beginPath();
        c.moveTo(ex + Math.cos(ang) * 9, ez + Math.sin(ang) * 9);
        c.lineTo(ex + Math.cos(ang + 2.5) * 8, ez + Math.sin(ang + 2.5) * 8);
        c.lineTo(ex + Math.cos(ang - 2.5) * 8, ez + Math.sin(ang - 2.5) * 8);
        c.closePath();
        c.fillStyle = '#ff3b3b';
        c.fill();
        const [sx, sz] = pts[0];
        c.beginPath();
        c.arc(sx, sz, (m.radius ?? 1.4) * scale, 0, Math.PI * 2);
        c.fill();
      } else {
        cl.sample(m.t, smp);
        const reach = smp.wallHalfWidth + 8;
        line([at(m.t, -reach), at(m.t, reach)], '#ff4fd8', 4, [8, 5]);
      }
    }

    // Void outline (dashed) so a rail-less stretch is obvious.
    for (const [a, b] of def.voidRanges ?? []) {
      for (const side of [-1, 1]) {
        const pts = [];
        const span = b >= a ? b - a : b + 1 - a;
        const n = Math.ceil((span * L) / 3);
        for (let k = 0; k <= n; k++) {
          const t = (a + (span * k) / n) % 1;
          cl.sample(t, smp);
          pts.push(at(t, side * (smp.halfWidth + 1.2)));
        }
        line(pts, '#e8ecff', 1.5, [5, 5]);
      }
    }

    // Lap-position labels and the start line.
    c.font = '13px Menlo, monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let k = 0; k < 20; k++) {
      const t = k / 20;
      cl.sample(t, smp);
      const [x, z] = at(t, -(smp.wallHalfWidth + 9));
      c.fillStyle = k === 0 ? '#ffe14a' : '#c9ced8';
      c.fillText(t.toFixed(2), x, z);
      const [ax, az] = at(t, -smp.halfWidth);
      const [bx, bz] = at(t, smp.halfWidth);
      line(
        [
          [ax, az],
          [bx, bz],
        ],
        k === 0 ? '#ffffff' : 'rgba(255,255,255,0.35)',
        k === 0 ? 3 : 1,
      );
    }
    // Direction arrow just after the line.
    {
      const [x0, z0] = at(0.012, 0);
      const [x1, z1] = at(0.03, 0);
      const ang = Math.atan2(z1 - z0, x1 - x0);
      c.beginPath();
      c.moveTo(x1 + Math.cos(ang) * 10, z1 + Math.sin(ang) * 10);
      c.lineTo(x1 + Math.cos(ang + 2.5) * 8, z1 + Math.sin(ang + 2.5) * 8);
      c.lineTo(x1 + Math.cos(ang - 2.5) * 8, z1 + Math.sin(ang - 2.5) * 8);
      c.closePath();
      c.fillStyle = '#ffffff';
      c.fill();
    }
    // Heights at the labels (small, under the t).
    c.font = '11px Menlo, monospace';
    for (let k = 0; k < 20; k++) {
      const t = k / 20;
      cl.sample(t, smp);
      const [x, z] = at(t, -(smp.wallHalfWidth + 9));
      c.fillStyle = '#7f8796';
      c.fillText(`${smp.position.y.toFixed(1)}m`, x, z + 13);
    }

    c.textAlign = 'left';
    c.font = 'bold 18px Menlo, monospace';
    c.fillStyle = '#ffffff';
    c.fillText(`${def.id}   ${L.toFixed(0)} m   ${def.theme}   difficulty ${def.difficulty}   y ${cl.minY.toFixed(1)}..${cl.maxY.toFixed(1)}`, 12, 20);
    out.push({ id: def.id, png: cv.toDataURL('image/png') });
  }
  return out;
}, TRACK);

for (const p of pictures) {
  writeFileSync(`${OUT}/${p.id}.png`, Buffer.from(p.png.split(',')[1], 'base64'));
  console.log(`${OUT}/${p.id}.png`);
}
await browser.close();
