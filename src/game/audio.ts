/**
 * Procedural sound for marbles, synthesized with Web Audio (no sample files).
 *
 * - Rolling: low-passed brown noise per marble; cutoff and volume follow speed.
 *   Sounds like a low rumble on wood, not a hiss.
 * - Impact: a wooden "tock": a short low sine thump (~200 Hz, 100 ms) plus a
 *   30 ms band-limited noise burst (450-750 Hz) for the contact. No pitch sweeps (those read
 *   as chirps / birds).
 */
export interface MarbleAudioState {
  id: number;
  speed: number;
  /** Is the marble touching something (rolling) this frame? */
  contact: boolean;
  /** Impact strength this frame (m/s of velocity change), 0 if none. */
  impact: number;
  /** Per-marble variation, 0..1. */
  timbre: number;
}

const MIN_IMPACT = 1.0;
const IMPACT_COOLDOWN = 0.05;

interface Voice {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  lastImpact: number;
}

/** Brown-ish noise: leaky integration of white noise, normalized. */
export function makeBrownNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  let peak = 0;
  for (let i = 0; i < d.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last;
    peak = Math.max(peak, Math.abs(last));
  }
  for (let i = 0; i < d.length; i++) d[i] /= peak || 1;
  return buf;
}

export function makeWhiteNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Wooden impact "tock" at time t. Returns the nodes' end time. */
export function playImpact(ctx: BaseAudioContext, dest: AudioNode, white: AudioBuffer, t: number, strength: number, timbre: number): number {
  const s = Math.min(1, Math.max(0.15, strength));
  // Body: low thump. Slight per-marble variation, no sweep.
  const body = ctx.createOscillator();
  body.type = 'sine';
  body.frequency.value = 170 + timbre * 60;
  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(0.55 * s, t);
  bodyGain.gain.exponentialRampToValueAtTime(0.0005, t + 0.11);
  body.connect(bodyGain).connect(dest);
  body.start(t);
  body.stop(t + 0.1);

  // Contact: short band-limited noise burst around 450-750 Hz.
  const noise = ctx.createBufferSource();
  noise.buffer = white;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 450 + timbre * 300;
  bp.Q.value = 1.3;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.3 * s, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.0005, t + 0.03);
  noise.connect(bp).connect(noiseGain).connect(dest);
  noise.start(t, Math.random() * (white.duration - 0.1));
  noise.stop(t + 0.04);

  const end = t + 0.1;
  body.onended = () => {
    body.disconnect();
    bodyGain.disconnect();
    noise.disconnect();
    bp.disconnect();
    noiseGain.disconnect();
  };
  return end;
}

