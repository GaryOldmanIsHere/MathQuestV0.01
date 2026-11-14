// A unit's strength bar in battle, as fighting games draw one: a blow cuts
// the bar at once and leaves a pale chip of what was lost, which drains away
// after a moment; a heal shows its gain ahead of the bar at once, and the
// bar rises to meet it. The bar follows the blows as they land, not the
// battle's outcome (which is decided before it is acted out).

/** After a blow, how long the chip holds before it drains, ms. */
export const CHIP_HOLD = 380;
/** How fast the chip drains, and a healed bar rises, in whole bars a second. */
export const DRAIN_RATE = 0.9;
export const RISE_RATE = 1.1;

export class StrengthBar {
  /** The bar's solid part, 0 to 1. */
  fill: number;
  /** The chip beyond it: what was just lost, or just regained. */
  chip: number;
  /** Whether the chip shows a loss or a gain. */
  chipKind: 'loss' | 'gain' = 'loss';
  private target: number;
  private hold = 0;

  constructor(ratio: number) {
    this.fill = this.chip = this.target = clamp01(ratio);
  }

  /** The strength now stands at `ratio` of the whole. */
  set(ratio: number): void {
    const r = clamp01(ratio);
    if (r < this.target) {
      // A blow: the bar drops at once; the chip keeps what it showed.
      this.chip = Math.max(this.chip, this.fill);
      this.chipKind = 'loss';
      this.fill = r;
      this.hold = CHIP_HOLD;
    } else if (r > this.target) {
      // A heal: the gain shows at once, and the bar rises to it.
      this.chip = r;
      this.chipKind = 'gain';
      this.hold = 0;
    }
    this.target = r;
  }

  /** Let `ms` pass. */
  step(ms: number): void {
    if (this.fill < this.target) {
      this.fill = Math.min(this.target, this.fill + (RISE_RATE * ms) / 1000);
      return;
    }
    if (this.hold > 0) {
      this.hold -= ms;
      return;
    }
    if (this.chip > this.fill) this.chip = Math.max(this.fill, this.chip - (DRAIN_RATE * ms) / 1000);
    else this.chip = this.fill;
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
