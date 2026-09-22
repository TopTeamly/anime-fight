import type { TrackId } from './model.js';
import { STRIKE_KINDS, DEFEND_KINDS, REACT_KINDS, AIR_KINDS, CHARGE_KINDS, BLAST_KINDS, EMOTE_KINDS } from '../animation/actions.js';
import { EASE_NAMES } from '../utils/ease.js';

export interface ParamDef {
  key: string; label: string; kind: 'number' | 'select' | 'vec3' | 'text' | 'bool' | 'color' | 'vec2';
  min?: number; max?: number; step?: number; options?: string[]; def?: any; multiline?: boolean;
}
export interface ClipTypeDef { type: string; track: TrackId | TrackId[]; label: string; color: string; dur: number; params: ParamDef[]; desc?: string }

const num = (key: string, label: string, min: number, max: number, step: number, def: number): ParamDef => ({ key, label, kind: 'number', min, max, step, def });
const sel = (key: string, label: string, options: string[], def: string): ParamDef => ({ key, label, kind: 'select', options, def });
const v3 = (key: string, label: string, def: number[]): ParamDef => ({ key, label, kind: 'vec3', def });
const col = (key: string, label: string, def: string): ParamDef => ({ key, label, kind: 'color', def });
const txt = (key: string, label: string, def = '', multiline = false): ParamDef => ({ key, label, kind: 'text', def, multiline });
const EXPR = ['neutral', 'calm', 'focus', 'angry', 'grit', 'shock', 'scream', 'pain', 'smile', 'smirk', 'exhausted', 'awakened', 'strain'];
const CH: TrackId[] = ['charA', 'charB'];
const power = num('power', 'Power', 0, 1, 0.05, 0.5);
const to = v3('to', 'Root target (x,y,z)', [0, 0, 0]);

const T = (type: string, track: TrackId | TrackId[], label: string, color: string, dur: number, params: ParamDef[], desc?: string): ClipTypeDef => ({ type, track, label, color, dur, params, desc });

