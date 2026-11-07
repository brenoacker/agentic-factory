import * as esbuild from 'esbuild';
import { resolve, join } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const entryPoint = join(rootDir, 'apps', 'panel', 'src', 'app.jsx');
const outFile = join(rootDir, 'apps', 'panel', 'public', 'bundle.js');

await esbuild.build({
  entryPoints: [entryPoint],
  bundle: true,
  outfile: outFile,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  loader: {
    '.js': 'jsx',
    '.jsx': 'jsx',
    '.css': 'css',
    '.woff': 'dataurl',
    '.woff2': 'dataurl',
    '.ttf': 'dataurl',
    '.eot': 'dataurl',
    '.svg': 'dataurl',
    '.png': 'dataurl',
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'info',
});
