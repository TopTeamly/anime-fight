import type { TimelineData } from '../timeline/model.js';
import { buildFight } from '../timeline/fight.js';

export interface SceneEntry { id: string; name: string; description: string; build: () => TimelineData }

/** A "scene" is just a TimelineData factory (plus the shared environment). Add your own here - see README. */
function rigLab(): TimelineData {
  const clips: TimelineData['clips'] = [];
  let n = 1;
  const add = (track: any, type: string, start: number, dur: number, params: any) => clips.push({ id: 'l' + n++, track, type, start, dur, params });
  add('charA', 'stance', 0, 30, { kind: 'relaxed' }); add('charB', 'stance', 0, 30, { kind: 'guardLow' });
  add('camera', 'shot', 0, 30, { subject: 'both', shot: 'orbit', bone: 'chest', az0: -30, az1: 60, d0: 6, d1: 6, h0: 1.5, h1: 1.5, fov0: 36, fov1: 36, ease: 'inOut', lag: 0.1, shake: 0, roll: 0 });
  add('lighting', 'key', 0, 0.1, { sunAz: -35, sunEl: 32, sunCol: '#ffe6c8', sunI: 1.8, skyTop: '#3f68b8', skyHor: '#f5c9a0', fogCol: '#d3b39c', fogDen: 0.0022, exposure: 1.0, bloom: 0.35 });
  add('charA', 'strike', 6, 0.7, { kind: 'cross', side: 'R', power: 0.6, contact: 0.45, target: 'chest', miss: true, to: [-1.0, 0, 0] });
  add('charB', 'defend', 6.1, 0.5, { kind: 'lean', power: 0.5, to: [1.4, 0, 0] });
  add('charB', 'strike', 9, 0.8, { kind: 'kickRound', side: 'R', power: 0.7, contact: 0.45, target: 'head', miss: true, to: [0.4, 0, 0] });
  add('charA', 'defend', 9.1, 0.6, { kind: 'duck', power: 0.5, to: [-1.2, 0, 0] });
  add('charA', 'charge', 13, 6, { kind: 'aura', level: 0.8 });
  add('vfx', 'aura', 13.5, 6, { attach: 'A', who: 'A', scale: 1, intensity: 1, color: '#fff1b0', color2: '#ffb63b' });
  add('music', 'section', 0, 30, { mood: 'calm', intensity: 0.4, bpm: 80 });
  return { version: 1, name: 'Rig Lab', duration: 30, fps: 30, startPos: { A: [-1.4, 0, 0], B: [1.4, 0, 0] }, clips, markers: [{ t: 0, label: 'RIG LAB', color: '#8fc4ff' }] };
}

export const SCENES: SceneEntry[] = [
  { id: 'duel', name: 'Duel at Shattered Ridge', description: 'The full continuous fight: 7 phases, awakening, finale and ending.', build: buildFight },
  { id: 'riglab', name: 'Rig Lab', description: 'Two fighters in a quiet arena to test poses, faces, IK/FK and the manual rig controls.', build: rigLab },
];
