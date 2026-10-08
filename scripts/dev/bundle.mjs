// Dev-only bundler used in the sandbox (no npm access): esbuild from a local install. Not needed when using Vite.
import * as esbuild from '/opt/npm-tools/node_modules/esbuild/lib/main.js';
import fs from 'node:fs';
const out = process.argv[2] ?? 'dist-esbuild';
fs.mkdirSync(out, { recursive: true });
const common = { bundle: true, format: 'esm', target: 'es2022', nodePaths: ['/opt/npm-tools/node_modules'], loader: { '.json': 'json' }, logLevel: 'info', define: { 'process.env.NODE_ENV': '"production"' }, jsx: 'automatic', minify: false, sourcemap: 'inline' };
await esbuild.build({ ...common, entryPoints: ['src/worker/engine.worker.ts'], outfile: `${out}/engine.worker.js` });
await esbuild.build({ ...common, entryPoints: ['src/main.tsx'], outfile: `${out}/main.js`, plugins: [{ name: 'worker-url', setup(b) { b.onResolve({ filter: /engine\.worker\.ts$/ }, () => ({ path: './engine.worker.js', external: true })); } }] });
fs.writeFileSync(`${out}/main.js`, fs.readFileSync(`${out}/main.js`, 'utf8').replace(/\.\.\/worker\/engine\.worker\.ts/g, './engine.worker.js'));
fs.writeFileSync(`${out}/index.html`, `<!doctype html><html><head><meta charset="utf-8"><title>Captive Solar Studio</title><link rel="stylesheet" href="main.css"></head><body><div id="root"></div><script type="module" src="main.js"></script></body></html>`);
console.log('bundled to', out);
