import { mulberry32 } from '../utils/rng.js';

export interface Buses { tap: GainNode; master: GainNode; sfx: GainNode; music: GainNode; voice: GainNode; amb: GainNode; reverb: GainNode; musicDuck: GainNode; tone: BiquadFilterNode }

/** Every sound in the engine is synthesised: no audio files are shipped. Each builder schedules Web Audio nodes at an
 *  absolute context time, so the same code renders in real time or into an OfflineAudioContext (WAV export). */
export class SynthKit {
  buses: Buses;
  private noise: AudioBuffer;
  private pink: AudioBuffer;
  private rev: ConvolverNode;
  constructor(readonly ctx: BaseAudioContext) {
    const c = ctx;
    const master = c.createGain(); master.gain.value = 0.8;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 18; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    const tone = c.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 20000; // slow-motion muffle
    const tap = c.createGain(); tap.gain.value = 1;
    master.connect(tone); tone.connect(comp); comp.connect(tap); tap.connect(c.destination);
    const mk = (g: number) => { const n = c.createGain(); n.gain.value = g; n.connect(master); return n; };
    const musicDuck = c.createGain(); musicDuck.gain.value = 1; musicDuck.connect(master);
    const music = c.createGain(); music.gain.value = 0.5; music.connect(musicDuck);
    const reverb = c.createGain(); reverb.gain.value = 0.9; reverb.connect(master);
    this.buses = { tap, master, sfx: mk(1), music, voice: mk(1), amb: mk(0.6), reverb, musicDuck, tone };
    this.noise = this.makeNoise(c, 2, false); this.pink = this.makeNoise(c, 4, true);
    this.rev = c.createConvolver(); this.rev.buffer = this.makeIR(c, 2.6);
    const send = c.createGain(); send.gain.value = 1;
    this.rev.connect(reverb);
    this.revIn = send; send.connect(this.rev);
  }
  revIn: GainNode;

