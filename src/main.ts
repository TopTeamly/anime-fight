import { startApp } from './ui/app.js';

const root = document.getElementById('app')!;
try {
  startApp(root);
} catch (e) {
  root.innerHTML = `<pre style="color:#ffb4a8;padding:24px;font:14px monospace">Anime Fight Engine could not start:\n${String((e as Error).message || e)}\n\nThis prototype needs a browser with WebGL2 (recent Chrome, Edge, Firefox or Safari).</pre>`;
  console.error(e);
}
