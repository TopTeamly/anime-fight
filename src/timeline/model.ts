import type { V3 } from '../utils/math.js';

export type TrackId = 'charA' | 'charB' | 'camera' | 'vfx' | 'environment' | 'dialogue' | 'voice' | 'sfx' | 'music' | 'lighting' | 'time';

export interface TrackDef { id: TrackId; label: string; color: string; short: string }
export const TRACKS: TrackDef[] = [
  { id: 'charA', label: 'Character A · Sael', short: 'A', color: '#8fc4ff' },
  { id: 'charB', label: 'Character B · Korran', short: 'B', color: '#4f7dff' },
  { id: 'camera', label: 'Camera', short: 'CAM', color: '#ffc247' },
  { id: 'vfx', label: 'VFX', short: 'VFX', color: '#ff7a45' },
  { id: 'environment', label: 'Environment', short: 'ENV', color: '#c49a6c' },
  { id: 'dialogue', label: 'Dialogue', short: 'DLG', color: '#e58fe0' },
  { id: 'voice', label: 'Voice', short: 'VOX', color: '#b18cff' },
  { id: 'sfx', label: 'Sound Effects', short: 'SFX', color: '#58d3a0' },
  { id: 'music', label: 'Music', short: 'MUS', color: '#3fb6c9' },
  { id: 'lighting', label: 'Lighting', short: 'LGT', color: '#f4e07a' },
  { id: 'time', label: 'Time Warp', short: 'SPD', color: '#9aa3b5' },
];
export const trackDef = (id: TrackId) => TRACKS.find((t) => t.id === id)!;

export interface Clip {
  id: string;
  track: TrackId;
  type: string;
  start: number;
  dur: number;
  label?: string;
  params: Record<string, any>;
}
export interface Marker { t: number; label: string; color: string }
export interface TimelineData {
  version: 1;
  name: string;
  duration: number;
  fps: number;
  startPos: { A: V3; B: V3 };
  clips: Clip[];
  markers: Marker[];
}

export const emptyTimeline = (): TimelineData => ({ version: 1, name: 'Untitled', duration: 30, fps: 30, startPos: { A: [-8, 0, 0], B: [8, 0, 0] }, clips: [], markers: [] });

/** Editable timeline with undo/redo and change notification. All edits go through these methods. */
export class Timeline {
  data: TimelineData;
  private listeners = new Set<(kind: 'edit' | 'load') => void>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private seq = 1;
  constructor(d: TimelineData) { this.data = d; this.reseq(); }
  private reseq() { for (const c of this.data.clips) { const n = parseInt(c.id.replace(/\D/g, ''), 10); if (n >= this.seq) this.seq = n + 1; } }
  newId() { return 'c' + this.seq++; }
  onChange(fn: (k: 'edit' | 'load') => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(k: 'edit' | 'load' = 'edit') { for (const l of this.listeners) l(k); }
  load(d: TimelineData) { this.data = d; this.undoStack = []; this.redoStack = []; this.seq = 1; this.reseq(); this.emit('load'); }
  /** push an undo snapshot; call before a group of edits */
  checkpoint() { this.undoStack.push(JSON.stringify(this.data)); if (this.undoStack.length > 60) this.undoStack.shift(); this.redoStack = []; }
  undo() { const s = this.undoStack.pop(); if (!s) return false; this.redoStack.push(JSON.stringify(this.data)); this.data = JSON.parse(s); this.emit(); return true; }
  redo() { const s = this.redoStack.pop(); if (!s) return false; this.undoStack.push(JSON.stringify(this.data)); this.data = JSON.parse(s); this.emit(); return true; }

  get(id: string) { return this.data.clips.find((c) => c.id === id); }
  add(c: Omit<Clip, 'id'> & { id?: string }, snapshot = true): Clip {
    if (snapshot) this.checkpoint();
    const clip: Clip = { id: c.id ?? this.newId(), ...c } as Clip;
    this.data.clips.push(clip);
    this.extend(clip);
    this.emit();
    return clip;
  }
  private extend(c: Clip) { if (c.start + c.dur > this.data.duration) this.data.duration = Math.ceil(c.start + c.dur + 1); }
  remove(ids: string[]) { this.checkpoint(); this.data.clips = this.data.clips.filter((c) => !ids.includes(c.id)); this.emit(); }
  /** modify a clip. Pass snapshot=false while dragging (call checkpoint() once at drag start). */
  update(id: string, patch: Partial<Pick<Clip, 'start' | 'dur' | 'label' | 'type'>> & { params?: Record<string, any> }, snapshot = false) {
    const c = this.get(id); if (!c) return;
    if (snapshot) this.checkpoint();
    if (patch.start !== undefined) c.start = Math.max(0, patch.start);
    if (patch.dur !== undefined) c.dur = Math.max(0.03, patch.dur);
    if (patch.label !== undefined) c.label = patch.label;
    if (patch.type !== undefined) c.type = patch.type;
    if (patch.params) c.params = { ...c.params, ...patch.params };
    this.extend(c);
    this.emit();
  }
  duplicate(ids: string[], offset?: number): Clip[] {
    this.checkpoint();
    const out: Clip[] = [];
    for (const id of ids) {
      const c = this.get(id); if (!c) continue;
      const n: Clip = { ...JSON.parse(JSON.stringify(c)), id: this.newId(), start: c.start + (offset ?? c.dur + 0.05) };
      this.data.clips.push(n); this.extend(n); out.push(n);
    }
    this.emit();
    return out;
  }
  split(id: string, t: number) {
    const c = this.get(id); if (!c || t <= c.start + 0.05 || t >= c.start + c.dur - 0.05) return null;
    this.checkpoint();
    const n: Clip = { ...JSON.parse(JSON.stringify(c)), id: this.newId(), start: t, dur: c.start + c.dur - t };
    c.dur = t - c.start;
    this.data.clips.push(n);
    this.emit();
    return n;
  }
  byTrack(track: TrackId) { return this.data.clips.filter((c) => c.track === track).sort((a, b) => a.start - b.start); }
  toJSON() { return JSON.stringify(this.data); }
}
