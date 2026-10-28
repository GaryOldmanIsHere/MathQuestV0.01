import type { Engine, View } from '../render/engine';
import { el } from '../ui/dom';

// The game's shell: one screen at the base (the title, or the campaign map),
// and at most one over it (a battle, or the army screen), which holds the
// map still until it closes. Every frame the screen in charge runs, and the
// engine draws whichever 3D view is showing, topmost first.

export type ScreenName = 'Title' | 'Overworld' | 'Battle' | 'Organize';

export interface Screen {
  readonly name: ScreenName;
  /** The screen's layer of interface, over the 3D view. */
  readonly root: HTMLElement;
  /** What to draw, or null to show the screen beneath. */
  view(): View | null;
  /** Let `ms` of real time pass. */
  update(ms: number): void;
  /** The view changed size (CSS pixels). */
  resize?(width: number, height: number): void;
  /** Another screen opened over this one, or closed again. */
  cover?(covered: boolean): void;
  dispose(): void;
}

export class App {
  private base: Screen | null = null;
  private overlay: Screen | null = null;
  private last = 0;
  private frames: number[] = [];
  private readonly fps: HTMLElement;
  private readonly events = new Map<string, Set<(payload: unknown) => void>>();
  /** The view last drawn, and whether it must be drawn again though nothing in it has moved. */
  private drawn: View | null = null;
  private stale = true;

  constructor(readonly engine: Engine, readonly ui: HTMLElement) {
    this.fps = el('div', { class: 'fps', ui: 'fps', hidden: '' });
    document.body.append(this.fps);
    engine.onResize((w, h) => {
      this.stale = true;
      this.base?.resize?.(w, h);
      this.overlay?.resize?.(w, h);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.fps.hidden = !this.fps.hidden;
      }
    });
    if (new URLSearchParams(location.search).has('fps')) this.fps.hidden = false;
  }

  start(): void {
    this.last = performance.now();
    this.engine.renderer.setAnimationLoop((t) => this.frame(t));
  }

  /** Replace the base screen (and close anything over it). */
  show(screen: Screen): void {
    this.closeOverlay();
    if (this.base) this.unmount(this.base);
    this.base = screen;
    this.mount(screen);
  }

  /** Open a screen over the base one, holding it still. */
  open(screen: Screen): void {
    this.closeOverlay();
    this.overlay = screen;
    this.mount(screen);
    this.base?.cover?.(true);
  }

  /** Close the screen over the base one; the base runs again. */
  close(screen: Screen): void {
    if (this.overlay !== screen) return;
    this.closeOverlay();
  }

  private closeOverlay(): void {
    const o = this.overlay;
    if (!o) return;
    this.overlay = null;
    this.unmount(o);
    this.base?.cover?.(false);
  }

  private mount(screen: Screen): void {
    this.stale = true;
    this.ui.append(screen.root);
    screen.resize?.(this.engine.width, this.engine.height);
  }

  private unmount(screen: Screen): void {
    this.stale = true;
    const view = screen.view();
    if (view) this.engine.release(view);
    screen.dispose();
    screen.root.remove();
  }

  /** Which screens are up, and which of them is held still. */
  isActive(name: ScreenName): boolean {
    return this.base?.name === name || this.overlay?.name === name;
  }

  isPaused(name: ScreenName): boolean {
    return this.base?.name === name && this.overlay !== null;
  }

  screen(name: ScreenName): Screen | null {
    if (this.base?.name === name) return this.base;
    if (this.overlay?.name === name) return this.overlay;
    return null;
  }

  on(event: string, fn: (payload: unknown) => void): () => void {
    let set = this.events.get(event);
    if (!set) this.events.set(event, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit(event: string, payload: unknown): void {
    for (const fn of [...(this.events.get(event) ?? [])]) fn(payload);
  }

  private frame(t: number): void {
    // A long stall (a hidden tab) counts as a short step, not a leap.
    const ms = Math.min(100, Math.max(0, t - this.last));
    this.last = t;
    const top = this.overlay ?? this.base;
    top?.update(ms);
    const own = this.overlay?.view() ?? null;
    const view = own ?? this.base?.view() ?? null;
    // A screen held still under one with no view of its own (the army
    // screen over the map) looks the same frame after frame: draw it once
    // and leave the canvas showing it, until the window or the screens change.
    const still = this.overlay !== null && own === null;
    if (view && (!still || this.stale || view !== this.drawn)) {
      this.engine.render(view);
      this.drawn = view;
      this.stale = false;
    }
    this.meter(ms);
  }

  private meter(ms: number): void {
    this.frames.push(ms);
    if (this.frames.length < 30) return;
    const avg = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
    this.frames = [];
    const e = this.engine;
    if (e.observeFrames(avg)) this.stale = true;
    if (this.fps.hidden) return;
    const info = e.renderer.info.render as { drawCalls?: number; calls?: number; triangles?: number };
    this.fps.textContent =
      `${(1000 / Math.max(1, avg)).toFixed(0)} fps · ${avg.toFixed(1)} ms · ${e.backend.toUpperCase()} · ${e.currentQuality}` +
      `${e.governor.scale < 1 ? ` (${Math.round(e.governor.scale * 100)}%)` : ''} · ` +
      `${Math.round(e.width * e.renderer.getPixelRatio())}×${Math.round(e.height * e.renderer.getPixelRatio())} · ` +
      `${info.drawCalls ?? info.calls ?? 0} draws`;
  }
}
