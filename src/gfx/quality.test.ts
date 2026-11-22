import { describe, expect, it } from 'vitest';
import { qualityFor, tierFor, tierForGpu, type DeviceFacts } from './quality';

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

describe('tierFor', () => {
  const INTEL = 'angle (intel, intel(r) uhd graphics 600 direct3d11 vs_5_0 ps_5_0, d3d11)';
  const M1 = 'angle (apple, angle metal renderer: apple m1, unspecified version)';
  const RTX = 'angle (nvidia, nvidia geforce rtx 3060 direct3d11 vs_5_0 ps_5_0, d3d11)';
  const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  const CHROMEBOOK = 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  const pc = (over: Partial<DeviceFacts>): DeviceFacts => ({ gpu: INTEL, cores: 8, memory: 8, touchFirst: false, userAgent: WINDOWS, ...over });

  it('keeps an integrated GPU in a capable laptop on the middle tier', () => {
    expect(tierFor(pc({}))).toBe('medium');
    expect(tierFor(pc({ cores: 4, memory: 8 }))).toBe('medium');
    expect(tierFor(pc({ cores: 8, memory: 4 }))).toBe('medium');
  });

  it('sends an integrated GPU in a four-core, 4 GB machine to the bottom', () => {
    expect(tierFor(pc({ cores: 4, memory: 4 }))).toBe('low');
    expect(tierFor(pc({ cores: 2, memory: 4 }))).toBe('low');
    expect(tierFor(pc({ cores: 2, memory: 2 }))).toBe('low');
  });

  it('sends a Chromebook to the bottom unless its GPU is a discrete one', () => {
    expect(tierFor(pc({ userAgent: CHROMEBOOK }))).toBe('low');
    expect(tierFor(pc({ userAgent: CHROMEBOOK, gpu: 'mali-g52 mc2', cores: 8 }))).toBe('low');
    expect(tierFor(pc({ userAgent: CHROMEBOOK, gpu: '' }))).toBe('low');
    expect(tierFor(pc({ userAgent: CHROMEBOOK, gpu: RTX }))).toBe('high');
  });

  it('gives a fast machine the full picture, and a starved one with a good GPU the middle', () => {
    expect(tierFor(pc({ gpu: M1 }))).toBe('high');
    expect(tierFor(pc({ gpu: RTX, cores: 16 }))).toBe('high');
    expect(tierFor(pc({ gpu: RTX, cores: 2, memory: 4 }))).toBe('medium');
  });

  it('never gives a phone the top tier, and a weak one the bottom', () => {
    expect(tierFor(pc({ touchFirst: true, gpu: 'adreno (tm) 740', cores: 8, memory: 8 }))).toBe('medium');
    expect(tierFor(pc({ touchFirst: true, gpu: 'adreno (tm) 740', cores: 4, memory: 8 }))).toBe('low');
    expect(tierFor(pc({ touchFirst: true, gpu: 'mali-g52 mc2', cores: 8, memory: 4 }))).toBe('low');
    expect(tierFor(pc({ touchFirst: true, gpu: M1, cores: 8, memory: 8 }))).toBe('medium');
  });

  it('goes by cores and memory when the driver says nothing', () => {
    expect(tierFor(pc({ gpu: '' }))).toBe('high');
    expect(tierFor(pc({ gpu: '', cores: 4, memory: 4 }))).toBe('medium');
    expect(tierFor(pc({ gpu: '', cores: 2, memory: 8 }))).toBe('low');
  });
});
