// Minimal math library (column-major matrices, right-handed, Y up, characters face +Z).
export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];
export type M4 = Float32Array;

export const TAU = Math.PI * 2;
export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, x: number) => (a === b ? 0 : (x - a) / (b - a));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const rad = (d: number) => (d * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;
export const wrapPi = (a: number) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
export const lerpAngle = (a: number, b: number, t: number) => a + wrapPi(b - a) * t;
export const fmod = (a: number, n: number) => ((a % n) + n) % n;

export const V = {
  zero: (): V3 => [0, 0, 0],
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s],
  mad: (a: V3, b: V3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
  neg: (a: V3): V3 => [-a[0], -a[1], -a[2]],
  dot: (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: V3) => Math.hypot(a[0], a[1], a[2]),
  norm: (a: V3): V3 => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
  },
  dist: (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  distXZ: (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[2] - b[2]),
  lerp: (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  rotY: (v: V3, a: number): V3 => {
    const c = Math.cos(a), s = Math.sin(a);
    return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
  },
  /** direction vector on the XZ plane for a yaw angle (yaw 0 = +Z) */
  fromYaw: (yaw: number): V3 => [Math.sin(yaw), 0, Math.cos(yaw)],
  yawOf: (v: V3) => Math.atan2(v[0], v[2]),
  finite: (v: number[]) => v.every(Number.isFinite),
};

export const Q = {
  ident: (): Q4 => [0, 0, 0, 1],
  mul: (a: Q4, b: Q4): Q4 => [
    a[0] * b[3] + a[3] * b[0] + a[1] * b[2] - a[2] * b[1],
    a[1] * b[3] + a[3] * b[1] + a[2] * b[0] - a[0] * b[2],
    a[2] * b[3] + a[3] * b[2] + a[0] * b[1] - a[1] * b[0],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ],
  conj: (a: Q4): Q4 => [-a[0], -a[1], -a[2], a[3]],
  axisAngle: (axis: V3, ang: number): Q4 => {
    const s = Math.sin(ang / 2);
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(ang / 2)];
  },
  /** yaw(Y) * pitch(X) * roll(Z) */
  euler: (x: number, y: number, z: number): Q4 => {
    const qx = Q.axisAngle([1, 0, 0], x), qy = Q.axisAngle([0, 1, 0], y), qz = Q.axisAngle([0, 0, 1], z);
    return Q.mul(Q.mul(qy, qx), qz);
  },
  norm: (a: Q4): Q4 => {
    const l = Math.hypot(a[0], a[1], a[2], a[3]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l, a[3] / l];
  },
  rotate: (q: Q4, v: V3): V3 => {
    const tx = 2 * (q[1] * v[2] - q[2] * v[1]);
    const ty = 2 * (q[2] * v[0] - q[0] * v[2]);
    const tz = 2 * (q[0] * v[1] - q[1] * v[0]);
    return [
      v[0] + q[3] * tx + (q[1] * tz - q[2] * ty),
      v[1] + q[3] * ty + (q[2] * tx - q[0] * tz),
      v[2] + q[3] * tz + (q[0] * ty - q[1] * tx),
    ];
  },
  slerp: (a: Q4, b: Q4, t: number): Q4 => {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let bb = b;
    if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
    if (d > 0.9995) return Q.norm([a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t]);
    const th = Math.acos(d), s = Math.sin(th);
    const w1 = Math.sin((1 - t) * th) / s, w2 = Math.sin(t * th) / s;
    return [a[0] * w1 + bb[0] * w2, a[1] * w1 + bb[1] * w2, a[2] * w1 + bb[2] * w2, a[3] * w1 + bb[3] * w2];
  },
  /** quaternion from orthonormal basis columns (x,y,z axes expressed in parent space) */
  fromBasis: (x: V3, y: V3, z: V3): Q4 => {
    const m00 = x[0], m01 = y[0], m02 = z[0], m10 = x[1], m11 = y[1], m12 = z[1], m20 = x[2], m21 = y[2], m22 = z[2];
    const tr = m00 + m11 + m22;
    let q: Q4;
    if (tr > 0) {
      const s = Math.sqrt(tr + 1) * 2;
      q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
    } else if (m00 > m11 && m00 > m22) {
      const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
      q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
    } else if (m11 > m22) {
      const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
      q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
    } else {
      const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
      q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
    }
    return Q.norm(q);
  },
  /** shortest rotation taking direction a to direction b */
  fromTo: (a: V3, b: V3): Q4 => {
    const d = V.dot(a, b);
    if (d > 0.99999) return [0, 0, 0, 1];
    if (d < -0.99999) {
      const ax = Math.abs(a[0]) < 0.9 ? V.norm(V.cross(a, [1, 0, 0])) : V.norm(V.cross(a, [0, 1, 0]));
      return Q.axisAngle(ax, Math.PI);
    }
    const c = V.cross(a, b);
    return Q.norm([c[0], c[1], c[2], 1 + d]);
  },
};

/** Orthonormal frame with forward axis `d` and secondary axis derived from `hint`. Returns rotation quaternion mapping
 *  local (x = side, y = hint-ish, z = d) axes into parent space. */
export function frameQuat(d: V3, hint: V3): Q4 {
  const z = V.norm(d);
  let y = V.sub(hint, V.mul(z, V.dot(hint, z)));
  if (V.len(y) < 1e-4) y = Math.abs(z[1]) < 0.9 ? V.sub([0, 1, 0], V.mul(z, z[1])) : V.sub([1, 0, 0], V.mul(z, z[0]));
  y = V.norm(y);
  const x = V.cross(y, z);
  return Q.fromBasis(x, y, z);
}

export const M = {
  ident: (): M4 => {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },
  fromQP: (q: Q4, p: V3, s = 1, out: M4 = new Float32Array(16)): M4 => {
    const [x, y, z, w] = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    out[0] = (1 - (yy + zz)) * s; out[1] = (xy + wz) * s; out[2] = (xz - wy) * s; out[3] = 0;
    out[4] = (xy - wz) * s; out[5] = (1 - (xx + zz)) * s; out[6] = (yz + wx) * s; out[7] = 0;
    out[8] = (xz + wy) * s; out[9] = (yz - wx) * s; out[10] = (1 - (xx + yy)) * s; out[11] = 0;
    out[12] = p[0]; out[13] = p[1]; out[14] = p[2]; out[15] = 1;
    return out;
  },
  mul: (a: M4, b: M4, out: M4 = new Float32Array(16)): M4 => {
    const r = out === a || out === b ? new Float32Array(16) : out;
    for (let c = 0; c < 4; c++) {
      for (let rr = 0; rr < 4; rr++) {
        r[c * 4 + rr] = a[rr] * b[c * 4] + a[4 + rr] * b[c * 4 + 1] + a[8 + rr] * b[c * 4 + 2] + a[12 + rr] * b[c * 4 + 3];
      }
    }
    if (r !== out) out.set(r);
    return out;
  },
  perspective: (fovY: number, aspect: number, near: number, far: number): M4 => {
    const f = 1 / Math.tan(fovY / 2), m = new Float32Array(16);
    m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = (2 * far * near) / (near - far);
    return m;
  },
  ortho: (l: number, r: number, b: number, t: number, n: number, f: number): M4 => {
    const m = new Float32Array(16);
    m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = -2 / (f - n);
    m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(f + n) / (f - n); m[15] = 1;
    return m;
  },
  lookAt: (eye: V3, target: V3, up: V3 = [0, 1, 0]): M4 => {
    const z = V.norm(V.sub(eye, target));
    let x = V.cross(up, z);
    if (V.len(x) < 1e-6) x = [1, 0, 0];
    x = V.norm(x);
    const y = V.cross(z, x);
    const m = new Float32Array(16);
    m[0] = x[0]; m[4] = x[1]; m[8] = x[2];
    m[1] = y[0]; m[5] = y[1]; m[9] = y[2];
    m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
    m[12] = -V.dot(x, eye); m[13] = -V.dot(y, eye); m[14] = -V.dot(z, eye); m[15] = 1;
    return m;
  },
  invert: (m: M4): M4 => {
    const a = m, o = new Float32Array(16);
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return M.ident();
    det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  },
  point: (m: M4, v: V3): V3 => {
    const w = m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] || 1;
    return [
      (m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]) / w,
      (m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]) / w,
      (m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]) / w,
    ];
  },
  /** skin matrix = T(wp) * R(wq) * T(-bindPos), written into `dst` at float offset `o` */
  skin: (wq: Q4, wp: V3, bp: V3, dst: Float32Array, o: number) => {
    const [x, y, z, w] = wq;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    const r00 = 1 - (yy + zz), r10 = xy + wz, r20 = xz - wy;
    const r01 = xy - wz, r11 = 1 - (xx + zz), r21 = yz + wx;
    const r02 = xz + wy, r12 = yz - wx, r22 = 1 - (xx + yy);
    dst[o] = r00; dst[o + 1] = r10; dst[o + 2] = r20; dst[o + 3] = 0;
    dst[o + 4] = r01; dst[o + 5] = r11; dst[o + 6] = r21; dst[o + 7] = 0;
    dst[o + 8] = r02; dst[o + 9] = r12; dst[o + 10] = r22; dst[o + 11] = 0;
    dst[o + 12] = wp[0] - (r00 * bp[0] + r01 * bp[1] + r02 * bp[2]);
    dst[o + 13] = wp[1] - (r10 * bp[0] + r11 * bp[1] + r12 * bp[2]);
    dst[o + 14] = wp[2] - (r20 * bp[0] + r21 * bp[1] + r22 * bp[2]);
    dst[o + 15] = 1;
  },
};
