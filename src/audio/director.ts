import type { Clip } from '../timeline/model.js';
import type { TimeWarp } from '../timeline/warp.js';
import { SynthKit } from './synth.js';
import { notesInWindow, type MusicSection } from './music.js';

type Fn = (k: SynthKit, at: number) => void;
interface Ev { t: number; fn: Fn }

/** Turns the timeline into scheduled Web Audio events. Event times are *presentation* times, obtained from scene time
 *  through the Time Warp, so audio stays locked to the picture even inside slow motion. */
export class AudioDirector {
  ctx: AudioContext | null = null;
  kit: SynthKit | null = null;
  private events: Ev[] = [];
  private sections: MusicSection[] = [];
  private ducks: { r0: number; r1: number; level: number }[] = [];
  private slows: { r0: number; r1: number }[] = [];
  private speeches: { r: number; clip: Clip }[] = [];
  private base = 0;            // ctx time corresponding to presentation time 0
  private nextEv = 0;
  private scheduledMusic = 0;
  private timer: number | null = null;
  private playing = false;
  private fromReal = 0;
  volume = { master: 0.8, music: 0.5, sfx: 1, voice: 1 };
  muted = false;
  speechEnabled = true;
  lang: 'en' | 'ar' = 'en';
  realDuration = 0;
  stats = { scheduled: 0, notes: 0 };

  /** rebuild the cue lists from the timeline (cheap; runs whenever the timeline changes) */
  build(clips: Clip[], warp: TimeWarp) {
    const R = (t: number) => warp.realOf(t);
    const ev: Ev[] = [];
    const add = (t: number, fn: Fn) => ev.push({ t: R(t), fn });
    this.realDuration = warp.realDuration;
    this.sections = []; this.ducks = []; this.slows = []; this.speeches = [];
    for (const c of clips) {
      const p = c.params, pw = p.power ?? 0.5, sd = p.seed ?? 1, pan = p.pan ?? 0;
      switch (c.type) {
        case 'hit': add(c.start, (k, at) => k.hit(at, p.kind ?? 'punch', pw, sd, pan, p.space ?? 'ground')); break;
        case 'sfx_whoosh': add(c.start, (k, at) => k.whoosh(at, pw, Math.max(0.2, c.dur), pan, sd)); break;
        case 'sfx_block': add(c.start, (k, at) => k.block(at, pw, sd)); break;
        case 'sfx_explosion': add(c.start, (k, at) => k.explosion(at, pw)); break;
        case 'sfx_boom': add(c.start, (k, at) => k.boom(at, pw)); break;
        case 'sfx_rockBreak': add(c.start, (k, at) => k.rockBreak(at, pw, sd)); break;
        case 'sfx_charge': add(c.start, (k, at) => k.charge(at, Math.max(0.5, R(c.start + c.dur) - R(c.start)), pw)); break;
        case 'sfx_release': add(c.start, (k, at) => k.release(at, pw)); break;
        case 'sfx_footstep': add(c.start, (k, at) => k.footstep(at, pw, pan, sd)); break;
        case 'sfx_cloth': add(c.start, (k, at) => k.cloth(at, pw, sd)); break;
        case 'sfx_crack': add(c.start, (k, at) => k.crack(at, pw, sd)); break;
        case 'sfx_rumble': add(c.start, (k, at) => k.rumble(at, R(c.start + c.dur) - R(c.start), pw)); break;
        case 'sfx_riser': add(c.start, (k, at) => k.riser(at, R(c.start + c.dur) - R(c.start), pw)); break;
        case 'sfx_lightning': add(c.start, (k, at) => k.lightning(at, pw, sd)); break;
        case 'sfx_wind': add(c.start, (k, at) => k.windBed(at, R(c.start + c.dur) - R(c.start), pw)); break;
        case 'breathing': { const n = Math.floor(c.dur * (p.rate ?? 0.4)); for (let i = 0; i < n; i++) add(c.start + i / (p.rate ?? 0.4), (k, at) => k.breath(at, p.who ?? 'A', p.power ?? 0.3, i + 1)); break; }
        case 'steps': { const n = Math.floor(c.dur * (p.rate ?? 1.8)); for (let i = 0; i < n; i++) add(c.start + i / (p.rate ?? 1.8), (k, at) => k.footstep(at, p.power ?? 0.4, (p.who === 'A' ? -0.3 : 0.3) + (i % 2 ? 0.08 : -0.08), i + 3)); break; }
        case 'cry': add(c.start, (k, at) => k.cry(at, p.speaker ?? 'B', p.kind ?? 'shout', pw, Math.max(0.3, c.dur), sd)); break;
        case 'speech': this.speeches.push({ r: R(c.start), clip: c }); break;
        case 'section': this.sections.push({ r0: R(c.start), r1: R(c.start + c.dur), mood: p.mood ?? 'calm', intensity: p.intensity ?? 0.5, bpm: p.bpm ?? 90 }); break;
        case 'duck': this.ducks.push({ r0: R(c.start), r1: R(c.start + c.dur), level: p.level ?? 0 }); break;
        case 'speed': this.slows.push({ r0: R(c.start), r1: R(c.start + c.dur) }); break;
        default: break;
      }
    }
    ev.sort((a, b) => a.t - b.t);
    // a quiet ambient wind bed underneath the whole scene
    ev.unshift({ t: 0, fn: (k, at) => k.windBed(at, Math.max(5, warp.realDuration), 0.12) });
    this.events = ev;
  }

