import type { GL2 } from '../engine/gl.js';

/** fullscreen-triangle sky: gradient, sun glow and toon clouds evaluated per pixel */
export class Sky {
  private vao: WebGLVertexArrayObject;
  constructor(private gl: GL2) { this.vao = gl.createVertexArray()!; }
  draw() {
    this.gl.bindVertexArray(this.vao);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
    this.gl.bindVertexArray(null);
  }
}
