#!/usr/bin/env python3
"""Turns a real circuit's centreline into control points for a Drift Dash GP track.

A grand-prix circuit is four or five kilometres of road ten to fifteen metres wide; ours is about
one kilometre of road seventeen metres wide. Scaled straight down, a real plan has corners tighter
than a kart can turn and sections lying on top of each other. So: scale it, then relax it — push
apart only the sections that are too close, round only the corners that are too tight — and fit a
spline to what is left. The outline survives; the fiddly complexes merge into one corner each.

  python3 tools/track-from-plan.py <centreline.geojson> --length 1120 [--radius 1.3] [--start-back 78]
          [--points 44] [--heights "0:0,0.13:1.6,0.365:5.2"] [--half-width 8.5] [--out marketing/.audit/plan]

  --length      lap length to aim for, metres (the validator wants 850..1450)
  --radius      tightest corner, as a multiple of the validator's minimum (1.08 = tight, 1.3 = beginner)
  --start-back  move the finish line this many metres back from the first point of the data,
                so there is a straight after it (the data usually starts at the real line)
  --heights     lap position : height pairs, blended with a cosine; flat when omitted

Prints a `controlPoints` block (each line carries its lap position t, for placing features and
`wallHalfWidthFactors`) and writes a plan view next to it. Paste into `src/track/tracks/<name>.ts`,
then `node tools/track-preview.mjs --track <id>` and `node tools/track-soak.mjs --track <id>`.

Input: GeoJSON with one LineString feature of [lon, lat] points, e.g. from an open circuits
dataset. The data is not kept in this repository. Needs numpy and Pillow.

Windmill Way and Canyon Rally were made with this:
  --length 1120 --radius 1.3  --start-back 78 --points 44 --heights "0:0,0.07:0.4,0.13:1.6,0.21:1,0.30:3.2,0.365:5.2,0.45:2.6,0.52:2,0.60:3,0.72:1.4,0.86:0.5,0.95:0.1"
  --length 1300 --radius 1.15 --start-back 80 --points 46 --heights "0:0,0.10:0.9,0.16:2.2,0.30:6,0.40:6.6,0.50:8.6,0.62:6.8,0.70:7.6,0.745:7.8,0.90:1.6,0.96:0.5"
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

DENSE = 260  # working resolution of the loop


def load(path):
    g = json.load(open(path))
    feats = g['features'] if 'features' in g else [g]
    c = np.array(feats[0]['geometry']['coordinates'], dtype=float)[:, :2]
    if np.allclose(c[0], c[-1]):
        c = c[:-1]
    lat0 = math.radians(c[:, 1].mean())
    x = (c[:, 0] - c[:, 0].mean()) * 111320 * math.cos(lat0)
    z = -(c[:, 1] - c[:, 1].mean()) * 110540  # north is -z, as in the game
    return np.stack([x, z], axis=1)


def seglen(p):
    return np.linalg.norm(np.roll(p, -1, axis=0) - p, axis=1)


def length(p):
    return float(seglen(p).sum())


def resample(p, n):
    """n points evenly spaced by arc length round the closed polyline."""
    d = seglen(p)
    s = np.concatenate([[0], np.cumsum(d)])
    q = np.vstack([p, p[:1]])
    out = []
    for k in range(n):
        t = s[-1] * k / n
        i = min(len(p) - 1, int(np.searchsorted(s, t, side='right')) - 1)
        f = (t - s[i]) / max(1e-9, d[i])
        out.append(q[i] * (1 - f) + q[i + 1] * f)
    return np.array(out)


def local_radius(p, step):
    a, b, c = np.roll(p, step, axis=0), p, np.roll(p, -step, axis=0)
    ab, bc, ca = np.linalg.norm(a - b, axis=1), np.linalg.norm(b - c, axis=1), np.linalg.norm(c - a, axis=1)
    area = 0.5 * np.abs((b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0]))
    return ab * bc * ca / np.maximum(4 * area, 1e-9)


def relax(p, hw, sep, rmin, iters=1500):
    """Push apart what is too close, round what is too tight, leave the rest alone."""
    n = len(p)
    idx = np.arange(n)
    k = np.abs(idx[:, None] - idx[None, :])
    k = np.minimum(k, n - k)
    for _ in range(iters):
        ds = length(p) / n
        diff = p[:, None, :] - p[None, :, :]
        dist = np.linalg.norm(diff, axis=2) + 1e-9
        arc = k * ds
        r = sep / 2
        # Two legs of a hairpin may be close; the chord a given arc needs is the validator's rule.
        need = 2 * r * np.sin(np.minimum(arc / (2 * r), math.pi / 2))
        viol = (arc > 2 * hw) & (dist < need)
        push = np.where(viol, (need - dist) / dist, 0.0)
        move = (diff * push[:, :, None]).sum(axis=1) * 0.05
        mag = np.linalg.norm(move, axis=1, keepdims=True)
        move = np.where(mag > 1.5, move * 1.5 / np.maximum(mag, 1e-9), move)
        p = p + move
        tight = local_radius(p, max(1, round(5 / ds))) < rmin
        w = tight.astype(float)
        for _ in range(3):
            w = np.maximum(w, 0.6 * np.maximum(np.roll(w, 1), np.roll(w, -1)))
        lap = 0.5 * (np.roll(p, 1, axis=0) + np.roll(p, -1, axis=0)) - p
        p = resample(p + lap * (0.08 + 0.42 * w)[:, None], n)
        if not viol.any() and not tight.any():
            break
    return p


def catmull(cp, per=24):
    """Closed centripetal Catmull-Rom through cp: what THREE.CatmullRomCurve3 draws."""
    n = len(cp)
    out = []
    for i in range(n):
        p0, p1, p2, p3 = cp[(i - 1) % n], cp[i], cp[(i + 1) % n], cp[(i + 2) % n]
        t1 = max(1e-4, np.linalg.norm(p1 - p0)) ** 0.5
        t2 = t1 + max(1e-4, np.linalg.norm(p2 - p1)) ** 0.5
        t3 = t2 + max(1e-4, np.linalg.norm(p3 - p2)) ** 0.5
        for j in range(per):
            t = t1 + (t2 - t1) * j / per
            a1 = (t1 - t) / t1 * p0 + t / t1 * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / t2 * a1 + t / t2 * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    return np.array(out)


def report(curve, hw):
    """The two geometry checks of src/track/tracks/validate.ts, on a dense closed polyline."""
    N = 400
    s = resample(curve, N)
    L = length(curve)
    ds = L / N
    r = 1.75 * hw
    worst, info = 9e9, ''
    for i in range(N):
        d = np.linalg.norm(s - s[i], axis=1)
        k = np.abs(np.arange(N) - i)
        k = np.minimum(k, N - k)
        arc = k * ds
        need = 2 * r * np.sin(np.minimum(arc / (2 * r), math.pi / 2))
        ratio = np.where(arc >= 2 * hw, d / np.maximum(need, 1e-9), 9e9)
        j = int(ratio.argmin())
        if ratio[j] < worst:
            worst, info = float(ratio[j]), f't={i / N:.3f} / t={j / N:.3f}'
    step = max(1, round(4.5 / ds))
    R = local_radius(s, step)
    return L, worst, info, float(R.min()), int(R.argmin()) / N


def height_at(t, keys):
    if not keys:
        return 0.0
    ks = sorted(keys) + [(sorted(keys)[0][0] + 1, sorted(keys)[0][1])]
    if t < ks[0][0]:
        t += 1
    for (t0, y0), (t1, y1) in zip(ks, ks[1:]):
        if t0 <= t <= t1:
            f = (t - t0) / max(1e-9, t1 - t0)
            return y0 + (y1 - y0) * (0.5 - 0.5 * math.cos(math.pi * f))
    return ks[0][1]


def orient(dense, start):
    """Start at the origin heading -z, with a true straight under the starting grid."""
    n = len(dense)
    p = np.roll(dense, -start, axis=0)
    ds = length(p) / n
    w = max(2, round(15 / ds))
    d = p[w] - p[-w]
    ang = math.atan2(d[0], -d[1])
    c, s = math.cos(ang), math.sin(ang)
    q = p - p[0]
    q = np.stack([q[:, 0] * c + q[:, 1] * s, -q[:, 0] * s + q[:, 1] * c], axis=1)
    for i in range(n):
        after, before = i * ds, (n - i) * ds
        if after < 40:
            q[i, 0] *= min(1, max(0, (after - 20) / 20))
        if before < 60:
            q[i, 0] *= min(1, max(0, (before - 34) / 26))
    return q


def fit(q, maxpts):
    """Control points: the line and a few more, then one at a time wherever the spline strays most."""
    n = len(q)
    idx = sorted(set([0] + [round(n * k / 14) for k in range(14)]))
    while True:
        curve = catmull(q[idx], 16)
        dev = np.array([np.min(np.linalg.norm(curve - pt, axis=1)) for pt in q])
        worst = int(dev.argmax())
        if dev[worst] < 0.8 or len(idx) >= maxpts:
            return q[idx], float(dev.max())
        idx = sorted(set(idx + [worst]))


def draw(path, curve, cps, hw, size=1100):
    lo, hi = curve.min(axis=0) - 40, curve.max(axis=0) + 40
    sc = size / max(hi - lo)
    im = Image.new('RGB', (int((hi[0] - lo[0]) * sc), int((hi[1] - lo[1]) * sc)), (16, 18, 22))
    d = ImageDraw.Draw(im)
    T = lambda v: tuple(((v - lo) * sc).tolist())
    d.line([T(v) for v in curve] + [T(curve[0])], fill=(125, 128, 135), width=max(1, int(2 * hw * sc)))
    for i, v in enumerate(cps):
        x, y = T(v)
        d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(255, 225, 74))
    for k in range(20):
        d.text(T(curve[int(len(curve) * k / 20)]), f'{k / 20:.2f}', fill=(255, 255, 255))
    im.save(path)


def num(v):
    s = f'{v:.1f}'
    return s[:-2] if s.endswith('.0') else ('0' if s == '-0' else s)


if __name__ == '__main__':
    args = sys.argv[1:]
    if not args or args[0].startswith('-'):
        sys.exit(__doc__)
    opt = lambda name, default: args[args.index(name) + 1] if name in args else default
    src = args[0]
    target = float(opt('--length', 1150))
    hw = float(opt('--half-width', 8.5))
    rf = float(opt('--radius', 1.08))
    back = float(opt('--start-back', 0))
    maxpts = int(opt('--points', 44))
    keys = [tuple(map(float, k.split(':'))) for k in opt('--heights', '').split(',') if k]
    out = opt('--out', 'marketing/.audit/plan')
    os.makedirs(out, exist_ok=True)

    raw = load(src)
    sep, rmin = 3.5 * hw * 1.1, 1.75 * hw * rf
    # Relaxing changes the length, so search for the starting scale that lands on the target.
    lo, hi = 0.8, 2.2
    for _ in range(9):
        f = (lo + hi) / 2
        dense = relax(resample(raw * (f * target / length(raw)), DENSE), hw, sep, rmin)
        if length(dense) > target:
            hi = f
        else:
            lo = f
    start = (DENSE - round(back / (length(dense) / DENSE))) % DENSE
    q = orient(dense, start)
    cps, dev = fit(q, maxpts)
    curve = catmull(cps, 24)
    L, worst, info, minR, at = report(curve, hw)
    cum = np.concatenate([[0], np.cumsum(seglen(curve))])
    ts = [cum[k * 24] / cum[-1] for k in range(len(cps))]
    print(f'// {len(cps)} control points, {L:.0f} m. Spline strays {dev:.1f} m from the relaxed plan at most.')
    print(f'// separation {worst:.2f} x the minimum ({info}), tightest radius {minR:.1f} m at t={at:.3f}')
    print('  controlPoints: [')
    for k, ((x, z), t) in enumerate(zip(cps, ts)):
        print(f'    {{ x: {num(x)}, y: {num(height_at(t, keys))}, z: {num(z)} }}, // {k}  t={t:.3f}')
    print('  ],')
    name = os.path.splitext(os.path.basename(src))[0]
    draw(os.path.join(out, name + '.png'), curve, cps, hw)
    print('// plan view:', os.path.join(out, name + '.png'))