  private ensureCtx(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.kit = new SynthKit(this.ctx!);
    this.applyVolumes();
    return this.ctx;
  }
  applyVolumes() {
    if (!this.kit) return;
    const b = this.kit.buses, m = this.muted ? 0 : 1;
    b.master.gain.value = this.volume.master * m; b.music.gain.value = this.volume.music; b.sfx.gain.value = this.volume.sfx; b.voice.gain.value = this.volume.voice;
  }
  /** unlock/resume the AudioContext from a user gesture */
  async unlock() { const c = this.ensureCtx(); if (c && c.state !== 'running') { try { await c.resume(); } catch { /* ignore */ } } return !!c && c.state === 'running'; }
  get running() { return !!this.ctx && this.ctx.state === 'running'; }

  /** presentation time as seen by the audio clock (null when audio is not running) */
  clock(): number | null { return this.playing && this.ctx && this.ctx.state === 'running' ? this.ctx.currentTime - this.base : null; }

  async start(fromReal: number) {
    this.stop(false);
    const ok = await this.unlock();
    if (!ok || !this.ctx || !this.kit) return false;
    this.playing = true; this.fromReal = fromReal;
    this.base = this.ctx.currentTime + 0.08 - fromReal;
    this.nextEv = this.events.findIndex((e) => e.t >= fromReal - 0.001);
    if (this.nextEv < 0) this.nextEv = this.events.length;
    this.scheduledMusic = fromReal;
    // ambient bed has t=0 (already past): start it right now
    if (fromReal > 0.5) { const k = this.kit; k.windBed(this.base + fromReal, Math.max(5, this.realDuration - fromReal), 0.12); }
    this.scheduleDucks(fromReal);
    this.pump();
    this.timer = window.setInterval(() => this.pump(), 220);
    this.scheduleSpeech(fromReal);
    return true;
  }
  stop(cancelVoice = true) {
    this.playing = false;
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    if (cancelVoice) this.cancelSpeech();
    if (this.ctx) { // hard-stop everything already scheduled by rebuilding the graph
      const old = this.ctx;
      this.kit = null; this.ctx = null;
      old.close().catch(() => undefined);
    }
    this.speechTimers.forEach((t) => clearTimeout(t)); this.speechTimers = [];
  }
  pause() { this.stop(true); }
  /** audio stream of the master output for MediaRecorder (valid only while playing) */
  recordingStream(): MediaStream | null {
    if (!this.ctx || !this.kit) return null;
    const dest = this.ctx.createMediaStreamDestination();
    this.kit.buses.tap.connect(dest);
    return dest.stream;
  }

