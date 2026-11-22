/**
 * GLSL sources for the FX workstream: GPU particle shaders and the full-screen
 * composite post-process pass. Everything is procedural (no textures except the
 * runtime-generated sprite atlas).
 */

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

export const PARTICLE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uGravity;
uniform float uHeightPx;
uniform float uAspect;

attribute vec3 aVelocity;
attribute vec2 aTime;   // birth, life
attribute vec2 aSize;   // start, end (world metres)
attribute vec3 aColor0;
attribute vec3 aColor1;
attribute vec2 aAlpha;  // start, end
attribute vec2 aRot;    // rotation, angular velocity
attribute vec4 aMisc;   // gravityScale, atlasIndex, alignToVelocity, drag

varying vec4 vColor;
varying float vRot;
varying float vAtlas;

void main() {
  float age = uTime - aTime.x;
  float life = max(aTime.y, 0.0001);
  float t = age / life;
  if (age < 0.0 || t >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor = vec4(0.0);
    vRot = 0.0;
    vAtlas = 0.0;
    return;
  }

  float k = aMisc.w;
  // Ballistic motion with optional exponential drag: integral of v*exp(-k t).
  float tt = k > 0.001 ? (1.0 - exp(-k * age)) / k : age;
  float g = uGravity * aMisc.x;
  vec3 pos = position + aVelocity * tt;
  pos.y -= 0.5 * g * age * age;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  float size = mix(aSize.x, aSize.y, t);
  float px = size * projectionMatrix[1][1] * uHeightPx * 0.5 / max(0.05, -mv.z);
  gl_PointSize = clamp(px, 0.0, 512.0);

  float fadeIn = smoothstep(0.0, 0.06, t);
  float fadeOut = 1.0 - smoothstep(0.7, 1.0, t);
  float alpha = mix(aAlpha.x, aAlpha.y, t) * fadeIn * fadeOut;
  vColor = vec4(mix(aColor0, aColor1, t), alpha);

  float rot = aRot.x + aRot.y * age;
  if (aMisc.z > 0.5) {
    // Align the sprite's x axis to the screen-space velocity direction.
    vec3 vel = aVelocity * exp(-k * age);
    vel.y -= g * age;
    vec4 c1 = projectionMatrix * (modelViewMatrix * vec4(pos + vel * 0.02, 1.0));
    vec2 d = c1.xy / c1.w - gl_Position.xy / gl_Position.w;
    d.x *= uAspect;
    if (dot(d, d) > 1e-12) rot = atan(d.y, d.x);
  }
  vRot = rot;
  vAtlas = aMisc.y;
}
`;

export const PARTICLE_FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uTint;

varying vec4 vColor;
varying float vRot;
varying float vAtlas;

void main() {
  if (vColor.a <= 0.001) discard;
  vec2 p = gl_PointCoord - 0.5;
  p.y = -p.y;
  float c = cos(vRot);
  float s = sin(vRot);
  vec2 uv = vec2(c * p.x + s * p.y, -s * p.x + c * p.y) + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  uv = clamp(uv, 0.008, 0.992);
  float col = mod(vAtlas, 4.0);
  float row = floor(vAtlas / 4.0);
  vec2 auv = vec2((col + uv.x) * 0.25, 1.0 - (row + 1.0 - uv.y) * 0.25);
  vec4 tex = texture2D(uAtlas, auv);
  float a = tex.a * vColor.a;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vColor.rgb * tex.rgb * uTint, a);
}
`;

// ---------------------------------------------------------------------------
// Post-processing. The scene is drawn into a linear HDR buffer; these passes
// make the bloom from it and then put the finished frame on the screen.
// ---------------------------------------------------------------------------

/** Full-screen triangle: positions are already in clip space. */
export const POST_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Bloom, first step: keep what is brighter than the threshold (with a soft knee) and halve the
 * resolution. Each tap is weighted by 1 / (1 + luma), so one very bright pixel — the sun's
 * glint on a helmet — cannot flicker the whole bloom as it moves across the pixel grid.
 */
export const BLOOM_PREFILTER_FRAGMENT = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;

