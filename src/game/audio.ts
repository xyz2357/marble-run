/**
 * Procedural sound for marbles: a per-marble rolling voice (filtered noise whose
 * pitch and volume follow speed) plus short glassy clicks on impacts.
 * Everything is synthesized with Web Audio, no sample files.
 */
export interface MarbleAudioState {
  id: number;
  speed: number;
  /** Is the marble touching something (rolling) this frame? */
  contact: boolean;
  /** Impact strength this frame (m/s of velocity change), 0 if none. */
  impact: number;
  /** Per-marble pitch variation, 0..1. */
  timbre: number;
}

const MIN_IMPACT = 1.0;
const IMPACT_COOLDOWN = 0.06;

interface Voice {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  lastImpact: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = new Map<number, Voice>();
  private _muted = false;
  /** Number of impact clicks played (for tests / debugging). */
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
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);

    const seconds = 2;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
  }

  private voiceFor(id: number, timbre: number): Voice | null {
    if (!this.ctx || !this.master || !this.noise) return null;
    let v = this.voices.get(id);
    if (v) return v;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    source.playbackRate.value = 0.8 + timbre * 0.4;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 600;
    filter.Q.value = 1.2;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
    v = { source, filter, gain, lastImpact: -1 };
    this.voices.set(id, v);
    return v;
  }

  /** Call once per rendered frame with the current marble states. */
  update(states: MarbleAudioState[]): void {
    for (const s of states) if (s.impact >= MIN_IMPACT) this.impactsDetected++;
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const seen = new Set<number>();
    for (const s of states) {
      seen.add(s.id);
      const v = this.voiceFor(s.id, s.timbre);
      if (!v) continue;
      const rolling = s.contact && s.speed > 0.15;
      const target = rolling ? Math.min(1, s.speed / 5) * 0.22 : 0;
      v.gain.gain.setTargetAtTime(target, now, 0.05);
      v.filter.frequency.setTargetAtTime(350 + Math.min(s.speed, 8) * 160 + s.timbre * 120, now, 0.08);
      if (s.impact >= MIN_IMPACT && now - v.lastImpact > IMPACT_COOLDOWN) {
        v.lastImpact = now;
        this.click(Math.min(1, (s.impact - MIN_IMPACT) / 5 + 0.25), s.timbre);
      }
    }
    for (const [id, v] of this.voices) {
      if (seen.has(id)) continue;
      v.source.stop();
      v.source.disconnect();
      this.voices.delete(id);
    }
  }

  /** A short glassy click. */
  private click(strength: number, timbre: number): void {
    if (!this.ctx || !this.master) return;
    this.impactCount++;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    const base = 1500 + timbre * 900;
    osc.frequency.setValueAtTime(base * 1.6, now);
    osc.frequency.exponentialRampToValueAtTime(base, now + 0.03);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.5 * strength, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.07 + strength * 0.05);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.15);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }
}
