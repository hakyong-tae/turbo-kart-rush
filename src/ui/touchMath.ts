/**
 * Pure maths for the virtual stick. Screen space: +x right, +y DOWN, so
 * "12 o'clock" is dy < 0. Output is normalised so |(steer, throttle|brake)| <= 1.
 */
export interface StickAxes {
  steer: number; // -1..1
  throttle: number; // 0..1
  brake: number; // 0..1
}

export function stickToAxes(dx: number, dy: number, radius: number, deadzone: number): StickAxes {
  const len = Math.hypot(dx, dy);
  if (radius <= 0 || len <= deadzone * radius) return { steer: 0, throttle: 0, brake: 0 };
  // Rescale so the deadzone edge maps to 0 and the radius maps to 1, then clamp.
  const mag = Math.min(1, (len - deadzone * radius) / (radius * (1 - deadzone)));
  const nx = (dx / len) * mag;
  const ny = (dy / len) * mag;
  return {
    steer: Math.max(-1, Math.min(1, nx)),
    throttle: ny < 0 ? Math.min(1, -ny) : 0,
    brake: ny > 0 ? Math.min(1, ny) : 0,
  };
}