/** Rolling voice parameters for a given speed. */
export function rollingParams(speed: number): { gain: number; cutoff: number } {
  const v = Math.min(speed, 6);
  return { gain: Math.min(1, v / 4) * 0.32, cutoff: 180 + v * 110 };
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private brown: AudioBuffer | null = null;
  private white: AudioBuffer | null = null;
  private voices = new Map<number, Voice>();
  private _muted = false;
  /** Number of impact sounds played (for tests / debugging). */
  impactCount = 0;
  /** Number of impacts detected, whether or not audio was running. */
  impactsDetected = 0;

  constructor() {
    try {
      this._muted = localStorage.getItem('marble-run.muted') === '1';
    } catch {
      /* ignore */
    }
    // Browsers only allow audio after a user gesture; resume on the first one.
    const unlock = () => {
      this.ensure();
      this.ctx?.resume().catch(() => undefined);
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
  }

  get muted(): boolean {
    return this._muted;
  }

  setMuted(m: boolean): void {
    this._muted = m;
    try {
      localStorage.setItem('marble-run.muted', m ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.02);
  }

  get available(): boolean {
    return this.ctx !== null;
  }

  get state(): string {
    return this.ctx?.state ?? 'none';
  }

  private ensure(): void {
    if (this.ctx) return;
    const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this._muted ? 0 : 1;
    // Gentle limiter so many marbles don't clip.
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 5;
    this.master.connect(comp).connect(this.ctx.destination);
    this.brown = makeBrownNoise(this.ctx, 3);
    this.white = makeWhiteNoise(this.ctx, 1);
  }

  private voiceFor(id: number, timbre: number): Voice | null {
    if (!this.ctx || !this.master || !this.brown) return null;
    let v = this.voices.get(id);
    if (v) return v;
    const source = this.ctx.createBufferSource();
    source.buffer = this.brown;
    source.loop = true;
    source.loopStart = Math.random() * 1.5;
    source.playbackRate.value = 0.9 + timbre * 0.2;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    filter.Q.value = 0.6;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(this.master);
    source.start(0, Math.random() * 2);
    v = { source, filter, gain, lastImpact: -1 };
    this.voices.set(id, v);
    return v;
  }

  /** Call once per rendered frame with the current marble states. */
  update(states: MarbleAudioState[]): void {
    for (const s of states) if (s.impact >= MIN_IMPACT) this.impactsDetected++;
    if (!this.ctx || !this.master || !this.white || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const seen = new Set<number>();
    for (const s of states) {
      seen.add(s.id);
      const v = this.voiceFor(s.id, s.timbre);
      if (!v) continue;
      const rolling = s.contact && s.speed > 0.15;
      const p = rollingParams(s.speed);
      v.gain.gain.setTargetAtTime(rolling ? p.gain : 0, now, 0.06);
      v.filter.frequency.setTargetAtTime(p.cutoff + s.timbre * 60, now, 0.1);
      if (s.impact >= MIN_IMPACT && now - v.lastImpact > IMPACT_COOLDOWN) {
        v.lastImpact = now;
        this.impactCount++;
        playImpact(this.ctx, this.master, this.white, now, (s.impact - MIN_IMPACT) / 4 + 0.2, s.timbre);
      }
    }
    for (const [id, v] of this.voices) {
      if (seen.has(id)) continue;
      v.source.stop();
      v.source.disconnect();
      this.voices.delete(id);
    }
  }

  /** Number of xylophone notes requested (for tests). */
  notesPlayed = 0;

  /** A struck xylophone-bar note (two decaying partials). Used by the xylophone piece. */
  note(freq: number, strength = 0.6): void {
    this.notesPlayed++;
    if (!this.ctx || !this.master || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    for (const [ratio, amp, decay] of [
      [1, 0.5, 0.5],
      [2.76, 0.18, 0.18],
    ] as const) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * ratio;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(amp * strength, now);
      g.gain.exponentialRampToValueAtTime(0.0005, now + decay);
      osc.connect(g).connect(this.master);
      osc.start(now);
      osc.stop(now + decay + 0.02);
      osc.onended = () => {
        osc.disconnect();
        g.disconnect();
      };
    }
  }

  /**
   * Render a short preview offline (for tests / tuning): three impacts followed by
   * one second of rolling at 3 m/s. Returns the mono samples and sample rate.
   */
  static async renderPreview(): Promise<{ samples: Float32Array; sampleRate: number; impactEnd: number }> {
    const rate = 44100;
    const off = new OfflineAudioContext(1, rate * 2, rate);
    const white = makeWhiteNoise(off, 1);
    const brown = makeBrownNoise(off, 2);
    playImpact(off, off.destination, white, 0.05, 0.9, 0.3);
    playImpact(off, off.destination, white, 0.35, 0.5, 0.7);
    playImpact(off, off.destination, white, 0.65, 0.3, 0.5);
    const impactEnd = 1.0;
    const src = off.createBufferSource();
    src.buffer = brown;
    src.loop = true;
    const lp = off.createBiquadFilter();
    lp.type = 'lowpass';
    const p = rollingParams(3);
    lp.frequency.value = p.cutoff;
    lp.Q.value = 0.6;
    const g = off.createGain();
    g.gain.value = p.gain;
    src.connect(lp).connect(g).connect(off.destination);
    src.start(impactEnd);
    const buf = await off.startRendering();
    return { samples: buf.getChannelData(0), sampleRate: rate, impactEnd };
  }
}
