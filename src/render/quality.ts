// How hard the renderer works. Each preset trades sharpness and effects
// against frame rate; the game picks one to suit the machine and the player
// can change it.

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export const QUALITIES: Quality[] = ['low', 'medium', 'high', 'ultra'];

export interface QualitySettings {
  /** The most device pixels drawn per CSS pixel (sharpness on high-density screens). */
  pixelRatioCap: number;
  /** Glow around the brightest light. */
  bloom: boolean;
  /** Soft shading where surfaces meet (ground-truth ambient occlusion). */
  ambientOcclusion: boolean;
  /** Edge smoothing: the quick kind, or the sharper, costlier kind. */
  antialias: 'fxaa' | 'smaa';
  /** Shadows cast by the sun, and their sharpness (texels per side). */
  shadows: number;
}

export const SETTINGS: Record<Quality, QualitySettings> = {
  low: { pixelRatioCap: 1, bloom: false, ambientOcclusion: false, antialias: 'fxaa', shadows: 0 },
  medium: { pixelRatioCap: 1.5, bloom: true, ambientOcclusion: false, antialias: 'fxaa', shadows: 1024 },
  high: { pixelRatioCap: 2, bloom: true, ambientOcclusion: true, antialias: 'smaa', shadows: 2048 },
  ultra: { pixelRatioCap: 2.5, bloom: true, ambientOcclusion: true, antialias: 'smaa', shadows: 4096 },
};

/**
 * A first guess at what this machine can carry: the WebGPU path is the newer
 * and quicker one, and a small screen needs fewer pixels.
 */
export function defaultQuality(backend: 'webgpu' | 'webgl2', screenPixels: number): Quality {
  if (backend === 'webgl2') return screenPixels > 2_500_000 ? 'medium' : 'high';
  return 'high';
}

const KEY = 'palatinus.quality';

/** The player's chosen preset, if any was kept (in this browser only). */
export function savedQuality(): Quality | null {
  try {
    const q = localStorage.getItem(KEY) as Quality | null;
    return q && QUALITIES.includes(q) ? q : null;
  } catch {
    return null;
  }
}

export function saveQuality(q: Quality): void {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    // Storage may be unavailable (a private window); the choice lasts the session.
  }
}