vec3 bright(vec3 c) {
  float b = max(c.r, max(c.g, c.b));
  float soft = clamp(b - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  return c * max(soft, b - uThreshold) / max(b, 1e-4);
}

void main() {
  vec3 a = bright(min(texture2D(tSource, vUv + uTexel * vec2(-1.0, -1.0)).rgb, vec3(24.0)));
  vec3 b = bright(min(texture2D(tSource, vUv + uTexel * vec2(1.0, -1.0)).rgb, vec3(24.0)));
  vec3 c = bright(min(texture2D(tSource, vUv + uTexel * vec2(-1.0, 1.0)).rgb, vec3(24.0)));
  vec3 d = bright(min(texture2D(tSource, vUv + uTexel * vec2(1.0, 1.0)).rgb, vec3(24.0)));
  const vec3 L = vec3(0.2126, 0.7152, 0.0722);
  float wa = 1.0 / (1.0 + dot(a, L));
  float wb = 1.0 / (1.0 + dot(b, L));
  float wc = 1.0 / (1.0 + dot(c, L));
  float wd = 1.0 / (1.0 + dot(d, L));
  gl_FragColor = vec4((a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd), 1.0);
}
`;

/** Bloom, going down: five taps that together cover a 4x4 block of the source. */
export const BLOOM_DOWN_FRAGMENT = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSource, vUv).rgb * 4.0;
  c += texture2D(tSource, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tSource, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tSource, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tSource, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c * 0.125, 1.0);
}
`;

/** Bloom, coming back up: a round eight-tap blur of the smaller level, added to the larger one. */
export const BLOOM_UP_FRAGMENT = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSource, vUv + uTexel * vec2(-2.0, 0.0)).rgb;
  c += texture2D(tSource, vUv + uTexel * vec2(2.0, 0.0)).rgb;
  c += texture2D(tSource, vUv + uTexel * vec2(0.0, -2.0)).rgb;
  c += texture2D(tSource, vUv + uTexel * vec2(0.0, 2.0)).rgb;
  c += texture2D(tSource, vUv + uTexel * vec2(-1.0, 1.0)).rgb * 2.0;
  c += texture2D(tSource, vUv + uTexel * vec2(1.0, 1.0)).rgb * 2.0;
  c += texture2D(tSource, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 2.0;
  c += texture2D(tSource, vUv + uTexel * vec2(1.0, -1.0)).rgb * 2.0;
  gl_FragColor = vec4(c * (uWeight / 12.0), 1.0);
}
`;

/**
 * The last pass, straight to the screen: bloom, sun shafts and flare, the speed and hit effects,
 * exposure, tone mapping, colour grade, grain.
 *
 * The vertex shader looks at the scene where the sun is and passes on how much of it shows, so
 * the flare fades when a hill or a grandstand stands in front of the sun.
 */
export const FINAL_VERTEX = /* glsl */ `
uniform sampler2D tScene;
uniform vec3 uSunUv;
varying vec2 vUv;
varying float vSunSeen;
void main() {
  vUv = uv;
  float seen = 0.0;
  if (uSunUv.z > 0.001) {
    const vec3 L = vec3(0.2126, 0.7152, 0.0722);
    vec2 s = uSunUv.xy;
    float lum = 0.0;
    lum += dot(texture2D(tScene, s).rgb, L);
    lum += dot(texture2D(tScene, s + vec2(0.006, 0.0)).rgb, L);
    lum += dot(texture2D(tScene, s - vec2(0.006, 0.0)).rgb, L);
    lum += dot(texture2D(tScene, s + vec2(0.0, 0.01)).rgb, L);
    lum += dot(texture2D(tScene, s - vec2(0.0, 0.01)).rgb, L);
    seen = smoothstep(1.2, 3.0, lum * 0.2);
  }
  vSunSeen = seen;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const FINAL_FRAGMENT = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 uResolution;
uniform float uTime;
uniform float uSpeed;
uniform float uBoost;
uniform float uHit;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uGrain;
uniform float uBloom;
uniform vec3 uSunUv;
uniform vec3 uSunColor;
uniform float uShafts;
uniform float uFlare;
uniform float uExposure;
uniform float uFilmic;
uniform float uContrast;
uniform float uSaturation;
uniform float uVibrance;
uniform vec3 uShadowTint;
uniform vec3 uHighTint;
uniform float uVignette;

varying vec2 vUv;
varying float vSunSeen;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Thin radial streaks in randomly chosen angular sectors, dashed segments
// racing outward from the centre. Returns 0..1 intensity.
float speedLines(vec2 adir, float r, float t) {
  float a = atan(adir.y, adir.x);
  const float SECTORS = 120.0;
  float sa = (a + 3.14159265) / 6.2831853 * SECTORS;
  float id = floor(sa);
  float fr = fract(sa);
  float rnd = hash11(id * 0.731 + 0.13);
  float rnd2 = hash11(id * 1.317 + 7.7);
  float w = 0.02 + 0.035 * rnd2;
  float line = 1.0 - smoothstep(0.0, w, abs(fr - 0.5));
  float speed = 2.5 + 2.5 * rnd2;
  float seg = fract(r * (2.0 + 2.0 * rnd) - t * speed + rnd * 13.0);
  float dash = smoothstep(0.3, 0.6, seg) * (1.0 - smoothstep(0.7, 1.0, seg));
  float mask = smoothstep(0.42, 0.9, r);
  float on = step(0.55, rnd);
  return line * dash * mask * on;
}

// ACES filmic (the fit three.js uses), and the Khronos neutral curve, which leaves colours
// below the shoulder exactly as they are.
vec3 rrtOdtFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 acesFilmic(vec3 color) {
  const mat3 inMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color = inMat * (color / 0.6);
  color = rrtOdtFit(color);
  return clamp(outMat * color, 0.0, 1.0);
}
vec3 neutral(vec3 color) {
  const float start = 0.8 - 0.04;
  const float desat = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < start) return color;
  float d = 1.0 - start;
  float newPeak = 1.0 - d * d / (peak + d - start);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desat * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(0.41666)) - 0.055, step(vec3(0.0031308), c));
}

