// The game's sounds, made in the browser as they are needed (no recordings):
// short tones and bursts of noise through the Web Audio API. Nothing sounds
// until the player has touched the page (browsers hold audio until then), nor
// where there is no audio at all.

import { comfort } from '../ui/comfort';

export type Sound =
  | 'click' | 'order' | 'select' | 'capture' | 'lost' | 'warn' | 'bell' | 'coin'
  | 'hit' | 'heavy' | 'crit' | 'miss' | 'arrow' | 'spell' | 'heal' | 'ko' | 'round' | 'levelup'
  | 'victory' | 'defeat';

type Wave = OscillatorType;

/** One voice of a sound: a tone (sliding to `to`, if given) or a burst of noise through a filter. */
export interface Voice {
  /** Seconds after the sound starts. */
  at: number;
  /** How long it sounds, in seconds. */
  for: number;
  /** A tone's pitch in Hz, or 'noise'. */
  pitch: number | 'noise';
  to?: number;
  wave?: Wave;
  /** Loudness at its peak, 0 to 1. */
  gain: number;
  /** For noise: where its filter sits, in Hz. */
  filter?: number;
}

const tone = (at: number, len: number, pitch: number, gain: number, wave: Wave = 'triangle', to?: number): Voice => ({ at, for: len, pitch, gain, wave, to });
const hiss = (at: number, len: number, filter: number, gain: number): Voice => ({ at, for: len, pitch: 'noise', gain, filter });
/** Notes one after another, each `step` seconds apart. */
const run = (pitches: number[], step: number, len: number, gain: number, wave: Wave = 'triangle', at = 0): Voice[] => pitches.map((p, k) => tone(at + k * step, len, p, gain, wave));

// The notes used (Hz).
const C4 = 261.6, E4 = 329.6, G4 = 392, A4 = 440, C5 = 523.3, D5 = 587.3, E5 = 659.3, G5 = 784, C6 = 1046.5;
const A3 = 220, F3 = 174.6, D3 = 146.8, C3 = 130.8;

/** Every sound, as the voices that make it. */
export const SOUNDS: Record<Sound, Voice[]> = {
  click: [tone(0, 0.05, 880, 0.18, 'square', 660)],
  select: [tone(0, 0.07, E5, 0.2), tone(0.05, 0.09, G5, 0.18)],
  order: [tone(0, 0.08, G4, 0.22), tone(0.07, 0.12, C5, 0.22)],
  coin: [tone(0, 0.06, 1320, 0.16, 'square'), tone(0.06, 0.14, 1760, 0.16, 'square')],
  capture: run([C5, E5, G5, C6], 0.09, 0.22, 0.24),
  lost: run([A4, F3 * 2, D3 * 2], 0.14, 0.3, 0.24, 'sawtooth'),
  warn: [tone(0, 0.16, A4, 0.22, 'square'), tone(0.2, 0.16, A4, 0.22, 'square')],
  bell: [tone(0, 0.9, C5, 0.2, 'sine'), tone(0, 0.6, C5 * 2.76, 0.07, 'sine'), tone(0, 0.4, C5 * 5.4, 0.04, 'sine')],
  round: [tone(0, 0.18, 110, 0.4, 'sine', 60), hiss(0, 0.08, 400, 0.2)],
  hit: [hiss(0, 0.09, 2400, 0.4), tone(0, 0.1, 180, 0.3, 'sine', 70)],
  heavy: [hiss(0, 0.14, 1600, 0.5), tone(0, 0.2, 140, 0.45, 'sine', 45)],
  crit: [hiss(0, 0.16, 3200, 0.5), tone(0, 0.22, 150, 0.45, 'sine', 45), tone(0.02, 0.3, C6, 0.2, 'triangle', C6 * 1.5)],
  miss: [hiss(0, 0.16, 5200, 0.14)],
  arrow: [hiss(0, 0.12, 4200, 0.2), tone(0, 0.12, 900, 0.1, 'sine', 300)],
  spell: [tone(0, 0.45, 300, 0.2, 'sawtooth', 1200), hiss(0.25, 0.3, 1800, 0.3), tone(0.3, 0.3, 90, 0.35, 'sine', 50)],
  heal: run([E5, G5, C6], 0.08, 0.35, 0.16, 'sine'),
  ko: [tone(0, 0.45, 220, 0.3, 'sawtooth', 55), hiss(0.2, 0.25, 500, 0.3)],
  levelup: run([G4, C5, E5, G5], 0.07, 0.2, 0.2, 'square'),
  victory: [...run([C4, E4, G4, C5], 0.14, 0.3, 0.26), tone(0.56, 0.9, E5, 0.24), tone(0.56, 0.9, G5, 0.2), tone(0.56, 0.9, C5, 0.2)],
  defeat: [...run([A3, F3, D3], 0.28, 0.5, 0.28, 'sawtooth'), tone(0.84, 1.1, C3, 0.3, 'sawtooth')],
};

interface AudioKit {
  ctx: AudioContext;
  out: GainNode;
  noise: AudioBuffer;
}

let kit: AudioKit | null = null;
/** Whether the player has touched the page yet (before that, browsers keep audio shut). */
let touched = false;
/** When each sound last started, so a volley of the same one does not pile up into a roar. */
const last = new Map<Sound, number>();

function audio(): AudioKit | null {
  if (kit) return kit;
  const Ctx = typeof window === 'undefined' ? undefined : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx || !touched) return null;
  try {
    const ctx = new Ctx();
    const out = ctx.createGain();
    // A gentle limiter, so many voices at once do not clip.
    const squash = ctx.createDynamicsCompressor();
    out.connect(squash).connect(ctx.destination);
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    kit = { ctx, out, noise };
  } catch {
    kit = null;
  }
  return kit;
}

/** Play a sound, at the volume the player has set (nothing, if that is off). */
export function play(sound: Sound): void {
  const volume = comfort().sound;
  if (!volume) return;
  const k = audio();
  if (!k) return;
  const { ctx, out, noise } = k;
  if (ctx.state === 'suspended') void ctx.resume();
  const now = ctx.currentTime;
  if (now - (last.get(sound) ?? -1) < 0.04) return;
  last.set(sound, now);
  out.gain.value = volume * 0.5;
  for (const v of SOUNDS[sound]) {
    const start = now + v.at;
    const end = start + v.for;
    const amp = ctx.createGain();
    // A quick rise, then a fall away to silence.
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(v.gain, start + Math.min(0.012, v.for / 4));
    amp.gain.exponentialRampToValueAtTime(0.0001, end);
    amp.connect(out);
    if (v.pitch === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = v.filter ?? 1000;
      src.connect(filter).connect(amp);
      src.start(start, Math.random() * 0.5);
      src.stop(end + 0.02);
    } else {
      const osc = ctx.createOscillator();
      osc.type = v.wave ?? 'triangle';
      osc.frequency.setValueAtTime(v.pitch, start);
      if (v.to) osc.frequency.exponentialRampToValueAtTime(v.to, end);
      osc.connect(amp);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  }
}

/**
 * Let sound begin with the player's first touch, and give every button its
 * click (the page's buttons, wherever they are made).
 */
export function wireSound(): void {
  const wake = () => {
    touched = true;
  };
  window.addEventListener('pointerdown', wake, true);
  window.addEventListener('keydown', wake, true);
  document.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    if (target?.closest?.('button, select')) play('click');
  }, true);
}
