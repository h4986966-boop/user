// Tiny WebAudio synth so the game needs no audio assets.
export class Sfx {
  constructor() {
    this.ctx = null;
  }

  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  burst(duration, freq, volume, type = 'lowpass', q = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.15), t + duration);
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random() * 0.5, duration + 0.05);
  }

  tone(freq, duration, volume, type = 'sine') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  shot() { this.burst(0.18, 6000, 0.9); this.tone(140, 0.12, 0.5, 'square'); }
  shotgun() { this.burst(0.35, 4000, 1.2); this.tone(90, 0.25, 0.7, 'square'); }
  boom() { this.burst(1.2, 1800, 1.6); this.tone(55, 0.9, 1.0); }
  punch() { this.burst(0.12, 900, 0.9); this.tone(90, 0.1, 0.6); }
  whoosh() { this.burst(0.3, 2500, 0.35, 'bandpass', 2); }
  thud(v = 0.5) { this.burst(0.15, 500, Math.min(1, v)); }
  splat() { this.burst(0.2, 1200, 0.5, 'bandpass', 3); }
  pop() { this.tone(600, 0.08, 0.3, 'triangle'); }
}
