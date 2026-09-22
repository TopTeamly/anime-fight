// npm run export:scene -> writes the generated fight timeline as JSON (assets/scenes/*.afe.json)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, runTscOnce } from './util.mjs';

const built = path.join(root, 'public', 'js', 'timeline', 'fight.js');
if (!fs.existsSync(built)) runTscOnce();
const { buildFight } = await import(pathToFileURL(built).href);
const data = buildFight();
const out = path.join(root, 'assets', 'scenes');
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, 'duel-at-shattered-ridge.afe.json');
fs.writeFileSync(file, JSON.stringify(data));
console.log(`Wrote ${path.relative(root, file)}  (${data.clips.length} clips, ${data.duration}s of scene time)`);
