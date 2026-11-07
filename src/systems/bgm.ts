/**
 * Background music (Dango Tower) — a generative music-box loop.
 *
 * No audio files: a tiny lookahead scheduler plays a gentle
 * pentatonic melody (triangle "music box" + a soft sine sparkle an
 * octave up), a round sine bass, and quiet chord tones, over a
 * C – Am – F – G progression at 96 BPM. It loops seamlessly and
 * follows the shared mute setting — muting silences the music too,
 * and unmuting rejoins the loop in phase.
 *
 * Like the sound effects, it can only start after a user gesture has
 * unlocked the AudioContext; `start()` is called from scene creates
 * and simply stays silent until the first tap unlocks audio.
 */
import { sound } from './sound';

/** Convert a MIDI note number to a frequency in Hz. */
export const midiToFreq = (midi: number): number =>
  440 * Math.pow(2, (midi - 69) / 12);

const BPM = 96;
/** One eighth note, in seconds. */
const STEP_SEC = 60 / BPM / 2;
const STEPS_PER_BAR = 8;

/** Chord roots per bar (MIDI): C3, A2, F2, G2 — twice around. */
export const BAR_ROOTS: readonly number[] = [48, 45, 41, 43, 48, 45, 41, 43];

/** Chord color tones per bar (third + fifth, MIDI), played softly. */
const BAR_CHORD_TONES: readonly (readonly [number, number])[] = [
  [64, 67], // C: E, G
  [60, 64], // Am: C, E
  [65, 69], // F: A, C
  [59, 62], // G: B, D
  [64, 67],
  [60, 64],
  [65, 69],
  [59, 62], // G: B, D
];

/**
 * The melody: 8 bars × 8 eighth steps of MIDI notes (null = rest).
 * C-major pentatonic with a couple of chord-color passing notes —
 * a small tune a music box in a sweet shop might play.
 */
export const MELODY: readonly (number | null)[] = [
  // Bar 1 (C)
  72, 76, 79, 81, 79, 76, 74, 76,
  // Bar 2 (Am)
  72, 76, 81, 84, 81, 76, 74, 72,
  // Bar 3 (F)
  77, 81, 79, 76, 77, 81, 84, 81,
  // Bar 4 (G)
  79, 83, 86, 83, 79, 76, 74, null,
  // Bar 5 (C)
  84, 81, 79, 76, 79, 81, 79, 76,
  // Bar 6 (Am)
  81, 84, 88, 84, 81, 79, 76, 74,
  // Bar 7 (F)
  77, 81, 84, 81, 79, 76, 77, 74,
  // Bar 8 (G -> home)
  74, 76, 79, 83, 81, 79, 76, null,
];

const TOTAL_STEPS = MELODY.length;

class BgmPlayer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextStepAt = 0;

  /** Start the loop (idempotent). Silent until audio is unlocked. */
  start(): void {
    if (this.timer !== null) return;
    const ctx = sound.context();
    if (!ctx) return;
    this.step = 0;
    this.nextStepAt = ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.tick(), 90);
  }

  /** Stop the loop entirely. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    const ctx = sound.context();
    if (!ctx) return;
    // If the tab was backgrounded, don't try to catch up in a burst.
    if (this.nextStepAt < ctx.currentTime - 0.25) {
      this.nextStepAt = ctx.currentTime + 0.05;
    }
    while (this.nextStepAt < ctx.currentTime + 0.18) {
      if (!sound.isMuted) {
        this.scheduleStep(this.step, this.nextStepAt, ctx);
      }
      // Steps advance even while muted, so the loop stays in phase
      // and unmuting rejoins the tune mid-phrase.
      this.step = (this.step + 1) % TOTAL_STEPS;
      this.nextStepAt += STEP_SEC;
    }
  }

  private scheduleStep(step: number, at: number, ctx: AudioContext): void {
    const bar = Math.floor(step / STEPS_PER_BAR);
    const inBar = step % STEPS_PER_BAR;

    if (inBar === 0 || inBar === 4) {
      this.note(ctx, midiToFreq(BAR_ROOTS[bar] + 12), at, 0.55, 'sine', 0.11);
    }
    if (inBar === 0) {
      for (const tone of BAR_CHORD_TONES[bar]) {
        this.note(ctx, midiToFreq(tone), at, 1.4, 'triangle', 0.028);
      }
    }
    const melody = MELODY[step];
    if (melody !== null) {
      this.note(ctx, midiToFreq(melody), at, 0.3, 'triangle', 0.13);
      this.note(ctx, midiToFreq(melody + 12), at, 0.18, 'sine', 0.04);
    }
  }

  /** One soft music-box note with a quick attack and a long fade. */
  private note(
    ctx: AudioContext,
    freq: number,
    at: number,
    dur: number,
    type: OscillatorType,
    vol: number,
  ): void {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(vol, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + dur + 0.05);
    } catch {
      // Ignore audio errors.
    }
  }
}

/** The shared BGM player. */
export const bgm = new BgmPlayer();