export const CLIP_TYPES: ClipTypeDef[] = [
  // characters
  T('stance', CH, 'Stance', '#6c7a99', 4, [sel('kind', 'Stance', ['neutral', 'relaxed', 'guard', 'guardLow', 'armsCrossed', 'powered', 'air', 'crouch', 'exhausted', 'charge'], 'guard')], 'Base pose that persists until the next stance clip.'),
  T('move', CH, 'Move', '#7d92c9', 0.8, [to, sel('style', 'Style', ['walk', 'slide', 'dash', 'blink', 'fly', 'land'], 'walk'), sel('ease', 'Ease', EASE_NAMES, 'inOut')], 'Root motion with footwork.'),
  T('strike', CH, 'Strike', '#e0645c', 0.7, [sel('kind', 'Kind', STRIKE_KINDS, 'cross'), sel('side', 'Side', ['L', 'R'], 'R'), power, num('contact', 'Contact (0-1)', 0.2, 0.8, 0.01, 0.45), sel('target', 'Target', ['head', 'chest', 'gut', 'ground', 'feet'], 'chest'), { key: 'miss', label: 'Miss (whiff)', kind: 'bool', def: false }, to, v3('point', 'Ground point', [0, 0, 0])], 'Preparation → action → contact → reaction → recovery.'),
  T('defend', CH, 'Defend', '#4fb0a0', 0.5, [sel('kind', 'Kind', DEFEND_KINDS, 'blockHigh'), power, to], 'Block / dodge / parry.'),
  T('react', CH, 'React', '#d59340', 0.7, [sel('kind', 'Kind', REACT_KINDS, 'flinch'), power, to], 'Hit reaction and recovery.'),
  T('air', CH, 'Air', '#79c0ff', 0.8, [sel('kind', 'Kind', AIR_KINDS, 'ascend'), to], 'Flight / aerial movement.'),
  T('charge', CH, 'Charge', '#c58cff', 2, [sel('kind', 'Kind', CHARGE_KINDS, 'ki'), num('level', 'Level', 0, 1, 0.05, 0.5), to], 'Energy charge / awakening.'),
  T('blast', CH, 'Blast', '#ff9d4d', 0.9, [sel('kind', 'Kind', BLAST_KINDS, 'ball'), sel('side', 'Side', ['L', 'R'], 'R'), power], 'Energy release pose.'),
  T('emote', CH, 'Emote', '#c9b6a0', 1.5, [sel('kind', 'Kind', EMOTE_KINDS, 'talk'), sel('expr', 'Expression', EXPR, 'neutral')], 'Facial / talk pose.'),
  // camera
  T('shot', 'camera', 'Shot', '#ffc247', 3, [
    sel('shot', 'Shot type', ['wide', 'medium', 'close', 'xclose', 'low', 'high', 'ots', 'tracking', 'orbit', 'dolly', 'zoom', 'fastPan', 'whipPan', 'eyes', 'feet', 'top'], 'medium'),
    sel('subject', 'Subject', ['A', 'B', 'both', 'point'], 'both'), sel('bone', 'Focus', ['head', 'chest', 'gut', 'feet', 'eyes', 'fistL', 'fistR', 'footR', 'root'], 'chest'),
    num('az0', 'Azimuth start (°)', -360, 360, 1, 0), num('az1', 'Azimuth end (°)', -360, 360, 1, 0), num('d0', 'Distance start (m)', 0.3, 200, 0.1, 6), num('d1', 'Distance end (m)', 0.3, 200, 0.1, 6),
    num('h0', 'Height start (m)', -5, 100, 0.1, 1.4), num('h1', 'Height end (m)', -5, 100, 0.1, 1.4), num('fov0', 'FOV start (°)', 8, 110, 1, 40), num('fov1', 'FOV end (°)', 8, 110, 1, 40),
    num('roll', 'Roll (°)', -45, 45, 0.5, 0), num('shake', 'Sustain shake', 0, 1, 0.01, 0), sel('ease', 'Ease', EASE_NAMES, 'inOut'), num('lag', 'Follow lag', 0, 1, 0.01, 0.15), v3('point', 'Point', [0, 1, 0]), num('lookAhead', 'Look ahead (m)', 0, 5, 0.1, 0),
  ], 'Camera direction. Shake from impacts is added automatically.'),
  // vfx
  ...(['aura', 'sparks', 'dust', 'smoke', 'fire', 'lightning', 'shockwave', 'trail', 'beam', 'groundCrack', 'crater', 'debris', 'explosion', 'flash', 'heatDistort', 'burst', 'energyBall', 'speedLines', 'impactFrame', 'afterimage', 'groundHit'] as const).map((n) =>
    T(n, 'vfx', n.charAt(0).toUpperCase() + n.slice(1).replace(/([A-Z])/g, ' $1'), '#ff7a45', n === 'flash' || n === 'impactFrame' ? 0.12 : 1.2, [
      sel('attach', 'Attach', ['world', 'A', 'B'], 'world'), sel('bone', 'Bone', ['root', 'chest', 'head', 'hips', 'fistL', 'fistR', 'footL', 'footR', 'eyes'], 'root'),
      v3('pos', 'Position', [0, 0, 0]), v3('rot', 'Rotation (°)', [0, 0, 0]), num('intensity', 'Intensity', 0, 3, 0.05, 1), num('scale', 'Scale', 0.05, 30, 0.05, 1), num('opacity', 'Opacity', 0, 1, 0.01, 1),
      col('color', 'Colour', '#ffd9a0'), col('color2', 'Colour 2', '#ff8a3a'), num('seed', 'Seed', 0, 9999, 1, 1), sel('who', 'Style', ['A', 'B', 'neutral'], 'neutral'),
      v3('to', 'Target / end (beam, trail)', [0, 0, 0]),
    ], n === 'groundHit' ? 'Composite: crack + dust + debris (+ crater and shockwave when strong).' : undefined)),
  // environment
  T('rockBreak', 'environment', 'Rock break', '#c49a6c', 0.2, [v3('pos', 'Position', [0, 0, 0]), num('radius', 'Search radius', 0.5, 40, 0.5, 4)], 'Shatters the nearest boulder(s).'),
  T('pillarFall', 'environment', 'Pillar fall', '#b0855a', 0.2, [v3('pos', 'Position', [0, 0, 0]), num('radius', 'Search radius', 0.5, 40, 0.5, 6), num('yaw', 'Fall direction (°)', -360, 360, 1, 0)], 'Topples the nearest rock pillar.'),
  T('wind', 'environment', 'Wind', '#a8b08a', 6, [num('speed', 'Speed', 0, 5, 0.05, 1)]),
  // dialogue / voice
  T('line', 'dialogue', 'Line', '#e58fe0', 2.5, [sel('speaker', 'Speaker', ['A', 'B'], 'A'), txt('en', 'English', '', true), txt('ar', 'Arabic', '', true), sel('expr', 'Expression', EXPR, 'neutral')], 'Subtitle + lip-sync + facial expression.'),
  T('speech', 'voice', 'Speech', '#b18cff', 2.5, [sel('speaker', 'Speaker', ['A', 'B'], 'A'), txt('en', 'English text', '', true), txt('ar', 'Arabic text', '', true), num('pitch', 'Pitch', 0.3, 2, 0.05, 1), num('rate', 'Rate', 0.5, 1.6, 0.05, 1)], 'Spoken with the browser speech engine when available; lip-sync always runs.'),
  T('cry', 'voice', 'Battle cry', '#b18cff', 0.9, [sel('speaker', 'Speaker', ['A', 'B'], 'B'), num('power', 'Power', 0, 1, 0.05, 0.6), sel('kind', 'Kind', ['shout', 'grunt', 'pain', 'roar', 'breath'], 'shout')]),
  // sfx
  T('hit', 'sfx', 'Hit', '#58d3a0', 0.6, [sel('kind', 'Kind', ['punch', 'kick', 'body', 'heavy', 'crush'], 'punch'), num('power', 'Power', 0, 1, 0.05, 0.5), num('seed', 'Variation', 0, 999, 1, 1), sel('space', 'Space', ['ground', 'air', 'rock'], 'ground')], 'Layered impact: base + low hit + transient + debris + environment reaction.'),
  ...(['whoosh', 'block', 'explosion', 'rockBreak', 'charge', 'release', 'footstep', 'cloth', 'crack', 'rumble', 'riser', 'boom', 'lightning', 'wind'] as const).map((n) =>
    T('sfx_' + n, 'sfx', n === 'rockBreak' ? 'Rock break' : n.charAt(0).toUpperCase() + n.slice(1), '#58d3a0', n === 'charge' || n === 'riser' || n === 'rumble' || n === 'wind' ? 3 : 0.6, [num('power', 'Power', 0, 1, 0.05, 0.5), num('seed', 'Variation', 0, 999, 1, 1), num('pan', 'Pan', -1, 1, 0.05, 0)])),
  T('breathing', 'sfx', 'Breathing', '#58d3a0', 4, [sel('who', 'Who', ['A', 'B'], 'A'), num('rate', 'Rate (breaths/s)', 0.2, 2.5, 0.05, 0.4), num('power', 'Effort', 0, 1, 0.05, 0.3)]),
  T('steps', 'sfx', 'Footsteps', '#58d3a0', 2, [sel('who', 'Who', ['A', 'B'], 'A'), num('rate', 'Steps/s', 0.5, 6, 0.1, 1.8), num('power', 'Weight', 0, 1, 0.05, 0.4)]),
  // music
  T('section', 'music', 'Music section', '#3fb6c9', 20, [sel('mood', 'Mood', ['calm', 'tension', 'escalation', 'fast', 'awakening', 'final', 'ending'], 'calm'), num('intensity', 'Intensity', 0, 1, 0.05, 0.5), num('bpm', 'Tempo (bpm)', 50, 200, 1, 90)], 'Procedural score: rendered from note patterns, not audio files.'),
  T('duck', 'music', 'Music stop / duck', '#2a8797', 1.5, [num('level', 'Level (0 = silence)', 0, 1, 0.05, 0)], 'Cuts the music for dramatic silence.'),
  // lighting
  T('key', 'lighting', 'Light key', '#f4e07a', 3, [
    col('sunCol', 'Sun colour', '#ffe0bb'), num('sunI', 'Sun intensity', 0, 4, 0.05, 1.7), num('sunAz', 'Sun azimuth (°)', -180, 180, 1, -50), num('sunEl', 'Sun elevation (°)', 2, 89, 1, 25),
    col('ambSky', 'Ambient sky', '#7f96d0'), col('ambGround', 'Ambient ground', '#8a6a58'), col('rimCol', 'Rim colour', '#9fc8ff'), col('fogCol', 'Fog colour', '#cfa98f'), num('fogDen', 'Fog density', 0, 0.02, 0.0002, 0.0034),
    col('skyTop', 'Sky top', '#3c5fa8'), col('skyHor', 'Sky horizon', '#f0b98f'), num('cloudCover', 'Cloud cover', 0.3, 0.9, 0.01, 0.56), num('exposure', 'Exposure', 0.3, 2.5, 0.01, 1), num('bloom', 'Bloom', 0, 2, 0.01, 0.35),
    num('contrast', 'Contrast', 0.6, 1.8, 0.01, 1.08), num('saturation', 'Saturation', 0, 2, 0.01, 1.1), num('vignette', 'Vignette', 0, 1, 0.01, 0.28), num('wind', 'Cloud wind', 0, 8, 0.1, 1), col('grade', 'Grade tint', '#ffffff'),
  ], 'Blends from the previous look to this one over the clip duration.'),
  T('speed', 'time', 'Speed', '#9aa3b5', 1, [num('speed', 'Speed (1 = normal)', 0.03, 3, 0.01, 0.3), num('ramp', 'Ramp (s)', 0, 2, 0.05, 0.15)], 'Slow motion / hit-stop: warps presentation time while the timeline stays in scene time.'),
];

export const clipTypeDef = (type: string) => CLIP_TYPES.find((c) => c.type === type);
export function defaultsFor(def: ClipTypeDef): Record<string, any> {
  const o: Record<string, any> = {};
  for (const p of def.params) if (p.def !== undefined) o[p.key] = Array.isArray(p.def) ? [...p.def] : p.def;
  return o;
}
export const typesForTrack = (t: TrackId) => CLIP_TYPES.filter((c) => (Array.isArray(c.track) ? c.track.includes(t) : c.track === t));