void main() {
  vec2 uv = vUv;
  vec2 dir = uv - 0.5;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 adir = vec2(dir.x * aspect, dir.y);
  float r = length(adir);
  float rn = length(dir) * 1.4142136;
  const vec3 L = vec3(0.2126, 0.7152, 0.0722);

  vec3 col;
  float boost = uBoost;
  // Radial blur + chromatic aberration only kick in past a moderate boost so a
  // light drift turbo doesn't smear the picture.
  float smear = smoothstep(0.25, 1.0, boost);
  if (smear > 0.003) {
    vec2 dn = dir / max(length(dir), 1e-4);
    float ca = smear * 0.0035 * rn * rn;
    float blur = smear * 0.022 * rn * rn;
    col = vec3(0.0);
    for (int i = 0; i < 6; i++) {
      float f = (float(i) / 5.0 - 0.5) * blur;
      vec2 o = uv - dir * f;
      col.r += texture2D(tScene, o - dn * ca).r;
      col.g += texture2D(tScene, o).g;
      col.b += texture2D(tScene, o + dn * ca).b;
    }
    col /= 6.0;
  } else {
    col = texture2D(tScene, uv).rgb;
  }

  vec3 bloom = texture2D(tBloom, uv).rgb;
  col += bloom * uBloom;

  // Sun: shafts of light where the bright sky reaches past whatever stands in front of it, and
  // a few faint lens ghosts on the far side of the frame.
  if (uSunUv.z > 0.001) {
    vec2 toSun = uSunUv.xy - uv;
    float dist = length(vec2(toSun.x * aspect, toSun.y));
#ifdef SUN_SHAFTS
    if (uShafts > 0.001) {
      const int STEPS = 14;
      vec2 stepUv = toSun * (0.92 / float(STEPS));
      vec2 p = uv + stepUv * hash21(uv * uResolution + uTime);
      float lit = 0.0;
      float decay = 1.0;
      for (int i = 0; i < STEPS; i++) {
        p += stepUv;
        lit += dot(texture2D(tBloom, p).rgb, L) * decay;
        decay *= 0.94;
      }
      float reach = smoothstep(1.35, 0.0, dist);
      col += uSunColor * lit * (uShafts / float(STEPS)) * reach * uSunUv.z;
    }
#endif
    float flare = uFlare * vSunSeen * uSunUv.z;
    if (flare > 0.001) {
      vec2 axis = vec2(0.5) - uSunUv.xy;
      vec3 ghosts = vec3(0.0);
      vec2 g1 = vec2(0.5) + axis * 0.55;
      vec2 g2 = vec2(0.5) + axis * 0.95;
      vec2 g3 = vec2(0.5) + axis * 1.45;
      float d1 = length(vec2((uv.x - g1.x) * aspect, uv.y - g1.y));
      float d2 = length(vec2((uv.x - g2.x) * aspect, uv.y - g2.y));
      float d3 = length(vec2((uv.x - g3.x) * aspect, uv.y - g3.y));
      ghosts += vec3(0.45, 0.75, 1.0) * smoothstep(0.06, 0.0, d1) * 0.3;
      ghosts += vec3(1.0, 0.72, 0.4) * smoothstep(0.13, 0.085, d2) * smoothstep(0.03, 0.085, d2) * 0.16;
      ghosts += vec3(0.6, 1.0, 0.7) * smoothstep(0.17, 0.0, d3) * 0.14;
      // A wide soft veil around the sun itself.
      ghosts += uSunColor * exp(-dist * 4.5) * 0.35;
      col += ghosts * flare;
    }
  }

  // Speed lines: none until the kart is well past cruising speed, thin and
  // low-alpha even at full boost.
  float slAmt = smoothstep(0.6, 1.0, uSpeed) * 0.08 + boost * 0.16;
  if (slAmt > 0.002) {
    float sl = speedLines(adir, r, uTime);
    col += vec3(sl * slAmt) * vec3(0.95, 0.97, 1.05);
  }

  // Vignette: untouched in the middle, darker toward the corners, tighter at speed.
  float vig = smoothstep(1.25, 0.55, rn * (1.0 + 0.08 * uSpeed));
  col *= mix(1.0, vig, uVignette + 0.16 * uSpeed);

  if (uHit > 0.001) {
    float pulse = 0.8 + 0.2 * sin(uTime * 28.0);
    float edge = smoothstep(0.35, 1.0, rn);
    float hitMask = clamp(uHit * pulse * (0.2 + edge) * 1.0, 0.0, 0.8);
    col = mix(col, vec3(0.55, 0.02, 0.01), hitMask);
    float lum0 = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(lum0), uHit * 0.35);
  }

  col = mix(col, uFlashColor * 1.8, clamp(uFlash, 0.0, 1.0));

  // ---- exposure and tone mapping: linear HDR in, display-linear 0..1 out ----
  col = max(col, vec3(0.0)) * uExposure;
  vec3 mapped = uFilmic > 0.999 ? acesFilmic(col) : uFilmic < 0.001 ? clamp(neutral(col), 0.0, 1.0) : mix(clamp(neutral(col), 0.0, 1.0), acesFilmic(col), uFilmic);

  // ---- grade, in display space ----------------------------------------------
  vec3 g = toSrgb(mapped);
  float lum = dot(g, L);
  // Split toning: shadows lean one way, highlights the other.
  g *= mix(uShadowTint, uHighTint, smoothstep(0.15, 0.85, lum));
  // Contrast about middle grey.
  g = (g - 0.5) * uContrast + 0.5;
  // Saturation, with more of it given to colours that have little (vibrance).
  lum = dot(g, L);
  float sat = max(g.r, max(g.g, g.b)) - min(g.r, min(g.g, g.b));
  g = mix(vec3(lum), g, uSaturation + uVibrance * (1.0 - clamp(sat, 0.0, 1.0)));

  // Fine grain, which also hides banding in the sky's gradient.
  float gr = hash21(uv * uResolution + fract(uTime * 7.31) * 100.0) - 0.5;
  g += gr * uGrain * (0.5 + 0.5 * (1.0 - clamp(lum, 0.0, 1.0)));

  gl_FragColor = vec4(clamp(g, 0.0, 1.0), 1.0);
}
`;
