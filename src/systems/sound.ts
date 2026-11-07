/**
 * Sound effects (Dango Tower).
 *
 * Tiny WebAudio synth — no audio files to download, so the game stays
 * light and works offline. Every effect is a short oscillator blip.
 * Browsers only allow audio after a user gesture; the first tap unlocks
 * the AudioContext (called from the title screen's first interaction).
 * Mute state is persisted in localStorage (see logic/storage.ts).
 */
import { loadMuted, saveMuted } from '../logic/storage';

type Tone = {
  /** Oscillator frequency in Hz. */
  freq: number;
  /** Start time offset in seconds. */
  at: number;
  /** Note length in seconds. */
  dur: number;
  /** 'sine' for soft pops, 'triangle' for chimes, 'sawtooth' for buzzes. */
  type: OscillatorType;
  /** Peak volume 0..1. */
  vol: number;
};

export class SoundFX {
  private ctx: AudioContext | null = null;
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

  private play(tones: Tone[]): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      for (const tone of tones) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = tone.type;
        osc.frequency.value = tone.freq;
        const start = now + tone.at;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(tone.vol, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.dur);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start(start);
        osc.stop(start + tone.dur + 0.05);
      }
    } catch {
      // Ignore audio errors.
    }
  }

  click(): void {
    this.play([{ freq: 660, at: 0, dur: 0.07, type: 'sine', vol: 0.15 }]);
  }

  drop(): void {
    this.play([{ freq: 420, at: 0, dur: 0.09, type: 'sine', vol: 0.18 }]);
  }

  land(): void {
    this.play([{ freq: 520, at: 0, dur: 0.1, type: 'triangle', vol: 0.2 }]);
  }

  /**
   * Soft "pon" when a dango bumps into the counter or the tower.
   * `strength` is the impact speed (Matter px/step, roughly 0..20):
   * harder hits sound deeper and a little louder.
   */
  pon(strength: number): void {
    const s = Math.min(1, Math.max(0, strength / 14));
    const freq = 300 - s * 110;
    this.play([
      { freq, at: 0, dur: 0.09 + s * 0.05, type: 'sine', vol: 0.14 + s * 0.16 },
      { freq: freq * 1.5, at: 0.01, dur: 0.06, type: 'triangle', vol: 0.08 },
    ]);
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