  private makeNoise(c: BaseAudioContext, sec: number, pink: boolean) {
    const b = c.createBuffer(1, Math.floor(c.sampleRate * sec), c.sampleRate), d = b.getChannelData(0), r = mulberry32(pink ? 99 : 5);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = r() * 2 - 1;
      if (pink) { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; } else d[i] = w;
    }
    return b;
  }
  private makeIR(c: BaseAudioContext, sec: number) {
    const n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate), r = mulberry32(77);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) { const t = i / n; d[i] = (r() * 2 - 1) * Math.pow(1 - t, 2.4) * (i < 800 ? i / 800 : 1); } }
    return b;
  }

  // ---------------------------------------------------------------- tiny helpers
  private src(at: number, dur: number, pink = false, seedOff = 0): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource(); s.buffer = pink ? this.pink : this.noise; s.loop = true;
    s.start(at, (seedOff * 0.37) % 1.5); s.stop(at + dur + 0.05);
    return s;
  }
  private osc(type: OscillatorType, f: number, at: number, dur: number): OscillatorNode {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, at); o.start(at); o.stop(at + dur + 0.05); return o;
  }
  private filt(type: BiquadFilterType, f: number, q = 1): BiquadFilterNode { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  private gainEnv(at: number, peak: number, atk: number, dec: number, sus = 0, hold = 0): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(Math.max(peak, 0.0002), at + atk);
    if (hold > 0) g.gain.setValueAtTime(Math.max(peak, 0.0002), at + atk + hold);
    g.gain.exponentialRampToValueAtTime(Math.max(sus, 0.0002), at + atk + hold + dec);
    return g;
  }
  private out(n: AudioNode, bus: GainNode, pan = 0, wet = 0) {
    let last: AudioNode = n;
    if (pan !== 0 && 'createStereoPanner' in this.ctx) { const p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); last.connect(p); last = p; }
    last.connect(bus);
    if (wet > 0) { const w = this.ctx.createGain(); w.gain.value = wet; last.connect(w); w.connect(this.revIn); }
  }

  // ---------------------------------------------------------------- combat sounds
  /** layered impact: base + low-frequency hit + transient + debris + environment reaction (reverb tail) */
  hit(at: number, kind: string, power: number, seed: number, pan = 0, space = 'ground') {
    const r = mulberry32(seed * 977 + 13), p = Math.max(0, Math.min(1, power));
    const bandF = (kind === 'kick' ? 700 : kind === 'punch' ? 1250 : kind === 'body' ? 520 : kind === 'crush' ? 900 : 800) * (1.15 - 0.4 * p) * (0.9 + r() * 0.25);
    // 1 base impact
    const n = this.src(at, 0.5, false, seed), bp = this.filt('bandpass', bandF, 0.9), g = this.gainEnv(at, 0.55 + 0.45 * p, 0.002, 0.1 + 0.22 * p);
    n.connect(bp); bp.connect(g); this.out(g, this.buses.sfx, pan, (space === 'rock' ? 0.45 : space === 'air' ? 0.15 : 0.28) * (0.3 + p));
    // 2 low-frequency hit
    const lo = this.osc('sine', (110 + 60 * r()) * (kind === 'heavy' ? 0.7 : 1), at, 0.6);
    lo.frequency.exponentialRampToValueAtTime(34 + 10 * (1 - p), at + 0.16 + 0.22 * p);
    const lg = this.gainEnv(at, (0.5 + 0.9 * p) * (kind === 'punch' ? 0.7 : 1), 0.003, 0.22 + 0.4 * p);
    lo.connect(lg); this.out(lg, this.buses.sfx, pan * 0.3, 0.1);
    // 3 transient click
    const tn = this.src(at, 0.1, false, seed + 3), hp = this.filt('highpass', 3200 + 1500 * r()), tg = this.gainEnv(at, 0.35 + 0.35 * p, 0.0005, 0.02 + 0.02 * p);
    tn.connect(hp); hp.connect(tg); this.out(tg, this.buses.sfx, pan);
    // 4 debris crackle
    if (p > 0.35 || kind === 'crush') {
      const k = Math.floor(5 + 14 * p);
      for (let i = 0; i < k; i++) {
        const t = at + 0.04 + r() * (0.25 + 0.5 * p), s = this.src(t, 0.06, false, seed + i), f = this.filt('bandpass', 1400 + r() * 3200, 2), gg = this.gainEnv(t, 0.06 + 0.12 * p * r(), 0.001, 0.02 + 0.03 * r());
        s.connect(f); f.connect(gg); this.out(gg, this.buses.sfx, pan + (r() - 0.5) * 0.4, 0.2);
      }
    }
    // 5 environment reaction: a delayed low boom tail for big hits
    if (p > 0.6) { const b = this.osc('sine', 62, at + 0.05, 1.4); b.frequency.exponentialRampToValueAtTime(28, at + 1.2); const bg = this.gainEnv(at + 0.05, 0.4 * p, 0.02, 1.2); b.connect(bg); this.out(bg, this.buses.sfx, 0, 0.5); }
  }
  whoosh(at: number, power: number, dur = 0.35, pan = 0, seed = 1) {
    const n = this.src(at, dur + 0.2, false, seed), f = this.filt('bandpass', 400, 1.2);
    f.frequency.setValueAtTime(350, at); f.frequency.exponentialRampToValueAtTime(2200 + 1800 * power, at + dur * 0.7); f.frequency.exponentialRampToValueAtTime(700, at + dur + 0.15);
    const g = this.gainEnv(at, 0.18 + 0.4 * power, dur * 0.45, dur * 0.6);
    n.connect(f); f.connect(g); this.out(g, this.buses.sfx, pan, 0.1);
  }
  block(at: number, power: number, seed = 1) {
    const r = mulberry32(seed + 5);
    for (const f of [520 + r() * 100, 1310 + r() * 200, 2620]) { const o = this.osc('square', f, at, 0.3), g = this.gainEnv(at, 0.08 + 0.1 * power, 0.001, 0.08 + 0.12 * power), b = this.filt('bandpass', f, 6); o.connect(b); b.connect(g); this.out(g, this.buses.sfx, 0, 0.2); }
    this.hit(at, 'body', power * 0.7, seed, 0, 'air');
  }
  explosion(at: number, power: number) {
    const p = Math.max(0.1, power);
    const n = this.src(at, 3.5, true, 4), lp = this.filt('lowpass', 3200, 0.6);
    lp.frequency.setValueAtTime(3800, at); lp.frequency.exponentialRampToValueAtTime(140, at + 1.2 + 2 * p);
    const g = this.gainEnv(at, 0.9 * p + 0.2, 0.004, 1.3 + 2.2 * p);
    n.connect(lp); lp.connect(g); this.out(g, this.buses.sfx, 0, 0.9);
    const b = this.osc('sine', 90, at, 2.5); b.frequency.exponentialRampToValueAtTime(26, at + 1.6 * p + 0.5);
    const bg = this.gainEnv(at, 1.2 * p + 0.2, 0.004, 1.4 + 1.6 * p); b.connect(bg); this.out(bg, this.buses.sfx, 0, 0.4);
    const t = this.src(at, 0.12, false, 8), hp = this.filt('highpass', 2500), tg = this.gainEnv(at, 0.5, 0.0005, 0.05); t.connect(hp); hp.connect(tg); this.out(tg, this.buses.sfx, 0, 0.3);
    // rumbling debris rain
    const r = mulberry32(31);
    for (let i = 0; i < 10 + 26 * p; i++) { const tt = at + 0.3 + r() * 2.6 * p, s = this.src(tt, 0.05, false, i), f = this.filt('bandpass', 800 + r() * 2600, 2), gg = this.gainEnv(tt, 0.05 * r(), 0.001, 0.03); s.connect(f); f.connect(gg); this.out(gg, this.buses.sfx, (r() - 0.5) * 1.4, 0.4); }
  }
  boom(at: number, power: number) { this.explosion(at, power * 0.8); }
  rockBreak(at: number, power: number, seed = 1) {
    const r = mulberry32(seed + 61), p = Math.max(0.1, power);
    this.hit(at, 'crush', 0.5 + 0.5 * p, seed, 0, 'rock');
    const k = Math.floor(14 + 30 * p);
    for (let i = 0; i < k; i++) { const t = at + 0.03 + Math.pow(r(), 1.6) * (1.2 + 1.6 * p), s = this.src(t, 0.12, false, i), f = this.filt('bandpass', 300 + r() * 2400, 3), gg = this.gainEnv(t, (0.05 + 0.15 * r()) * (1 - (t - at) / 3), 0.001, 0.03 + 0.06 * r()); s.connect(f); f.connect(gg); this.out(gg, this.buses.sfx, (r() - 0.5) * 1.6, 0.35); }
    const l = this.osc('sawtooth', 48, at, 1.4), lf = this.filt('lowpass', 160), lg = this.gainEnv(at, 0.3 * p, 0.03, 1.3); l.connect(lf); lf.connect(lg); this.out(lg, this.buses.sfx, 0, 0.4);
  }
  crack(at: number, power: number, seed = 1) { this.hit(at, 'crush', 0.35 + 0.4 * power, seed, 0, 'rock'); }
  charge(at: number, dur: number, power: number) {
    const o = this.osc('sawtooth', 70, at, dur), o2 = this.osc('square', 141, at, dur), f = this.filt('lowpass', 300, 4);
    o.frequency.exponentialRampToValueAtTime(70 * (3 + 3 * power), at + dur); o2.frequency.exponentialRampToValueAtTime(141 * (3 + 3 * power), at + dur);
    f.frequency.exponentialRampToValueAtTime(5000, at + dur);
    const g = this.gainEnv(at, 0.03, dur * 0.9, 0.06, 0.18 + 0.2 * power); g.gain.cancelScheduledValues(at + dur * 0.9);
    g.gain.setValueAtTime(0.22 + 0.2 * power, at + dur * 0.9); g.gain.exponentialRampToValueAtTime(0.0002, at + dur + 0.08);
    o.connect(f); o2.connect(f); f.connect(g); this.out(g, this.buses.sfx, 0, 0.3);
    const n = this.src(at, dur, true, 2), nf = this.filt('bandpass', 400, 2); nf.frequency.exponentialRampToValueAtTime(6000, at + dur);
    const ng = this.gainEnv(at, 0.02, dur * 0.95, 0.05, 0.2 * power + 0.05); n.connect(nf); nf.connect(ng); this.out(ng, this.buses.sfx, 0, 0.3);
    const sub = this.osc('sine', 40, at, dur); sub.frequency.linearRampToValueAtTime(90, at + dur);
    const sg = this.gainEnv(at, 0.01, dur * 0.95, 0.05, 0.35 * power + 0.1); sub.connect(sg); this.out(sg, this.buses.sfx);
  }
  release(at: number, power: number) {
    const o = this.osc('sawtooth', 900, at, 0.9); o.frequency.exponentialRampToValueAtTime(60, at + 0.7);
    const f = this.filt('lowpass', 6000); f.frequency.exponentialRampToValueAtTime(200, at + 0.8);
    const g = this.gainEnv(at, 0.35 + 0.3 * power, 0.005, 0.7); o.connect(f); f.connect(g); this.out(g, this.buses.sfx, 0, 0.5);
    this.whoosh(at, 1, 0.6); this.explosion(at + 0.02, power * 0.5);
  }
  footstep(at: number, power: number, pan = 0, seed = 1) {
    const r = mulberry32(seed);
    const n = this.src(at, 0.15, false, seed), lp = this.filt('lowpass', 420 + 300 * r() + 400 * power, 0.7), g = this.gainEnv(at, 0.2 + 0.3 * power, 0.002, 0.07 + 0.06 * power);
    n.connect(lp); lp.connect(g); this.out(g, this.buses.sfx, pan, 0.08);
    const s = this.src(at + 0.005, 0.08, false, seed + 2), hp = this.filt('highpass', 2200), sg = this.gainEnv(at + 0.005, 0.05 + 0.05 * power, 0.001, 0.04); s.connect(hp); hp.connect(sg); this.out(sg, this.buses.sfx, pan);
  }
  cloth(at: number, power: number, seed = 1) {
    const n = this.src(at, 0.4, true, seed), f = this.filt('bandpass', 1800 + 900 * power, 0.6), g = this.gainEnv(at, 0.05 + 0.08 * power, 0.06, 0.28);
    n.connect(f); f.connect(g); this.out(g, this.buses.sfx, (seedPan(seed)) * 0.6);
  }
  rumble(at: number, dur: number, power: number) {
    const n = this.src(at, dur, true, 6), lp = this.filt('lowpass', 90 + 80 * power, 1);
    const g = this.gainEnv(at, 0.05, Math.min(0.5, dur * 0.2), dur * 0.7, 0.05 + 0.25 * power); n.connect(lp); lp.connect(g); this.out(g, this.buses.sfx, 0, 0.2);
  }
  riser(at: number, dur: number, power: number) {
    const n = this.src(at, dur, false, 9), f = this.filt('bandpass', 300, 3); f.frequency.exponentialRampToValueAtTime(7000, at + dur);
    const g = this.gainEnv(at, 0.02, dur * 0.95, 0.05, 0.3 + 0.3 * power); n.connect(f); f.connect(g); this.out(g, this.buses.sfx, 0, 0.35);
    const o = this.osc('sawtooth', 110, at, dur); o.frequency.exponentialRampToValueAtTime(880, at + dur); const of = this.filt('lowpass', 2000); const og = this.gainEnv(at, 0.01, dur * 0.95, 0.05, 0.12 * power + 0.03); o.connect(of); of.connect(og); this.out(og, this.buses.sfx);
  }
  lightning(at: number, power: number, seed = 1) {
    const r = mulberry32(seed + 3);
    for (let i = 0; i < 4 + 6 * power; i++) { const t = at + r() * 0.5, s = this.src(t, 0.1, false, i), hp = this.filt('highpass', 1800 + r() * 3000), g = this.gainEnv(t, 0.08 + 0.12 * r(), 0.0005, 0.03 + 0.05 * r()); s.connect(hp); hp.connect(g); this.out(g, this.buses.sfx, (r() - 0.5) * 1.4, 0.25); }
    const b = this.osc('sawtooth', 55, at, 0.6), bf = this.filt('lowpass', 220), bg = this.gainEnv(at, 0.15 * power, 0.005, 0.5); b.connect(bf); bf.connect(bg); this.out(bg, this.buses.sfx, 0, 0.3);
  }
  windBed(at: number, dur: number, power: number) {
    const n = this.src(at, dur, true, 12), f = this.filt('bandpass', 500 + 400 * power, 0.5), lfo = this.osc('sine', 0.2 + 0.1 * power, at, dur), lg = this.ctx.createGain(); lg.gain.value = 250 + 250 * power;
    lfo.connect(lg); lg.connect(f.frequency);
    const g = this.gainEnv(at, 0.02, Math.min(dur * 0.3, 1.5), dur * 0.7, 0.14 * (0.3 + power)); g.gain.cancelScheduledValues(at); g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(0.06 + 0.16 * power, at + Math.min(dur * 0.3, 1.5)); g.gain.setValueAtTime(0.06 + 0.16 * power, at + dur - Math.min(dur * 0.3, 1.5)); g.gain.linearRampToValueAtTime(0.0002, at + dur);
    n.connect(f); f.connect(g); this.out(g, this.buses.amb, 0, 0.15);
  }
  breath(at: number, who: 'A' | 'B', power: number, seed = 1) {
    const dur = 0.7 - 0.25 * power, n = this.src(at, dur + 0.1, true, seed), f = this.filt('bandpass', (who === 'A' ? 1300 : 900) + 300 * power, 0.8);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(0.05 + 0.13 * power, at + dur * 0.35); g.gain.linearRampToValueAtTime(0.0002, at + dur);
    n.connect(f); f.connect(g); this.out(g, this.buses.voice, who === 'A' ? -0.15 : 0.15, 0.05);
  }
  /** formant battle cry / grunt / pain / roar */
  cry(at: number, who: 'A' | 'B', kind: string, power: number, dur: number, seed = 1) {
    const base = who === 'A' ? 155 : 100;
    const pitch = base * (kind === 'pain' ? 1.5 : kind === 'grunt' ? 0.9 : 1.1) * (0.9 + 0.3 * power);
    if (kind === 'breath') { this.breath(at, who, power, seed); return; }
    const o = this.osc('sawtooth', pitch, at, dur), o2 = this.osc('sawtooth', pitch * 1.006, at, dur);
    const contour = kind === 'pain' ? [1.0, 0.8] : kind === 'grunt' ? [1.0, 0.85] : [0.8, 1.25, 1.1];
    const step = dur / (contour.length);
    contour.forEach((k, i) => { o.frequency.linearRampToValueAtTime(pitch * k, at + step * (i + 0.5)); o2.frequency.linearRampToValueAtTime(pitch * k * 1.006, at + step * (i + 0.5)); });
    const lfo = this.osc('sine', 5.5, at, dur), lg = this.ctx.createGain(); lg.gain.value = pitch * 0.012; lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
    const sum = this.ctx.createGain(); o.connect(sum); o2.connect(sum);
    const form = kind === 'pain' ? [[600, 6], [1700, 8], [2600, 8]] : kind === 'grunt' ? [[500, 7], [1000, 6], [2400, 8]] : [[800, 7], [1200, 8], [2700, 8]];
    const mix = this.ctx.createGain();
    for (const [f, q] of form) { const b = this.filt('bandpass', f * (who === 'B' ? 0.85 : 1), q), fg = this.ctx.createGain(); fg.gain.value = 1.2; sum.connect(b); b.connect(fg); fg.connect(mix); }
    const nz = this.src(at, dur, true, seed), nf = this.filt('bandpass', 1800, 1), ng = this.ctx.createGain(); ng.gain.value = 0.25 + 0.4 * power; nz.connect(nf); nf.connect(ng); ng.connect(mix);
    let node: AudioNode = mix;
    if (who === 'B' || kind === 'roar') { const ws = this.ctx.createWaveShaper(); const c = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; c[i] = Math.tanh(x * (2.5 + 3 * power)); } ws.curve = c; mix.connect(ws); node = ws; }
    const g = this.gainEnv(at, 0.25 + 0.35 * power, Math.min(0.06, dur * 0.2), dur * 0.9, 0.0002, Math.max(0, dur * 0.35));
    node.connect(g); this.out(g, this.buses.voice, who === 'A' ? -0.12 : 0.12, 0.3);
  }

  // ---------------------------------------------------------------- music instruments
  drum(at: number, kind: 'kick' | 'snare' | 'hat' | 'tom' | 'timp', vel = 0.8, pitch = 1) {
    const B = this.buses.music;
    if (kind === 'kick') { const o = this.osc('sine', 150 * pitch, at, 0.4); o.frequency.exponentialRampToValueAtTime(42, at + 0.14); const g = this.gainEnv(at, vel, 0.002, 0.3); o.connect(g); this.out(g, B); const c = this.src(at, 0.03), h = this.filt('highpass', 2500), cg = this.gainEnv(at, vel * 0.3, 0.0005, 0.02); c.connect(h); h.connect(cg); this.out(cg, B); }
    else if (kind === 'snare') { const n = this.src(at, 0.3, false, 3), f = this.filt('bandpass', 2400, 0.7), g = this.gainEnv(at, vel * 0.8, 0.001, 0.16); n.connect(f); f.connect(g); this.out(g, B, 0, 0.2); const o = this.osc('triangle', 190, at, 0.15), og = this.gainEnv(at, vel * 0.5, 0.001, 0.08); o.connect(og); this.out(og, B); }
    else if (kind === 'hat') { const n = this.src(at, 0.06, false, 5), f = this.filt('highpass', 7000), g = this.gainEnv(at, vel * 0.3, 0.0005, 0.035); n.connect(f); f.connect(g); this.out(g, B); }
    else { const f0 = (kind === 'timp' ? 80 : 130) * pitch; const o = this.osc('sine', f0 * 1.4, at, 1.2); o.frequency.exponentialRampToValueAtTime(f0, at + 0.12); const g = this.gainEnv(at, vel, 0.004, kind === 'timp' ? 1.3 : 0.5); o.connect(g); this.out(g, B, 0, kind === 'timp' ? 0.5 : 0.2); const n = this.src(at, 0.06), nf = this.filt('lowpass', 1200), ng = this.gainEnv(at, vel * 0.4, 0.001, 0.05); n.connect(nf); nf.connect(ng); this.out(ng, B); }
  }
  private hz(m: number) { return 440 * Math.pow(2, (m - 69) / 12); }
  note(at: number, dur: number, midi: number, inst: string, vel: number) {
    const B = this.buses.music, f = this.hz(midi);
    if (inst === 'pad' || inst === 'choir' || inst === 'brass') {
      const g = this.ctx.createGain(); const atk = inst === 'brass' ? 0.08 : Math.min(dur * 0.45, 1.6);
      g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(vel * 0.16, at + atk); g.gain.setValueAtTime(vel * 0.16, at + Math.max(atk, dur - 0.4)); g.gain.linearRampToValueAtTime(0.0002, at + dur + 0.6);
      const lp = this.filt('lowpass', inst === 'brass' ? 2600 : 1300, 0.7);
      for (const d of [-7, 0, 8]) { const o = this.osc('sawtooth', f, at, dur + 0.7); o.detune.value = d; if (inst === 'choir') { const b1 = this.filt('bandpass', 750, 5), b2 = this.filt('bandpass', 1150, 6); o.connect(b1); o.connect(b2); b1.connect(lp); b2.connect(lp); } else o.connect(lp); }
      lp.connect(g); this.out(g, B, 0, 0.35);
    } else if (inst === 'pluck' || inst === 'bell') {
      for (const [m, a] of inst === 'bell' ? [[1, 1], [2.76, 0.35], [5.4, 0.15]] : [[1, 1], [2, 0.3]]) { const o = this.osc(inst === 'bell' ? 'sine' : 'triangle', f * m, at, dur + 1.5), g = this.gainEnv(at, vel * 0.25 * a, 0.003, inst === 'bell' ? 1.8 : 0.5); o.connect(g); this.out(g, B, 0, 0.5); }
    } else if (inst === 'bass') {
      const o = this.osc('sawtooth', f, at, dur), s = this.osc('sine', f / 2, at, dur), lp = this.filt('lowpass', 500 + 700 * vel, 2); lp.frequency.exponentialRampToValueAtTime(180, at + dur);
      const g = this.gainEnv(at, vel * 0.32, 0.005, dur * 0.9); o.connect(lp); s.connect(lp); lp.connect(g); this.out(g, B);
    } else if (inst === 'arp') {
      const o = this.osc('sawtooth', f, at, dur + 0.2), lp = this.filt('lowpass', 3500, 3); lp.frequency.exponentialRampToValueAtTime(600, at + dur + 0.1);
      const g = this.gainEnv(at, vel * 0.13, 0.003, dur + 0.05); o.connect(lp); lp.connect(g); this.out(g, B, 0, 0.25);
    } else if (inst === 'stab') {
      const g = this.gainEnv(at, vel * 0.13, 0.004, dur), lp = this.filt('lowpass', 2500);
      for (const d of [-9, 9]) { const o = this.osc('sawtooth', f, at, dur + 0.1); o.detune.value = d; o.connect(lp); }
      lp.connect(g); this.out(g, B, 0, 0.25);
    } else if (inst === 'string') {
      const lp = this.filt('lowpass', 2200), g = this.gainEnv(at, vel * 0.1, 0.02, dur * 0.8);
      for (const d of [-6, 6]) { const o = this.osc('sawtooth', f, at, dur + 0.2); o.detune.value = d; o.connect(lp); }
      lp.connect(g); this.out(g, B, 0, 0.2);
    }
  }
}
const seedPan = (s: number) => Math.sin(s * 12.99) ;
