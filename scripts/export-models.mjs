// npm run export:models -> writes the two character meshes (bind pose, vertex colours) as OBJ files into assets/models
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, runTscOnce } from './util.mjs';

const dir = path.join(root, 'public', 'js');
if (!fs.existsSync(path.join(dir, 'characters', 'meshgen.js'))) runTscOnce();
const imp = (p) => import(pathToFileURL(path.join(dir, p)).href);
const [{ SPEC_A, SPEC_B }, { Skeleton }, { buildBody }] = await Promise.all([imp('characters/specs.js'), imp('characters/rig.js'), imp('characters/meshgen.js')]);
const out = path.join(root, 'assets', 'models');
fs.mkdirSync(out, { recursive: true });
for (const spec of [SPEC_A, SPEC_B]) {
  const { mb } = buildBody(spec, new Skeleton(spec));
  const file = path.join(out, `${spec.name.toLowerCase()}.obj`);
  fs.writeFileSync(file, mb.toOBJ(spec.name));
  console.log(`Wrote ${path.relative(root, file)}  (${mb.count} vertices, ${mb.idx.length / 3} triangles)`);
}