  private pump() {
    if (!this.playing || !this.ctx || !this.kit) return;
    const now = this.ctx.currentTime - this.base, horizon = now + 2.2;
    while (this.nextEv < this.events.length && this.events[this.nextEv].t < horizon) {
      const e = this.events[this.nextEv++];
      const at = this.base + e.t;
      if (at >= this.ctx.currentTime - 0.02) { e.fn(this.kit, Math.max(at, this.ctx.currentTime)); this.stats.scheduled++; }
    }
    const from = this.scheduledMusic, to = horizon;
    if (to > from) {
      for (const n of notesInWindow(this.sections, from, to)) {
        const at = this.base + n.t; if (at < this.ctx.currentTime - 0.02) continue;
        if (n.kind === 'drum') this.kit.drum(at, n.drum, n.vel, n.pitch); else this.kit.note(at, n.dur, n.midi, n.inst, n.vel);
        this.stats.notes++;
      }
      this.scheduledMusic = to;
    }
  }
  private scheduleDucks(fromReal: number) {
    if (!this.kit || !this.ctx) return;
    const g = this.kit.buses.musicDuck.gain, tone = this.kit.buses.tone.frequency;
    for (const d of this.ducks) {
      if (d.r1 < fromReal) continue;
      const a = this.base + Math.max(d.r0, fromReal), b = this.base + d.r1;
      g.setTargetAtTime(d.level, a, 0.03); g.setTargetAtTime(1, b, 0.35);
    }
    for (const s of this.slows) {
      if (s.r1 < fromReal) continue;
      tone.setTargetAtTime(2400, this.base + Math.max(s.r0, fromReal), 0.04); tone.setTargetAtTime(20000, this.base + s.r1, 0.08);
    }
  }

  // ---------------------------------------------------------------- speech (browser speech engine; best effort)
  private speechTimers: number[] = [];
  cancelSpeech() { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } this.speechTimers.forEach((t) => clearTimeout(t)); this.speechTimers = []; }
  private scheduleSpeech(fromReal: number) {
    if (!this.speechEnabled || !('speechSynthesis' in window)) return;
    for (const s of this.speeches) {
      if (s.r < fromReal - 0.1) continue;
      const p = s.clip.params, text = this.lang === 'ar' ? (p.ar || p.en) : (p.en || p.ar);
      if (!text) continue;
      const delay = Math.max(0, (s.r - fromReal) * 1000);
      this.speechTimers.push(window.setTimeout(() => this.speak(text, p), delay));
    }
  }
  private speak(text: string, p: Record<string, any>) {
    try {
      const u = new SpeechSynthesisUtterance(text);
      const who = p.speaker === 'B' ? 'B' : 'A';
      u.lang = this.lang === 'ar' ? 'ar-SA' : 'en-US';
      u.pitch = Math.min(2, Math.max(0, (who === 'A' ? 0.85 : 0.55) * (p.pitch ?? 1)));
      u.rate = Math.min(2, Math.max(0.5, (who === 'A' ? 0.92 : 1.0) * (p.rate ?? 1)));
      u.volume = Math.min(1, this.volume.voice);
      const voices = window.speechSynthesis.getVoices();
      const v = voices.find((x) => x.lang.toLowerCase().startsWith(this.lang)) ;
      if (v) u.voice = v;
      window.speechSynthesis.speak(u);
    } catch { /* speech is optional */ }
  }

  // ---------------------------------------------------------------- offline render (WAV export)
  async renderOffline(duration: number, sampleRate = 44100): Promise<AudioBuffer> {
    const off = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
    const kit = new SynthKit(off);
    kit.buses.master.gain.value = this.volume.master; kit.buses.music.gain.value = this.volume.music;
    for (const e of this.events) if (e.t < duration) e.fn(kit, Math.max(0, e.t));
    for (const n of notesInWindow(this.sections, 0, duration)) { if (n.kind === 'drum') kit.drum(n.t, n.drum, n.vel, n.pitch); else kit.note(n.t, n.dur, n.midi, n.inst, n.vel); }
    for (const d of this.ducks) { kit.buses.musicDuck.gain.setTargetAtTime(d.level, d.r0, 0.03); kit.buses.musicDuck.gain.setTargetAtTime(1, d.r1, 0.35); }
    for (const s of this.slows) { kit.buses.tone.frequency.setTargetAtTime(2400, s.r0, 0.04); kit.buses.tone.frequency.setTargetAtTime(20000, s.r1, 0.08); }
    return off.startRendering();
  }
}

export function audioBufferToWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, data[c][i])); out.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Blob([out.buffer], { type: 'audio/wav' });
}
