import { hash1 } from '../utils/rng.js';

export interface MusicSection { r0: number; r1: number; mood: string; intensity: number; bpm: number }
export type MusicEv = { t: number; kind: 'note'; dur: number; midi: number; inst: string; vel: number } | { t: number; kind: 'drum'; drum: 'kick' | 'snare' | 'hat' | 'tom' | 'timp'; vel: number; pitch: number };

// D minor progression: Dm | Bb | Gm | A
const ROOTS = [38, 34, 43, 45];
const THIRDS = [3, 4, 3, 4];
const SCALE = [0, 2, 3, 5, 7, 8, 10];
const MELODY = [74, 77, 81, 79, 77, 74, 76, 72];
const BASSPAT = [0, 0, 12, 0, 7, 0, 10, 12];
const chord = (bar: number) => { const r = ROOTS[bar % 4]; return [r, r + THIRDS[bar % 4], r + 7]; };

/** Pure function of (sections, window): the procedural score. Nothing is streamed or stored. */
export function notesInWindow(secs: MusicSection[], a: number, b: number): MusicEv[] {
  const out: MusicEv[] = [];
  for (const s of secs) {
    if (s.r1 <= a || s.r0 >= b) continue;
    const beat = 60 / s.bpm, sd = beat / 4, I = s.intensity;
    const n0 = Math.max(0, Math.ceil((Math.max(a, s.r0) - s.r0) / sd)), n1 = Math.floor((Math.min(b, s.r1) - s.r0 - 1e-6) / sd);
    for (let n = n0; n <= n1; n++) {
      const t = s.r0 + n * sd, bar = Math.floor(n / 16), st = n % 16, ch = chord(bar), left = s.r1 - t;
      const note = (dur: number, midi: number, inst: string, vel: number) => out.push({ t, kind: 'note', dur: Math.min(dur, left + 0.3), midi, inst, vel });
      const drum = (d: 'kick' | 'snare' | 'hat' | 'tom' | 'timp', vel: number, pitch = 1) => out.push({ t, kind: 'drum', drum: d, vel, pitch });
      const rnd = hash1(n * 3.17 + s.r0 * 1.3);
      switch (s.mood) {
        case 'calm':
          if (st === 0 && bar % 2 === 0) { for (const m of ch) note(beat * 8, m + 12, 'pad', 0.55 * (0.5 + I)); note(beat * 8, ch[0] - 12, 'pad', 0.6); }
          if (st % 4 === 2 && rnd < 0.22 + 0.1 * I) note(beat * 2, 74 + SCALE[Math.floor(hash1(n) * 7)], 'pluck', 0.4);
          break;
        case 'tension':
          if (st % 8 === 0) drum('tom', 0.5 * (0.5 + I), 0.7);
          if (st % 2 === 0) note(sd * 1.6, (st % 4 === 0 ? ch[0] : ch[2]) + 12, 'string', 0.35 + 0.4 * I);
          if (st === 0) for (const m of ch) note(beat * 4, m, 'pad', 0.5);
          if (st % 4 === 3 && I > 0.5) drum('hat', 0.25);
          break;
        case 'escalation':
          if (st === 0 || st === 8 || (st === 10 && I > 0.6)) drum('kick', 0.8);
          if ((st === 4 || st === 12) && I > 0.3) drum('snare', 0.7);
          if (st % 2 === 0) drum('hat', 0.3 + 0.2 * I);
          if (st % 2 === 0) note(sd * 1.7, ch[0] + BASSPAT[(st / 2) % 8] * 0 + (st % 4 === 2 ? 12 : 0), 'bass', 0.7);
          if (st === 0) for (const m of ch) note(beat * 4, m + 12, 'string', 0.7);
          if (st % 2 === 1 && I > 0.6) note(sd, ch[(st >> 1) % 3] + 24, 'arp', 0.6);
          break;
        case 'fast': case 'final': {
          const fin = s.mood === 'final';
          if (st % 4 === 0 || (fin && (st === 10 || st === 14))) drum('kick', 0.85);
          if (st === 4 || st === 12) drum('snare', 0.8);
          drum('hat', st % 2 === 0 ? 0.35 : 0.2);
          note(sd * 0.9, ch[0] + (st % 4 === 2 ? 12 : st % 8 === 6 ? 7 : 0), 'bass', 0.75);
          note(sd * 0.8, ch[st % 3] + 24 + (st % 8 > 3 ? 12 : 0), 'arp', 0.55 + 0.3 * I);
          if (st === 6 || st === 14) for (const m of ch) note(sd * 1.5, m + 24, 'stab', 0.7);
          if (st === 0) for (const m of ch) note(beat * 4, m + 12, 'string', 0.8);
          if (fin && st % 4 === 0) note(beat * 0.95, MELODY[(bar * 4 + st / 4) % 8], 'brass', 0.85);
          break;
        }
        case 'awakening':
          if (st === 0 && bar % 2 === 0) { for (const m of ch) note(beat * 8, m + 12, 'choir', 0.6 + 0.4 * I); drum('timp', 0.55 + 0.4 * ((t - s.r0) / Math.max(1, s.r1 - s.r0))); }
          if (st === 8 && bar % 2 === 1) drum('timp', 0.6);
          if (st % 4 === 0 && I > 0.5) drum('tom', 0.3 + 0.3 * I, 0.8);
          break;
        case 'ending':
          if (st === 0 && bar % 2 === 0) for (const m of ch) note(beat * 8, m + 12, 'pad', 0.5);
          if ((st === 0 || st === 8) && rnd < 0.7) note(beat * 4, 74 + SCALE[Math.floor(hash1(n + 5) * 7)], 'bell', 0.5);
          break;
        default: break;
      }
    }
  }
  return out.sort((x, y) => x.t - y.t);
}
