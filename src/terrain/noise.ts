import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise";

import { RNG } from "../RNG";

/**
 * Independent noise channels derived from the world seed. Each channel is a
 * differently seeded simplex generator so fields don't correlate.
 */
export enum Channel {
  Continent,
  Erosion,
  Ridge,
  Detail,
  Temperature,
  Humidity,
  River,
  Cheese,
  SpaghettiA,
  SpaghettiB,
  Ravine,
  Surface,
  Count,
}

export class WorldNoise {
  private readonly channels: SimplexNoise[] = [];

  constructor(readonly seed: number) {
    for (let i = 0; i < Channel.Count; i++) {
      this.channels.push(
        new SimplexNoise(new RNG(hash32(seed, 0x51ed270b + i * 0x9e3779b9)))
      );
    }
  }

  /** Single octave 2D noise in [-1, 1] */
  noise2(ch: Channel, x: number, z: number): number {
    return this.channels[ch].noise(x, z);
  }

  /** Single octave 3D noise in [-1, 1] */
  noise3(ch: Channel, x: number, y: number, z: number): number {
    return this.channels[ch].noise3d(x, y, z);
  }

  /** Fractal Brownian motion, normalised to roughly [-1, 1] */
  fbm2(
    ch: Channel,
    x: number,
    z: number,
    octaves: number,
    lacunarity = 2,
    gain = 0.5
  ): number {
    const n = this.channels[ch];
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let freq = 1;
    for (let i = 0; i < octaves; i++) {
      sum += amp * n.noise(x * freq, z * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  fbm3(
    ch: Channel,
    x: number,
    y: number,
    z: number,
    octaves: number,
    lacunarity = 2,
    gain = 0.5
  ): number {
    const n = this.channels[ch];
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let freq = 1;
    for (let i = 0; i < octaves; i++) {
      sum += amp * n.noise3d(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /**
   * Ridged multifractal: sharp crests where the noise crosses zero. Returns
   * [0, 1] with 1 on the ridge lines.
   */
  ridge2(ch: Channel, x: number, z: number, octaves: number): number {
    const n = this.channels[ch];
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let freq = 1;
    let weight = 1;
    for (let i = 0; i < octaves; i++) {
      let s = 1 - Math.abs(n.noise(x * freq, z * freq));
      s *= s * weight;
      weight = Math.min(1, Math.max(0, s * 2));
      sum += s * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
}

const noiseCache = new Map<number, WorldNoise>();

export const worldNoise = (seed: number): WorldNoise => {
  let n = noiseCache.get(seed);
  if (!n) {
    n = new WorldNoise(seed);
    noiseCache.set(seed, n);
  }
  return n;
};

/** Mixes integers into a well distributed 32-bit hash */
export const hash32 = (...values: number[]): number => {
  let h = 0x811c9dc5;
  for (const v of values) {
    h = Math.imul(h ^ (v | 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  return h | 0;
};

/** Deterministic [0, 1) value for a world position, independent of chunk boundaries */
export const hashUnit = (...values: number[]): number =>
  (hash32(...values) >>> 0) / 4294967296;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

export const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Piecewise-linear spline through (x, y) control points sorted by x; clamps
 * outside the range.
 */
export const spline = (points: [number, number][], x: number): number => {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      return lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  }
  return points[points.length - 1][1];
};
