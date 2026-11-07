/**
 * Sound effects (Dango Tower).
 *
 * Tiny WebAudio synth — no audio files to download, so the game stays
 * light and works offline. Effects are oscillator phrases with pitch
 * slides and springy "poyoon" (boing) pitch curves.
 * Browsers only allow audio after a user gesture; the first tap unlocks
 * the AudioContext (called from the title screen's first interaction).
 * Mute state is persisted in localStorage (see logic/storage.ts).
 *
 * v3.2 — the cute-sound update:
 * - Falling gets a soft descending whistle and landing a springy
 *   "poyoon" whose depth/length follows the impact.
 * - Every dango kind has its own little voice when it stacks,
 *   pitched by size (small = higher, large = deeper).
 */
import type { DangoKind } from '../constants/assets';
import { loadMuted, saveMuted } from '../logic/storage';
import type { DangoSize } from '../logic/tower';

type Tone = {
  /** Oscillator frequency in Hz. */
  freq: number;
  /** Optional pitch slide target (exponential ramp over the note). */
  slideTo?: number;
  /** Start time offset in seconds. */
  at: number;
  /** Note length in seconds. */
  dur: number;
  /** 'sine' for soft pops, 'triangle' for chimes, 'sawtooth' for buzzes. */
  type: OscillatorType;
  /** Peak volume 0..1. */
  vol: number;
};

type Boing = {
  /** Resting pitch the spring settles toward, in Hz. */
  base: number;
  /** Start time offset in seconds. */
  at: number;
  /** Total length in seconds. */
  dur: number;
  /** Peak volume 0..1. */
  vol: number;
  /** Wobble rate in Hz (how fast the pitch springs back and forth). */
  wobbleHz?: number;
  /** Oscillator type (sine by default). */
  type?: OscillatorType;
};

/** Effects master level. The BGM master runs at 0.5 (bgm.ts), so
 * effects sit clearly on top of the music (v3.3 mix). */
const SE_MASTER_GAIN = 1.3;

export class SoundFX {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted: boolean;

  constructor() {
    this.muted = loadMuted();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Toggle mute and persist it. Returns the new state. */
  toggleMuted(): boolean {
    this.muted = !this.muted;
    saveMuted(this.muted);
    return this.muted;
  }

  /** Create/resume the AudioContext. Call from a user gesture. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      // Audio is a nice-to-have; never break the game for it.
    }
  }

  /** The shared AudioContext (for the BGM player), or null. */
  context(): AudioContext | null {
    this.unlock();
    return this.ctx;
  }

  /** The effects master gain node, created with the context. */
  private out(): GainNode | null {
    this.unlock();
    if (!this.ctx) return null;
    if (!this.master) {
      this.master = this.ctx.createGain();
      this.master.gain.value = SE_MASTER_GAIN;
      this.master.connect(this.ctx.destination);
    }
    return this.master;
  }

  private play(tones: Tone[]): void {
    if (this.muted) return;
    const out = this.out();
    if (!this.ctx || !out) return;
    try {
      const now = this.ctx.currentTime;
      for (const tone of tones) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = tone.type;
        const start = now + tone.at;
        osc.frequency.setValueAtTime(tone.freq, start);
        if (tone.slideTo !== undefined) {
          osc.frequency.exponentialRampToValueAtTime(
            Math.max(30, tone.slideTo),
            start + tone.dur,
          );
        }
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(tone.vol, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.dur);
        osc.connect(gain).connect(out);
        osc.start(start);
        osc.stop(start + tone.dur + 0.05);
      }
    } catch {
      // Ignore audio errors.
    }
  }

  /**
   * A springy "poyoon": the pitch starts squashed low, overshoots,
   * and wobbles with decaying amplitude until it settles — the sound
   * of something soft and round landing.
   */
  private playBoing(boing: Boing): void {
    if (this.muted) return;
    const out = this.out();
    if (!this.ctx || !out) return;
    try {
      const start = this.ctx.currentTime + boing.at;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = boing.type ?? 'sine';
      const wobble = boing.wobbleHz ?? 7;
      const points = 48;
      const curve = new Float32Array(points);
      for (let i = 0; i < points; i++) {
        const t = (i / (points - 1)) * boing.dur;
        const decay = Math.exp(-5.2 * (t / boing.dur));
        curve[i] =
          boing.base * (1 - 0.48 * Math.cos(2 * Math.PI * wobble * t) * decay);
      }
      osc.frequency.setValueCurveAtTime(curve, start, boing.dur);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(boing.vol, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + boing.dur);
      osc.connect(gain).connect(out);
      osc.start(start);
      osc.stop(start + boing.dur + 0.05);
    } catch {
      // Ignore audio errors.
    }
  }

  click(): void {
    this.play([{ freq: 660, at: 0, dur: 0.07, type: 'sine', vol: 0.15 }]);
  }

  /**
   * Letting go of a dango: a soft "poi!" pop, then a gentle falling
   * whistle ("hyuuun") that fades as it drops.
   */
  drop(): void {
    this.play([
      { freq: 560, slideTo: 300, at: 0, dur: 0.09, type: 'sine', vol: 0.16 },
      { freq: 940, slideTo: 430, at: 0.03, dur: 0.38, type: 'sine', vol: 0.045 },
    ]);
  }

  /** A gentle landing when no impact sound played first. */
  land(): void {
    this.playBoing({ base: 390, at: 0, dur: 0.2, vol: 0.16, wobbleHz: 8 });
  }

