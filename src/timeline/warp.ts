import { smoothstep } from '../utils/math.js';
import type { Clip } from './model.js';

/** Controlled slow motion: the timeline authors "scene time" (tau); the Time Warp track maps it to presentation time.
 *  speed(tau) < 1 stretches scene time (slow motion / hit-stop), and audio events are scheduled through the same map. */
export class TimeWarp {
  private real: Float32Array = new Float32Array(2);
  private step = 1 / 240;
  realDuration = 0;
  duration = 0;

  build(clips: Clip[], duration: number) {
    this.duration = duration;
    const speeds = clips.filter((c) => c.type === 'speed');
    const n = Math.ceil(duration / this.step) + 1;
    this.real = new Float32Array(n + 1);
    let r = 0;
    for (let i = 0; i <= n; i++) {
      this.real[i] = r;
      const tau = i * this.step;
      let s = 1;
      for (const c of speeds) {
        const end = c.start + c.dur, ramp = Math.max(0.001, Math.min(c.params.ramp ?? 0.15, c.dur / 2));
        if (tau < c.start || tau > end) continue;
        const env = Math.min(smoothstep(0, ramp, tau - c.start), smoothstep(0, ramp, end - tau));
        s *= 1 + ((c.params.speed ?? 0.3) - 1) * env;
      }
      r += this.step / Math.max(0.03, s);
    }
    this.realDuration = this.real[n];
  }
  /** scene time -> presentation time */
  realOf(tau: number): number {
    if (tau <= 0) return tau;
    const x = tau / this.step, i = Math.floor(x);
    if (i >= this.real.length - 1) return this.real[this.real.length - 1] + (tau - (this.real.length - 1) * this.step);
    return this.real[i] + (this.real[i + 1] - this.real[i]) * (x - i);
  }
  /** presentation time -> scene time */
  contentOf(real: number): number {
    if (real <= 0) return real;
    let lo = 0, hi = this.real.length - 1;
    if (real >= this.real[hi]) return hi * this.step + (real - this.real[hi]);
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.real[m] <= real) lo = m; else hi = m; }
    const f = (real - this.real[lo]) / Math.max(1e-9, this.real[hi] - this.real[lo]);
    return (lo + f) * this.step;
  }
}
