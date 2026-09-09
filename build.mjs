import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';

/* Bundles src/ and inlines the result into each HTML shell, producing
   self-contained single-file builds at the repo root. */

const root = path.resolve('.');
const tmp = path.join(root, '.tmpbuild');
fs.mkdirSync(tmp, { recursive: true });

const targets = [
  { entry: 'src/main.js',     shell: 'shell/game.html',    out: 'neon-vanguard.html' },
  { entry: 'src/showcase.js', shell: 'shell/bay.html',     out: 'character-bay.html' },
  { entry: 'src/studio.js', shell: 'shell/studio.html',  out: 'hero-studio.html' },
];

for (const t of targets) {
  const js = path.join(tmp, path.basename(t.entry) + '.bundle.js');
  await build({
    entryPoints: [t.entry], bundle: true, format: 'iife', target: ['es2020'],
    minify: true, legalComments: 'none', outfile: js, logLevel: 'error',
  });
  const code = fs.readFileSync(js, 'utf8');
  let html = fs.readFileSync(path.join(root, t.shell), 'utf8');
  const tag = `<script type="module" src="../${t.entry}"></script>`;
  if (!html.includes(tag)) throw new Error('script tag not found in ' + t.shell);
  // NOTE: replacement must be a FUNCTION — minified output contains `$&`.
  const inline = '<script>\n' + code.replace(/<\/script>/g, '<\\/script>') + '\n</script>';
  html = html.replace(tag, () => inline);
  fs.writeFileSync(path.join(root, t.out), html);
  console.log('wrote', t.out, (html.length / 1024).toFixed(0) + ' KB');
}
