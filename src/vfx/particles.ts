import type { V3 } from '../utils/math.js';
import { Mesh, LAYOUT, type GL2 } from '../engine/gl.js';

export interface P {
  p: V3; v: V3; birth: number; life: number; c0: [number, number, number, number]; c1: [number, number, number, number];
  s0: number; s1: number; rot?: number; rotV?: number; g?: number; drag?: number; anchor?: number; shape?: number;
}

/** Fixed-capacity instance pool with a first-fit block allocator. Emitters reserve a block, write their particles once,
 *  and the GPU evaluates motion in the vertex shader (closed-form), so nothing is re-uploaded per frame. */
export class InstancePool {
  buf: WebGLBuffer;
  data: Float32Array;
  private free: [number, number][];
  high = 0;
  private dMin = Infinity; private dMax = -1;
  used = 0;
  constructor(private gl: GL2, readonly mesh: Mesh, locs: number[], readonly cap: number, readonly stride: number) {
    this.data = new Float32Array(cap * stride);
    for (let i = 0; i < cap; i++) this.data[i * stride + 3] = 1e9;
    this.buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data, gl.DYNAMIC_DRAW);
    mesh.addInstances(this.buf, locs.map((l) => ({ loc: l, size: 4 })), stride);
    this.free = [[0, cap]];
  }
  alloc(n: number): number {
    for (let i = 0; i < this.free.length; i++) {
      const [s, l] = this.free[i];
      if (l >= n) {
        if (l === n) this.free.splice(i, 1); else this.free[i] = [s + n, l - n];
        this.high = Math.max(this.high, s + n); this.used += n;
        return s;
      }
    }
    return -1;
  }
  release(start: number, n: number) {
    for (let i = start; i < start + n; i++) this.data[i * this.stride + 3] = 1e9;
    this.touch(start, start + n);
    this.used -= n;
    this.free.push([start, n]);
    this.free.sort((a, b) => a[0] - b[0]);
    const m: [number, number][] = [];
    for (const f of this.free) { const l = m[m.length - 1]; if (l && l[0] + l[1] === f[0]) l[1] += f[1]; else m.push([f[0], f[1]]); }
    this.free = m;
  }
  touch(a: number, b: number) { this.dMin = Math.min(this.dMin, a); this.dMax = Math.max(this.dMax, b); }
  flush() {
    if (this.dMax < 0) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, this.dMin * this.stride * 4, this.data, this.dMin * this.stride, (this.dMax - this.dMin) * this.stride);
    this.dMin = Infinity; this.dMax = -1;
  }
  draw() { if (this.high > 0) this.mesh.draw(this.gl.TRIANGLES, this.high); }
  /** write a screen-facing particle (layout matches PARTICLE_VS) */
  put(slot: number, q: P) {
    const d = this.data, o = slot * this.stride;
    d[o] = q.p[0]; d[o + 1] = q.p[1]; d[o + 2] = q.p[2]; d[o + 3] = q.birth;
    d[o + 4] = q.v[0]; d[o + 5] = q.v[1]; d[o + 6] = q.v[2]; d[o + 7] = q.life;
    d.set(q.c0, o + 8); d.set(q.c1, o + 12);
    d[o + 16] = q.s0; d[o + 17] = q.s1; d[o + 18] = q.rot ?? 0; d[o + 19] = q.rotV ?? 0;
    d[o + 20] = q.g ?? 0; d[o + 21] = q.drag ?? 0; d[o + 22] = q.anchor ?? 0; d[o + 23] = q.shape ?? 0;
    this.touch(slot, slot + 1);
  }
}

export function quadMesh(gl: GL2): Mesh {
  const c = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];
  return new Mesh(gl, LAYOUT.quad, new Float32Array(c));
}
