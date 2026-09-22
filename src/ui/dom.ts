type Child = Node | string | number | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') (el as any).value = v;
    else if (k === 'checked') (el as any).checked = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
export const clear = (el: HTMLElement) => { while (el.firstChild) el.removeChild(el.firstChild); };
export const fmtTime = (t: number, frames = true) => {
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = Math.floor(t % 60), f = Math.floor((t % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${frames ? '.' + String(f).padStart(2, '0') : ''}`;
};
export function download(name: string, data: Blob | string, type = 'application/octet-stream') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export function slider(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void, fmt?: (v: number) => string) {
  const out = h('span', { class: 'sv' }, fmt ? fmt(value) : value.toFixed(2));
  const inp = h('input', { type: 'range', min, max, step, value, onInput: (e: Event) => { const v = parseFloat((e.target as HTMLInputElement).value); out.textContent = fmt ? fmt(v) : v.toFixed(2); onInput(v); } });
  const row = h('label', { class: 'row slider' }, h('span', { class: 'lbl' }, label), inp, out);
  (row as any).set = (v: number) => { (inp as HTMLInputElement).value = String(v); out.textContent = fmt ? fmt(v) : v.toFixed(2); };
  return row;
}
