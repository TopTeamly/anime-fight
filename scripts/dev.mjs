// npm run dev : compile once, then watch TypeScript and serve /public.
import { runTscOnce, runTscWatch } from './util.mjs';
import { serve } from './serve.mjs';

const first = runTscOnce();
if (first.status !== 0) console.warn('\n[dev] TypeScript reported errors - fix them, the watcher below will recompile.\n');
runTscWatch();
await serve('public');
