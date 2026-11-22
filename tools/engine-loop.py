# Cut a seamless loop out of a steady stretch of a clip.  python3 -I loop.py <in.mp3> <out.wav> <from_s> <to_s> <target_len_s>
import subprocess, sys, array, math, wave
src, out, t_from, t_to, target = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
SR = 44100
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-f', 's16le', '-ac', '1', '-ar', str(SR), '-'], capture_output=True).stdout
x = array.array('h'); x.frombytes(raw)
x = [v / 32768 for v in x]
# envelope at 1 kHz
B = SR // 1000
env = [sum(abs(v) for v in x[i:i + B]) / B for i in range(0, len(x) - B, B)]
sm = [sum(env[max(0, i - 4):i + 5]) / len(env[max(0, i - 4):i + 5]) for i in range(len(env))]
a, b = int(t_from * 1000), int(t_to * 1000)
seg = sm[a:b]; m = sum(seg) / len(seg); seg = [v - m for v in seg]
def ac(lag): return sum(seg[i] * seg[i + lag] for i in range(len(seg) - lag)) / (len(seg) - lag)
z = ac(0); best = max(range(30, 250), key=ac)
print('envelope period ms', best, 'strength', round(ac(best) / z, 2), 'pulse Hz', round(1000 / best, 2))
# start at the quietest point in the first period after t_from
s_ms = min(range(a, a + best), key=lambda i: sm[i]); t0 = s_ms * B
n = max(1, round(target * 1000 / best)); guess = t0 + n * best * B
W = int(0.06 * SR); ref = x[t0:t0 + W]; rn = math.sqrt(sum(v * v for v in ref))
def score(t1):
    s = x[t1:t1 + W]; sn = math.sqrt(sum(v * v for v in s)) or 1e-9
    return sum(p * q for p, q in zip(ref, s)) / (rn * sn)
span = best * B // 3
coarse = max(range(guess - span, guess + span, 8), key=score)
t1 = max(range(coarse - 8, coarse + 9), key=score)
print('loop', round(t0 / SR, 4), '->', round(t1 / SR, 4), 'len', round((t1 - t0) / SR, 4), 'pulses', n, 'seam corr', round(score(t1), 3))
F = int(0.05 * SR)
L = x[t0:t1]
for i in range(F):
    k = i / F
    L[i] = x[t0 + i] * k + x[t1 + i] * (1 - k)
# level across the loop: how even is it? (rms per 100 ms)
r = [math.sqrt(sum(v * v for v in L[i:i + 4410]) / 4410) for i in range(0, len(L) - 4410, 4410)]
print('rms dB per 100ms', ' '.join(f'{20 * math.log10(v + 1e-9):.0f}' for v in r))
peak = max(abs(v) for v in L); g = 0.7 / peak
roll = int(0.3 * SR)
full = L[-roll:] + L + L[:roll]
w = wave.open(out, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
w.writeframes(array.array('h', [max(-32767, min(32767, int(v * g * 32767))) for v in full]).tobytes()); w.close()
print('gain', round(g, 2), 'file len', round(len(full) / SR, 4), 'loopStart 0.3 loopEnd', round(0.3 + len(L) / SR, 5))
