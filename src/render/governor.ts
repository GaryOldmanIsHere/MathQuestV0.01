// Adaptive resolution: when frames come too slowly, draw fewer pixels (the
// interface over the view stays sharp), and when they come easily again,
// draw more. It steps a share of the preset's sharpness, never below
// MIN_SCALE, and never back up to a share that was already too slow, so it
// settles rather than see-saws.

/** The least share of the preset's pixels it will draw. */
export const MIN_SCALE = 0.5;
/** How far it moves at a time. */
export const STEP = 0.1;
/** A window's average frame time (ms) beyond which it draws fewer pixels: about 45 frames a second. */
export const SLOW_MS = 22;
/** A window's average frame time (ms) within which it may draw more: the 60 a second of most displays. */
export const EASY_MS = 17.5;
/** Slow windows in a row before it steps down, and easy ones before it steps up. */
const SLOW_RUN = 2;
const EASY_RUN = 6;

export class ResolutionGovernor {
  /** The share of the preset's pixels drawn now, MIN_SCALE to 1. */
  scale = 1;
  /** The least share found too slow: it steps up only to below this. */
  private ceiling = Infinity;
  private slow = 0;
  private easy = 0;

  constructor(public enabled = true) {}

  /**
   * Weigh a window of frames (their average time, in ms). True if the
   * scale changed and the canvas should be resized to it.
   */
  observe(avgMs: number): boolean {
    if (!this.enabled) return false;
    if (avgMs > SLOW_MS) {
      this.easy = 0;
      if (++this.slow < SLOW_RUN || this.scale <= MIN_SCALE + 1e-6) return false;
      this.slow = 0;
      this.ceiling = Math.min(this.ceiling, this.scale);
      this.scale = round(Math.max(MIN_SCALE, this.scale - STEP));
      return true;
    }
    this.slow = 0;
    if (avgMs > EASY_MS || this.scale >= 1) {
      this.easy = 0;
      return false;
    }
    if (++this.easy < EASY_RUN) return false;
    this.easy = 0;
    const up = round(Math.min(1, this.scale + STEP));
    if (up >= this.ceiling - 1e-6) return false;
    this.scale = up;
    return true;
  }

  /** Start afresh (a new preset, or a new window size): back to full sharpness. */
  reset(): void {
    this.scale = 1;
    this.ceiling = Infinity;
    this.slow = 0;
    this.easy = 0;
  }
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}
