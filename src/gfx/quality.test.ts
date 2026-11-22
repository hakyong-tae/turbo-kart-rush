import { describe, expect, it } from 'vitest';
import { qualityFor, tierForGpu } from './quality';

describe('tierForGpu', () => {
  it('gives discrete cards and Apple silicon the full picture', () => {
    expect(tierForGpu('angle (apple, angle metal renderer: apple m1 max, unspecified version)')).toBe('high');
    expect(tierForGpu('angle (nvidia, nvidia geforce rtx 3060 direct3d11 vs_5_0 ps_5_0, d3d11)')).toBe('high');
    expect(tierForGpu('angle (amd, amd radeon rx 6600 xt direct3d11 vs_5_0 ps_5_0, d3d11)')).toBe('high');
  });

  it('gives integrated graphics the middle tier', () => {
    expect(tierForGpu('angle (intel, intel(r) uhd graphics 620 direct3d11 vs_5_0 ps_5_0, d3d11)')).toBe('medium');
    expect(tierForGpu('angle (intel, intel(r) iris(r) xe graphics direct3d11 vs_5_0 ps_5_0, d3d11)')).toBe('medium');
    expect(tierForGpu('angle (amd, amd radeon(tm) graphics direct3d11 vs_5_0 ps_5_0, d3d11)')).toBe('medium');
  });

  it('tells a recent phone GPU from an old one', () => {
    expect(tierForGpu('adreno (tm) 740')).toBe('medium');
    expect(tierForGpu('mali-g715-immortalis mc11')).toBe('medium');
    expect(tierForGpu('adreno (tm) 610')).toBe('low');
    expect(tierForGpu('mali-g52 mc2')).toBe('low');
  });

  it('puts software rendering at the bottom', () => {
    expect(tierForGpu('angle (google, vulkan 1.3.0 (swiftshader device (subzero)), swiftshader driver)')).toBe('low');
    expect(tierForGpu('llvmpipe (llvm 15.0.7, 256 bits)')).toBe('low');
  });

  it('says nothing when the driver says nothing', () => {
    expect(tierForGpu('')).toBeNull();
    expect(tierForGpu('some unknown renderer')).toBeNull();
  });
});

describe('quality tiers', () => {
  it('never ask more of a lower tier than of a higher one', () => {
    const [low, medium, high] = [qualityFor('low'), qualityFor('medium'), qualityFor('high')];
    for (const key of ['pixelRatioCap', 'msaa', 'shadowMapSize', 'shadowHalfExtent', 'bloomLevels', 'cloudOctaves', 'envSize', 'groundDetail', 'anisotropy', 'particles'] as const) {
      expect(low[key]).toBeLessThanOrEqual(medium[key]);
      expect(medium[key]).toBeLessThanOrEqual(high[key]);
    }
  });
});
