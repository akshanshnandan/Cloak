import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const out = path.join(root, 'extension', 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const entry of ['content', 'background', 'popup']) {
  await build({
    absWorkingDir: root,
    tsconfig: path.join(root, 'extension', 'tsconfig.json'),
    entryPoints: [path.resolve(root, 'extension', 'src', `${entry}.ts`)],
    outfile: path.join(out, `${entry}.js`),
    bundle: true,
    external: ['../../src/types.ts'],
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    sourcemap: false
  });
}
for (const file of ['manifest.json', 'popup.html', 'popup.css']) {
  await cp(path.join(root, 'extension', file), path.join(out, file));
}
await cp(path.join(root, 'public', 'mark.svg'), path.join(out, 'mark.svg'));
