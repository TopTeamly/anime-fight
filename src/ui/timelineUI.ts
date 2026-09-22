import { h, clear, fmtTime } from './dom.js';
import type { Engine } from '../scene/engine.js';
import { TRACKS, type Clip, type TrackId } from '../timeline/model.js';
import { clipTypeDef, typesForTrack, defaultsFor } from '../timeline/clipTypes.js';

const ROW = 24, HEAD = 176, RULER = 26;

/** DOM timeline: tracks, clips (move / trim / duplicate / delete / split), ruler, markers, zoom, playhead. */
export class TimelineUI {
  el: HTMLElement;
  private scroller: HTMLElement; private content: HTMLElement; private heads: HTMLElement; private ruler: HTMLElement; private head: HTMLElement;
  private rows = new Map<TrackId, HTMLElement>();
  pps = 42;                                   // pixels per second
  selected = new Set<string>();
  snap = true;
  onSelect: (ids: string[]) => void = () => undefined;
  private drag: null | { mode: 'move' | 'l' | 'r'; ids: string[]; x0: number; orig: Map<string, { s: number; d: number; track: TrackId }>; moved: boolean } = null;
  private raf = 0;

  constructor(private engine: Engine) {
    this.heads = h('div', { class: 'tl-heads' });
    this.ruler = h('div', { class: 'tl-ruler' });
    this.content = h('div', { class: 'tl-content' });
    this.head = h('div', { class: 'tl-playhead' }, h('div', { class: 'tl-ph-cap' }));
    this.scroller = h('div', { class: 'tl-scroll', onScroll: () => this.render() }, h('div', { class: 'tl-inner' }, this.ruler, this.content, this.head));
    this.el = h('div', { class: 'timeline' }, this.heads, this.scroller);
    this.buildHeads();
    this.ruler.addEventListener('pointerdown', (e) => this.scrub(e));
    this.content.addEventListener('pointerdown', (e) => { if (e.target === this.content || (e.target as HTMLElement).classList.contains('tl-row')) { this.select([]); } });
    this.scroller.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX); } }, { passive: false });
    window.addEventListener('pointermove', (e) => this.onMove(e)); window.addEventListener('pointerup', () => this.onUp());
    engine.timeline.onChange(() => this.render());
    const loop = () => { this.updatePlayhead(); this.raf = requestAnimationFrame(loop); };
    loop();
    this.render();
  }

  private toolbar() {
    const b = (t: string, title: string, fn: () => void) => h('button', { class: 'tb', title, onClick: fn }, t);
    return h('div', { class: 'tl-tools' },
      b('−', 'Zoom out', () => this.zoom(1 / 1.3)), b('+', 'Zoom in', () => this.zoom(1.3)), b('Fit', 'Fit whole timeline', () => this.fit()),
      h('label', { class: 'chk', title: 'Snap to grid and clip edges' }, h('input', { type: 'checkbox', checked: true, onChange: (e: Event) => { this.snap = (e.target as HTMLInputElement).checked; } }), 'Snap'));
  }
  zoom(f: number, clientX?: number) {
    const rect = this.scroller.getBoundingClientRect(), cx = (clientX ?? rect.left + rect.width / 2) - rect.left;
    const t = (this.scroller.scrollLeft + cx) / this.pps;
    this.pps = Math.min(400, Math.max(4, this.pps * f));
    this.scroller.scrollLeft = t * this.pps - cx;
    this.render();
  }
  fit() { this.pps = Math.max(4, (this.scroller.clientWidth - 30) / this.engine.duration); this.scroller.scrollLeft = 0; this.render(); }

  private buildHeads() {
    clear(this.heads);
    this.heads.append(h('div', { class: 'tl-headspace' }, this.toolbar()));
    for (const t of TRACKS) {
      const add = h('button', { class: 'tb mini', title: `Add clip to ${t.label} at the playhead`, onClick: (e: Event) => this.addMenu(t.id, e.target as HTMLElement) }, '+');
      this.heads.append(h('div', { class: 'tl-head', style: { height: ROW + 'px' } }, h('span', { class: 'dot', style: { background: t.color } }), h('span', { class: 'nm' }, t.label), add));
    }
  }
  private addMenu(track: TrackId, anchor: HTMLElement) {
    document.querySelector('.ctx-menu')?.remove();
    const r = anchor.getBoundingClientRect();
    const menu = h('div', { class: 'ctx-menu', style: { left: r.right + 4 + 'px', top: Math.min(r.top, window.innerHeight - 320) + 'px' } });
    for (const d of typesForTrack(track)) menu.append(h('button', { onClick: () => { menu.remove(); this.addClip(track, d.type); } }, h('span', { class: 'dot', style: { background: d.color } }), d.label));
    document.body.append(menu);
    setTimeout(() => window.addEventListener('pointerdown', () => menu.remove(), { once: true }), 0);
  }
  addClip(track: TrackId, type: string) {
    const d = clipTypeDef(type)!;
    const params = defaultsFor(d);
    const t = this.engine.tau;
    const c = this.engine.timeline.add({ track, type, start: Math.round(t * 20) / 20, dur: d.dur, params });
    this.select([c.id]);
  }

  select(ids: string[], additive = false) {
    if (!additive) this.selected.clear();
    ids.forEach((i) => this.selected.add(i));
    this.render(); this.onSelect([...this.selected]);
  }

  private scrub(e: PointerEvent) {
    const rect = this.scroller.getBoundingClientRect();
    const setT = (ev: PointerEvent) => this.engine.seek(Math.max(0, (ev.clientX - rect.left + this.scroller.scrollLeft) / this.pps));
    setT(e);
    const mv = (ev: PointerEvent) => setT(ev), up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }

  private snapT(t: number, ignore: Set<string>): number {
    if (!this.snap) return t;
    let best = Math.round(t * 20) / 20, bd = 0.03 * (42 / this.pps) + 0.02;
    const cands = [this.engine.tau];
    for (const c of this.engine.timeline.data.clips) { if (ignore.has(c.id)) continue; if (Math.abs(c.start - t) < 2) cands.push(c.start, c.start + c.dur); }
    for (const m of cands) if (Math.abs(m - t) < bd) { best = m; bd = Math.abs(m - t); }
    return best;
  }

  private clipEl(c: Clip): HTMLElement {
    const def = clipTypeDef(c.type), color = def?.color ?? '#888';
    const label = c.label ?? (c.params.kind ? `${def?.label ?? c.type}: ${c.params.kind}` : c.type === 'line' ? `"${(c.params.en ?? '').slice(0, 28)}"` : def?.label ?? c.type);
    const el = h('div', { class: 'clip' + (this.selected.has(c.id) ? ' sel' : ''), title: `${def?.label ?? c.type}  ${c.start.toFixed(2)}s → ${(c.start + c.dur).toFixed(2)}s`, style: { left: c.start * this.pps + 'px', width: Math.max(3, c.dur * this.pps) + 'px', background: color } },
      h('div', { class: 'hd l' }), h('span', { class: 'cl' }, label), h('div', { class: 'hd r' }));
    el.dataset.id = c.id;
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const tgt = e.target as HTMLElement;
      if (!this.selected.has(c.id)) this.select([c.id], e.shiftKey);
      else if (e.shiftKey) { this.selected.delete(c.id); this.render(); this.onSelect([...this.selected]); return; }
      const ids = [...this.selected];
      this.engine.timeline.checkpoint();
      this.drag = { mode: tgt.classList.contains('l') ? 'l' : tgt.classList.contains('r') ? 'r' : 'move', ids, x0: e.clientX, moved: false, orig: new Map(ids.map((i) => { const cc = this.engine.timeline.get(i)!; return [i, { s: cc.start, d: cc.dur, track: cc.track }]; })) };
    });
    return el;
  }
  private onMove(e: PointerEvent) {
    const d = this.drag; if (!d) return;
    const dx = (e.clientX - d.x0) / this.pps;
    if (Math.abs(dx) > 0.002) d.moved = true;
    const ign = new Set(d.ids);
    const tl = this.engine.timeline;
    for (const id of d.ids) {
      const o = d.orig.get(id)!;
      if (d.mode === 'move') tl.update(id, { start: this.snapT(o.s + dx, ign) });
      else if (d.mode === 'l') { const ns = Math.min(this.snapT(o.s + dx, ign), o.s + o.d - 0.05); tl.update(id, { start: ns, dur: o.s + o.d - ns }); }
      else tl.update(id, { dur: Math.max(0.05, this.snapT(o.s + o.d + dx, ign) - o.s) });
    }
  }
  private onUp() { this.drag = null; }

  deleteSelected() { if (this.selected.size) { this.engine.timeline.remove([...this.selected]); this.selected.clear(); this.onSelect([]); } }
  duplicateSelected() { if (this.selected.size) { const n = this.engine.timeline.duplicate([...this.selected]); this.select(n.map((c) => c.id)); } }
  splitAtPlayhead() { for (const id of [...this.selected]) this.engine.timeline.split(id, this.engine.tau); }

  render() {
    const dur = this.engine.duration, W = Math.ceil(dur * this.pps + 200);
    const inner = this.scroller.firstElementChild as HTMLElement;
    inner.style.width = W + 'px';
    const x0 = this.scroller.scrollLeft, x1 = x0 + this.scroller.clientWidth;
    const t0 = x0 / this.pps - 1, t1 = x1 / this.pps + 1;
    // ruler
    clear(this.ruler);
    const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => s * this.pps >= 70) ?? 60;
    for (let t = Math.floor(t0 / step) * step; t < t1; t += step) if (t >= 0) this.ruler.append(h('div', { class: 'tick', style: { left: t * this.pps + 'px' } }, h('span', {}, fmtTime(t, step < 1))));
    for (const m of this.engine.timeline.data.markers) this.ruler.append(h('div', { class: 'marker', style: { left: m.t * this.pps + 'px', borderColor: m.color, color: m.color }, title: m.label, onClick: () => this.engine.seek(m.t) }, h('span', {}, m.label.replace(/PHASE \d · /, ''))));
    // rows
    clear(this.content); this.rows.clear();
    for (const tr of TRACKS) { const row = h('div', { class: 'tl-row', style: { height: ROW + 'px', width: W + 'px' } }); this.rows.set(tr.id, row); this.content.append(row); }
    for (const c of this.engine.timeline.data.clips) {
      if (c.start > t1 || c.start + c.dur < t0) continue;
      this.rows.get(c.track)?.append(this.clipEl(c));
    }
    this.updatePlayhead();
  }
  updatePlayhead() {
    const x = this.engine.tau * this.pps;
    this.head.style.transform = `translateX(${x}px)`;
    this.head.style.height = RULER + TRACKS.length * ROW + 'px';
    if (this.engine.playing) {
      const l = this.scroller.scrollLeft, w = this.scroller.clientWidth;
      if (x > l + w - 60 || x < l) { this.scroller.scrollLeft = Math.max(0, x - 80); this.render(); }
    }
  }
  dispose() { cancelAnimationFrame(this.raf); }
}
void HEAD;
