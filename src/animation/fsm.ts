import { smoothstep, clamp } from '../utils/math.js';
import type { Clip } from '../timeline/model.js';

/** Character state meters derived (deterministically) from the timeline: what the fighter has done and taken so far. */
export interface Meters { fatigue: number; rage: number; power: number; airborne: boolean; state: FsmState; hits: number }
export type FsmState = 'idle' | 'guard' | 'attack' | 'defend' | 'hitstun' | 'recover' | 'airborne' | 'charging' | 'powered' | 'move' | 'knockdown';
export interface FsmEvent { t: number; kind: 'exert' | 'hit'; w: number }
export interface FsmData { id: 'A' | 'B'; events: FsmEvent[]; awaken: { t0: number; t1: number } | null; self: Clip[] }

export const contactTime = (c: Clip) => c.start + c.dur * (c.params.contact ?? 0.45);

export function buildFsm(id: 'A' | 'B', self: Clip[], opp: Clip[]): FsmData {
  const events: FsmEvent[] = [];
  let awaken: FsmData['awaken'] = null;
  for (const c of self) {
    const pw = c.params.power ?? 0.5;
    if (c.type === 'strike' || c.type === 'blast') events.push({ t: c.type === 'strike' ? contactTime(c) : c.start + c.dur * 0.5, kind: 'exert', w: 0.02 + 0.03 * pw });
    if (c.type === 'air' || (c.type === 'move' && (c.params.style === 'dash' || c.params.style === 'fly'))) events.push({ t: c.start + c.dur * 0.5, kind: 'exert', w: 0.015 });
    if (c.type === 'charge' && c.params.kind === 'awaken') awaken = { t0: c.start + c.dur * 0.15, t1: c.start + c.dur * 0.9 };
  }
  for (const c of opp) {
    if (c.type === 'strike' && !c.params.miss) { const pw = c.params.power ?? 0.5; events.push({ t: contactTime(c), kind: 'hit', w: 0.05 + 0.07 * pw }); }
    if (c.type === 'blast' && c.params.kind !== 'ball') events.push({ t: c.start + c.dur * 0.6, kind: 'hit', w: 0.1 });
  }
  events.sort((a, b) => a.t - b.t);
  return { id, events, awaken, self };
}

export function metersAt(f: FsmData, t: number, rootY: number): Meters {
  let fatigue = 0, rage = 0, hits = 0;
  const rageGain = f.id === 'B' ? 1.0 : 0.3;
  for (const e of f.events) {
    if (e.t > t) break;
    const age = t - e.t;
    if (e.kind === 'exert') fatigue += e.w * Math.exp(-age / 45);
    else { fatigue += e.w * 0.7 * Math.exp(-age / 45); rage += e.w * 1.3 * rageGain * Math.exp(-age / 90); hits++; }
  }
  if (f.id === 'B') rage += smoothstep(0, 230, t) * 0.25;
  const power = f.awaken ? smoothstep(f.awaken.t0, f.awaken.t1, t) : 0;
  fatigue *= 1 - 0.65 * power;
  const air = rootY > 0.6;
  return { fatigue: clamp(fatigue), rage: clamp(rage), power, airborne: air, state: 'idle', hits };
}

export function stateFor(type: string | null, meters: Meters, kind?: string): FsmState {
  if (type === 'react') return kind === 'slam' || kind === 'getup' ? 'knockdown' : 'hitstun';
  if (meters.airborne && type !== 'strike' && type !== 'blast') return 'airborne';
  switch (type) {
    case 'strike': case 'blast': return 'attack';
    case 'defend': return 'defend';
    case 'air': return 'airborne';
    case 'charge': return 'charging';
    case 'move': return 'move';
    default: return meters.power > 0.6 ? 'powered' : 'idle';
  }
}

/** Action selection driven by state - used by the choreographer so the fight adapts to fatigue / rage / power / altitude. */
export function pickDefense(m: Meters, incoming: string, power: number, r: number): { kind: string; dur: number } {
  if (m.power > 0.5) return { kind: r < 0.78 ? 'microDodge' : 'blink', dur: 0.32 };
  if (m.airborne) return { kind: 'airDodge', dur: 0.45 };
  if (m.fatigue > 0.55) return { kind: power > 0.5 ? 'blockCross' : 'backstep', dur: 0.6 };
  const high = /kickHigh|hook|axe|kickRound/.test(incoming);
  if (high) return r < 0.35 ? { kind: 'duck', dur: 0.5 } : r < 0.7 ? { kind: 'blockHigh', dur: 0.5 } : { kind: 'lean', dur: 0.45 };
  return r < 0.3 ? { kind: 'parry', dur: 0.45 } : r < 0.6 ? { kind: 'blockCross', dur: 0.5 } : r < 0.85 ? { kind: 'sidestep', dur: 0.45 } : { kind: 'backstep', dur: 0.5 };
}
export const pickRecovery = (m: Meters) => (m.fatigue > 0.5 ? { style: 'slow', dur: 0.75 } : { style: 'quick', dur: 0.45 });
export const strikePowerBoost = (m: Meters) => clamp(0.08 * m.rage + 0.1 * m.power - 0.1 * m.fatigue, -0.2, 0.25);
