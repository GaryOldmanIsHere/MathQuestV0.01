// Things to do after a while, counted on a screen's own clock: the clock
// only runs while the screen does, and runs faster with the debug speed-up.

interface Pending {
  at: number;
  fn: () => void;
}

export class Timers {
  private now = 0;
  private pending: Pending[] = [];

  /** Do `fn` once `ms` have passed on this clock. */
  after(ms: number, fn: () => void): void {
    this.pending.push({ at: this.now + ms, fn });
  }

  /**
   * Let `ms` pass, doing whatever falls due in the order it was due. The
   * clock stands at each one's time as it runs, so whatever it schedules is
   * timed from then: a long frame plays out as a run of short ones would.
   */
  update(ms: number): void {
    const until = this.now + ms;
    for (;;) {
      const due = this.pending.filter((p) => p.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.pending.splice(this.pending.indexOf(due), 1);
      this.now = Math.max(this.now, due.at);
      due.fn();
    }
    this.now = until;
  }

  clear(): void {
    this.pending = [];
  }
}
