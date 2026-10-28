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
  /** Tufts of grass to a tile of open meadow on the campaign map (none on low). */
  grass: number;
  /** The most raindrops or snowflakes falling at once. */
  particles: number;
  /** The miniature look: the land above and below the middle of the view softly out of focus. */
  tiltShift: boolean;
  /** Plain diffuse lighting on the map's ground, water and woods (for modest machines). */
  simpleShading: boolean;
}

export const SETTINGS: Record<Quality, QualitySettings> = {
  low: { pixelRatioCap: 1, bloom: false, ambientOcclusion: false, antialias: 'fxaa', shadows: 0, grass: 0, particles: 1500, tiltShift: false, simpleShading: true },
  medium: { pixelRatioCap: 1.5, bloom: true, ambientOcclusion: false, antialias: 'fxaa', shadows: 1024, grass: 6, particles: 4000, tiltShift: true, simpleShading: false },
  high: { pixelRatioCap: 2, bloom: true, ambientOcclusion: true, antialias: 'smaa', shadows: 2048, grass: 12, particles: 8000, tiltShift: true, simpleShading: false },
  ultra: { pixelRatioCap: 2.5, bloom: true, ambientOcclusion: true, antialias: 'smaa', shadows: 4096, grass: 20, particles: 14000, tiltShift: true, simpleShading: false },
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

const ADAPTIVE_KEY = 'palatinus.adaptive';

/** Whether to draw fewer pixels while frames come slowly (on unless the player turned it off). */
export function savedAdaptive(): boolean {
  try {
    return localStorage.getItem(ADAPTIVE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveAdaptive(on: boolean): void {
  try {
    localStorage.setItem(ADAPTIVE_KEY, on ? 'on' : 'off');
  } catch {
    // As above: the choice lasts the session.
  }
}
