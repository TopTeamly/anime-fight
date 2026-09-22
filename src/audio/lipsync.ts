import { hash1 } from '../utils/rng.js';

/** Basic lip-sync: a deterministic mouth-opening curve derived from the text and the clip length.
 *  Vowels open wide, closed consonants shut the mouth, spaces and punctuation are brief pauses. */
const OPEN: Record<string, number> = { a: 1, o: 0.85, e: 0.6, i: 0.35, u: 0.5, y: 0.35, 'ا': 0.9, 'و': 0.6, 'ي': 0.4, 'ى': 0.4, 'ع': 0.8, 'ه': 0.7, 'أ': 0.9, 'إ': 0.5 };
const CLOSED = new Set('bmpفبمپ');

export function lipCurve(text: string, u: number): number {
  const s = text.replace(/\s+/g, ' ').trim();
  if (!s.length || u < 0 || u > 1) return 0;
  const n = s.length;
  const x = u * n, i = Math.min(n - 1, Math.floor(x)), f = x - i;
  const ch = s[i].toLowerCase();
  if (ch === ' ' || /[.,!?؟،…-]/.test(ch)) return 0.05;
  let base = OPEN[ch] ?? (CLOSED.has(ch) ? 0.02 : 0.18 + 0.25 * hash1(ch.charCodeAt(0)));
  // shape each letter as a short open-close pulse
  const pulse = Math.sin(Math.PI * Math.min(1, f * 1.15));
  return Math.max(0, Math.min(1, base * (0.35 + 0.65 * pulse)));
}
/** how long a line should take to say (used by the generator and the speech rate) */
export const speechDuration = (text: string) => Math.max(0.8, text.replace(/\s+/g, ' ').trim().length * 0.06 + 0.35);
