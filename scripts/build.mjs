// npm run build : compile TypeScript and copy the static site into /dist.
import fs from 'node:fs';
import path from 'node:path';
import { root, runTscOnce } from './util.mjs';

const r = runTscOnce();
if (r.status !== 0) { console.error('Build failed (TypeScript errors).'); process.exit(1); }
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), dist, { recursive: true, filter: (s) => !s.endsWith('.map') });
const assets = path.join(root, 'assets');
if (fs.existsSync(assets)) fs.cpSync(assets, path.join(dist, 'assets'), { recursive: true });
console.log('Build complete -> dist/  (serve with: npm start)');