  /**
   * "Poyoon" when a dango bumps into the counter or the tower.
   * `strength` is the impact speed (Matter px/step, roughly 0..20):
   * harder hits spring deeper, longer and a little louder; a light
   * touch is just a small "poyo".
   */
  pon(strength: number): void {
    const s = Math.min(1, Math.max(0, strength / 14));
    this.playBoing({
      base: 275 - s * 65,
      at: 0,
      dur: 0.24 + s * 0.3,
      vol: 0.15 + s * 0.15,
      wobbleHz: 7.5 - s * 1.5,
    });
    this.play([
      {
        freq: (275 - s * 65) * 2,
        at: 0.012,
        dur: 0.07,
        type: 'triangle',
        vol: 0.05,
      },
    ]);
  }

  /**
   * Each dango's own little voice, heard when it settles onto the
   * tower. Size pitches it: small dango squeak higher, large ones
   * sound deeper and rounder.
   */
  voice(kind: DangoKind, size: DangoSize): void {
    const pitch = size === 'small' ? 1.27 : size === 'large' ? 0.79 : 1;
    switch (kind) {
      case 'shiratama':
        // A bright round "pyon!"
        this.play([
          {
            freq: 830 * pitch,
            slideTo: 1250 * pitch,
            at: 0,
            dur: 0.13,
            type: 'sine',
            vol: 0.17,
          },
        ]);
        break;
      case 'sakura':
        // Airy twin tones, "fuwa..."
        this.play([
          {
            freq: 620 * pitch,
            slideTo: 705 * pitch,
            at: 0,
            dur: 0.2,
            type: 'sine',
            vol: 0.13,
          },
          {
            freq: 935 * pitch,
            slideTo: 1060 * pitch,
            at: 0.04,
            dur: 0.18,
            type: 'sine',
            vol: 0.09,
          },
        ]);
        break;
      case 'anko':
        // Low and heavy: a long deep "boyoon".
        this.playBoing({
          base: 175 * pitch,
          at: 0,
          dur: 0.42,
          vol: 0.2,
          wobbleHz: 5.5,
        });
        break;
      case 'mitarashi':
        // Sticky "peto!": a short syrupy thunk.
        this.play([
          {
            freq: 215 * pitch,
            slideTo: 82 * pitch,
            at: 0,
            dur: 0.1,
            type: 'triangle',
            vol: 0.22,
          },
          { freq: 1180 * pitch, at: 0, dur: 0.03, type: 'sine', vol: 0.06 },
        ]);
        break;
      case 'yomogi':
        // Calm and soft, "pofu..."
        this.play([
          {
            freq: 465 * pitch,
            slideTo: 315 * pitch,
            at: 0,
            dur: 0.24,
            type: 'sine',
            vol: 0.15,
          },
        ]);
        break;
      case 'matcha':
        // A quick sparkle chirp, "kira!"
        this.play([
          {
            freq: 990 * pitch,
            slideTo: 1480 * pitch,
            at: 0,
            dur: 0.1,
            type: 'triangle',
            vol: 0.15,
          },
          { freq: 1980 * pitch, at: 0.07, dur: 0.09, type: 'sine', vol: 0.07 },
        ]);
        break;
      case 'golden':
        // A tiny celebratory arpeggio, "shararan".
        this.play(
          [880, 1108, 1318, 1760].map((freq, i) => ({
            freq: freq * pitch,
            at: i * 0.055,
            dur: 0.16,
            type: 'triangle' as OscillatorType,
            vol: 0.13,
          })),
        );
        break;
    }
  }

  perfect(): void {
    this.perfectCombo(1);
  }

  /**
   * Perfect chime that climbs in pitch as the combo grows:
   * each extra combo step raises the melody by two semitones.
   */
  perfectCombo(combo: number): void {
    const steps = Math.min(Math.max(combo - 1, 0), 8);
    const ratio = Math.pow(2, (steps * 2) / 12);
    this.play([
      { freq: 660 * ratio, at: 0, dur: 0.1, type: 'triangle', vol: 0.2 },
      { freq: 880 * ratio, at: 0.08, dur: 0.16, type: 'triangle', vol: 0.2 },
      { freq: 990 * ratio, at: 0.16, dur: 0.2, type: 'sine', vol: 0.12 },
      { freq: 1980 * ratio, at: 0.16, dur: 0.12, type: 'sine', vol: 0.05 },
    ]);
  }

  /** Gentle two-note sigh when a dango slips off the counter. */
  miss(): void {
    this.play([
      { freq: 330, at: 0, dur: 0.16, type: 'sine', vol: 0.16 },
      { freq: 233, at: 0.14, dur: 0.26, type: 'sine', vol: 0.14 },
    ]);
  }

  /** Soft bright chime when a stacked Matcha buys more time (v3). */
  timeBonus(): void {
    this.play([
      { freq: 880, at: 0, dur: 0.1, type: 'triangle', vol: 0.16 },
      { freq: 1318, at: 0.08, dur: 0.18, type: 'sine', vol: 0.14 },
    ]);
  }

  gameOver(): void {
    this.play([
      { freq: 392, at: 0, dur: 0.18, type: 'triangle', vol: 0.18 },
      { freq: 330, at: 0.16, dur: 0.18, type: 'triangle', vol: 0.18 },
      { freq: 262, at: 0.32, dur: 0.3, type: 'triangle', vol: 0.18 },
    ]);
  }
}

/** One shared sound instance for the whole game. */
export const sound = new SoundFX();
