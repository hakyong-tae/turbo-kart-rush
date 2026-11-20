#!/usr/bin/env python3
"""CrazyGames preview videos for Drift Kart, cut from the crazygames-capture.mjs race frames.

  WORK=<dir> OUT=marketing/crazygames python3 tools/marketing/crazygames-video.py

Needs ffmpeg, and the covers already in OUT (crazygames-covers.mjs): each video opens on its cover.

Two files, same cuts: landscape 1920x1080 and portrait 1080x1620 (2:3), 30 fps, H.264, no audio.
Each opens on its cover for 0.4 s, then six circuits of 2.9 s each: 17.8 s (the limit is 20 s).
Real gameplay at real speed with the HUD hidden; no text, no cursor, no bars.
"""
import json, os, subprocess, sys

WORK, OUT = os.environ['WORK'], os.environ['OUT']
FPS, COVER, CUT = 30, 12, 87
# circuit, (first frame, last frame) to search in: the most eventful CUT frames inside it are used.
CUTS = [
    ('coral-coast', (240, 400)),
    ('neon-nexus', (20, 170)),
    ('stunt-park', (60, 215)),
    ('magma-ridge', (0, 140)),
    ('frostbite-falls', (370, 520)),
    ('skyline-loop', (0, 130)),
]
if os.environ.get('CUTS'):
    CUTS = [(c.split(':')[0], tuple(map(int, c.split(':')[1].split('-')))) for c in os.environ['CUTS'].split(',')]

def score(a):
    if not a: return 0
    return (1.2 if a['drift'] else 0) + 0.4 * a['drift'] + 1.5 * a['boost'] + 0.5 * min(a['pack'], 3) + min(a['hit'], 3) + 1.5 * a['air'] + a['star'] - 3.0 * a['spin']

starts = []
for slug, (lo, hi) in CUTS:
    s = json.load(open(f'{WORK}/race/{slug}/scores.json'))
    v = [score(a) for a in s]
    best = max(range(lo, max(lo + 1, min(hi, len(v)) - CUT + 1)), key=lambda i: sum(v[i:i + CUT]))
    starts.append((slug, best))
    print(f'{slug}: frames {best}-{best + CUT - 1}  score {sum(v[best:best + CUT]) / CUT:.2f}')

def build(name, cover, vf, w, h):
    args = ['ffmpeg', '-y', '-loglevel', 'error', '-loop', '1', '-framerate', str(FPS), '-t', f'{COVER / FPS:.4f}', '-i', cover]
    for slug, st in starts:
        args += ['-framerate', str(FPS), '-start_number', str(st), '-i', f'{WORK}/race/{slug}/f%04d.jpg']
    parts = [f'[0:v]scale={w}:{h}:flags=lanczos:out_color_matrix=bt709:out_range=tv,setsar=1,format=yuv420p[c0]']
    for i in range(len(starts)):
        parts.append(f'[{i + 1}:v]trim=end_frame={CUT},setpts=PTS-STARTPTS,{vf},setsar=1,format=yuv420p[c{i + 1}]')
    parts.append(''.join(f'[c{i}]' for i in range(len(starts) + 1)) + f'concat=n={len(starts) + 1}:v=1:a=0[v]')
    out = f'{OUT}/{name}'
    # Two passes at a fixed rate: the limit is 50 MB, and the game's speed lines and bloom make
    # constant-quality encodes come out near 100 MB. 17 Mbps x 17.8 s = about 38 MB.
    COLOUR = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']
    common = args + ['-filter_complex', ';'.join(parts), '-map', '[v]', '-an', '-r', str(FPS), '-c:v', 'libx264', '-preset', 'slow',
                     '-b:v', '17M', '-maxrate', '24M', '-bufsize', '34M', '-pix_fmt', 'yuv420p', *COLOUR, '-passlogfile', f'{WORK}/pass-{name}']
    subprocess.run(common + ['-pass', '1', '-f', 'null', '/dev/null'], check=True)
    subprocess.run(common + ['-pass', '2', '-movflags', '+faststart', out], check=True)
    print('wrote', out, f'{os.path.getsize(out) / 1048576:.1f} MB')

# Landscape: a 1.2x push-in on the 2880x1620 frame (still more than 1920 source pixels across).
build('preview_landscape_1920x1080.mp4', f'{OUT}/cover_landscape_1920x1080.png', 'crop=2400:1350:240:170,scale=1920:1080:flags=lanczos:in_color_matrix=bt601:out_color_matrix=bt709:in_range=pc:out_range=tv', 1920, 1080)
# Portrait: the centre 1080x1620 of the same frame, pixel for pixel.
build('preview_portrait_1080x1620.mp4', f'{WORK}/cover_portrait_1080x1620.png', 'crop=1080:1620:900:0,scale=1080:1620:in_color_matrix=bt601:out_color_matrix=bt709:in_range=pc:out_range=tv', 1080, 1620)
